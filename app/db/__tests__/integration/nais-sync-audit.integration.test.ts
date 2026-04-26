import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { getTestDb, setupTestDatabase, teardownTestDatabase } from "./setup"

vi.mock("~/db/connection.server", () => ({
	get db() {
		return getTestDb()
	},
	get pool() {
		return null
	},
}))

const { upsertAppPersistence, upsertAppAuthIntegration } = await import("~/db/queries/nais.server")

async function createTestApp(name: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO monitored_applications (name, created_by, updated_by) VALUES ('${name}', 'test', 'test') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function getAuditByEntity(entityType: string, entityId: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `SELECT action, previous_value, new_value, performed_by, metadata FROM audit_log WHERE entity_type = '${entityType}' AND entity_id = '${entityId}' ORDER BY performed_at, action`,
	)
	return r.rows as Array<{
		action: string
		previous_value: string | null
		new_value: string | null
		performed_by: string
		metadata: unknown
	}>
}

async function getPersistenceId(applicationId: string, type: string, name: string): Promise<string> {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `SELECT id FROM application_persistence WHERE application_id = '${applicationId}' AND type = '${type}' AND name = '${name}' LIMIT 1`,
	)
	return (r.rows[0] as { id: string }).id
}

async function getAuthIntegrationId(applicationId: string, type: string): Promise<string> {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `SELECT id FROM application_auth_integrations WHERE application_id = '${applicationId}' AND type = '${type}' LIMIT 1`,
	)
	return (r.rows[0] as { id: string }).id
}

describe("Nais-sync upsert audit logging (K3)", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	})

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `DELETE FROM audit_log`)
		await db.execute(/* sql */ `DELETE FROM application_persistence`)
		await db.execute(/* sql */ `DELETE FROM application_auth_integrations`)
		await db.execute(/* sql */ `DELETE FROM monitored_applications`)
	})

	describe("upsertAppPersistence", () => {
		it("logger persistence_added ved første INSERT fra Nais", async () => {
			const appId = await createTestApp("kiss-test-app-1")
			const isNew = await upsertAppPersistence(appId, "nais_postgres", "mydb", { version: "15", tier: "premium" })
			expect(isNew).toBe(true)

			const id = await getPersistenceId(appId, "nais_postgres", "mydb")
			const audits = await getAuditByEntity("application_persistence", id)
			expect(audits).toHaveLength(1)
			expect(audits[0].action).toBe("persistence_added")
			expect(audits[0].performed_by).toBe("nais-sync")
			const newVal = JSON.parse(audits[0].new_value ?? "{}")
			expect(newVal).toMatchObject({ type: "nais_postgres", name: "mydb", version: "15", tier: "premium" })
		})

		it("logger persistence_updated KUN ved faktisk feltendring", async () => {
			const appId = await createTestApp("kiss-test-app-2")
			await upsertAppPersistence(appId, "nais_postgres", "mydb", { version: "15" })
			const id = await getPersistenceId(appId, "nais_postgres", "mydb")

			// Capture updatedAt before no-op resync to verify no DB-mutation
			const db = getTestDb()
			const beforeRow = (
				await db.execute(/* sql */ `SELECT updated_at FROM application_persistence WHERE id = '${id}'`)
			).rows[0] as { updated_at: string }

			// No-op resync — samme verdier — skal IKKE skrive ny audit OG
			// IKKE mutere updated_at (AGENTS.md regel 6: ingen DB-mutasjon uten audit)
			const isNewAgain = await upsertAppPersistence(appId, "nais_postgres", "mydb", { version: "15" })
			expect(isNewAgain).toBe(false)
			let audits = await getAuditByEntity("application_persistence", id)
			expect(audits).toHaveLength(1)
			expect(audits[0].action).toBe("persistence_added")

			const afterRow = (await db.execute(/* sql */ `SELECT updated_at FROM application_persistence WHERE id = '${id}'`))
				.rows[0] as { updated_at: string }
			expect(afterRow.updated_at).toBe(beforeRow.updated_at)

			// Faktisk endring — skal skrive persistence_updated OG mutere updated_at
			await upsertAppPersistence(appId, "nais_postgres", "mydb", { version: "16", tier: "standard" })
			audits = await getAuditByEntity("application_persistence", id)
			expect(audits).toHaveLength(2)
			expect(audits[1].action).toBe("persistence_updated")
			const prev = JSON.parse(audits[1].previous_value ?? "{}")
			const next = JSON.parse(audits[1].new_value ?? "{}")
			expect(prev.version).toBe("15")
			expect(next.version).toBe("16")
			expect(next.tier).toBe("standard")
		})

		it("logger persistence_unarchived (uten persistence_updated) når arkivert rad reaktiveres uten feltendring", async () => {
			const appId = await createTestApp("kiss-test-app-3")
			await upsertAppPersistence(appId, "nais_postgres", "mydb", { version: "15" })
			const id = await getPersistenceId(appId, "nais_postgres", "mydb")

			const db = getTestDb()
			await db.execute(
				/* sql */ `UPDATE application_persistence SET archived_at = NOW(), archived_by = 'manual-test' WHERE id = '${id}'`,
			)

			await upsertAppPersistence(appId, "nais_postgres", "mydb", { version: "15" })
			const audits = await getAuditByEntity("application_persistence", id)
			const actions = audits.map((a) => a.action)
			expect(actions).toContain("persistence_unarchived")
			// Uten feltendring skal det IKKE skrives både unarchived OG updated
			expect(actions.filter((a) => a === "persistence_updated")).toHaveLength(0)
		})

		it("logger BÅDE persistence_unarchived OG persistence_updated når arkivert rad reaktiveres med samtidig feltendring", async () => {
			const appId = await createTestApp("kiss-test-app-3b")
			await upsertAppPersistence(appId, "nais_postgres", "mydb", { version: "15", tier: "standard" })
			const id = await getPersistenceId(appId, "nais_postgres", "mydb")

			const db = getTestDb()
			await db.execute(
				/* sql */ `UPDATE application_persistence SET archived_at = NOW(), archived_by = 'manual-test' WHERE id = '${id}'`,
			)

			// Reaktiver MED endring av version + tier
			await upsertAppPersistence(appId, "nais_postgres", "mydb", { version: "16", tier: "premium" })
			const audits = await getAuditByEntity("application_persistence", id)
			const actions = audits.map((a) => a.action)
			expect(actions).toContain("persistence_unarchived")
			expect(actions).toContain("persistence_updated")

			const updated = audits.find((a) => a.action === "persistence_updated")
			expect(updated).toBeDefined()
			const prev = JSON.parse(updated?.previous_value ?? "{}")
			const next = JSON.parse(updated?.new_value ?? "{}")
			expect(prev.version).toBe("15")
			expect(prev.tier).toBe("standard")
			expect(next.version).toBe("16")
			expect(next.tier).toBe("premium")
		})
	})

	describe("upsertAppAuthIntegration", () => {
		it("logger auth_integration_added ved første INSERT", async () => {
			const appId = await createTestApp("kiss-test-app-4")
			const isNew = await upsertAppAuthIntegration(appId, "entra_id", {
				allowAllUsers: false,
				groups: ["group-b", "group-a"],
				claimsExtra: ["NAVident"],
			})
			expect(isNew).toBe(true)

			const id = await getAuthIntegrationId(appId, "entra_id")
			const audits = await getAuditByEntity("application_auth_integration", id)
			expect(audits).toHaveLength(1)
			expect(audits[0].action).toBe("auth_integration_added")
			expect(audits[0].performed_by).toBe("nais-sync")
			const newVal = JSON.parse(audits[0].new_value ?? "{}")
			expect(newVal.type).toBe("entra_id")
			expect(newVal.enabled).toBe(true)
			// Arrays skal være kanoniserte (sortert)
			expect(JSON.parse(newVal.groups)).toEqual(["group-a", "group-b"])
		})

		it("logger ingen auth_integration_updated på no-op resync med samme arrays i ulik rekkefølge", async () => {
			const appId = await createTestApp("kiss-test-app-5")
			await upsertAppAuthIntegration(appId, "entra_id", {
				allowAllUsers: false,
				groups: ["group-a", "group-b"],
				claimsExtra: ["NAVident", "azp_name"],
			})
			const id = await getAuthIntegrationId(appId, "entra_id")

			// Capture updatedAt to verify no DB-mutation on no-op
			const db = getTestDb()
			const beforeRow = (
				await db.execute(/* sql */ `SELECT updated_at FROM application_auth_integrations WHERE id = '${id}'`)
			).rows[0] as { updated_at: string }

			// Resync med arrays i annen rekkefølge — skal være no-op
			await upsertAppAuthIntegration(appId, "entra_id", {
				allowAllUsers: false,
				groups: ["group-b", "group-a"],
				claimsExtra: ["azp_name", "NAVident"],
			})

			const audits = await getAuditByEntity("application_auth_integration", id)
			expect(audits).toHaveLength(1)
			expect(audits[0].action).toBe("auth_integration_added")

			// updated_at skal IKKE ha endret seg (AGENTS.md regel 6)
			const afterRow = (
				await db.execute(/* sql */ `SELECT updated_at FROM application_auth_integrations WHERE id = '${id}'`)
			).rows[0] as { updated_at: string }
			expect(afterRow.updated_at).toBe(beforeRow.updated_at)
		})

		it("logger auth_integration_updated ved faktisk feltendring", async () => {
			const appId = await createTestApp("kiss-test-app-6")
			await upsertAppAuthIntegration(appId, "entra_id", { allowAllUsers: false, groups: ["group-a"] })
			const id = await getAuthIntegrationId(appId, "entra_id")

			await upsertAppAuthIntegration(appId, "entra_id", { allowAllUsers: true, groups: ["group-a", "group-c"] })
			const audits = await getAuditByEntity("application_auth_integration", id)
			expect(audits).toHaveLength(2)
			expect(audits[1].action).toBe("auth_integration_updated")
			const prev = JSON.parse(audits[1].previous_value ?? "{}")
			const next = JSON.parse(audits[1].new_value ?? "{}")
			expect(prev.allowAllUsers).toBe(false)
			expect(next.allowAllUsers).toBe(true)
			expect(JSON.parse(next.groups)).toEqual(["group-a", "group-c"])
		})

		it("logger auth_integration_updated når enabled går fra false til true (reaktivering)", async () => {
			const appId = await createTestApp("kiss-test-app-7")
			await upsertAppAuthIntegration(appId, "token_x", {})
			const id = await getAuthIntegrationId(appId, "token_x")

			const db = getTestDb()
			await db.execute(/* sql */ `UPDATE application_auth_integrations SET enabled = false WHERE id = '${id}'`)

			await upsertAppAuthIntegration(appId, "token_x", {})
			const audits = await getAuditByEntity("application_auth_integration", id)
			const updates = audits.filter((a) => a.action === "auth_integration_updated")
			expect(updates).toHaveLength(1)
			const prev = JSON.parse(updates[0].previous_value ?? "{}")
			const next = JSON.parse(updates[0].new_value ?? "{}")
			expect(prev.enabled).toBe(false)
			expect(next.enabled).toBe(true)
		})

		it("kanoniserer inboundRules deterministisk", async () => {
			const appId = await createTestApp("kiss-test-app-8")
			await upsertAppAuthIntegration(appId, "entra_id", {
				inboundRules: [
					{ application: "app-b", namespace: "ns-1" },
					{ application: "app-a", namespace: "ns-2" },
				],
			})
			const id = await getAuthIntegrationId(appId, "entra_id")

			// Samme regler i annen rekkefølge skal være no-op
			await upsertAppAuthIntegration(appId, "entra_id", {
				inboundRules: [
					{ application: "app-a", namespace: "ns-2" },
					{ application: "app-b", namespace: "ns-1" },
				],
			})

			const audits = await getAuditByEntity("application_auth_integration", id)
			expect(audits).toHaveLength(1)
		})

		it("re-kanoniserer eksisterende lagrede arrays ved sammenligning (no-op for legacy unsortert data)", async () => {
			const appId = await createTestApp("kiss-test-app-9")
			// Simuler legacy-rad skrevet før kanonisering ble innført — usortert
			// JSON i DB. Bypasser upsert og inserter direkte med usortert data.
			const db = getTestDb()
			await db.execute(
				/* sql */ `INSERT INTO application_auth_integrations (application_id, type, enabled, allow_all_users, groups, claims_extra, inbound_rules)
					VALUES ('${appId}', 'entra_id', true, false, '["group-z","group-a","group-m"]', '["c-z","c-a"]', '[{"application":"app-z","namespace":null,"cluster":null},{"application":"app-a","namespace":null,"cluster":null}]')`,
			)
			const id = await getAuthIntegrationId(appId, "entra_id")

			// Sync samme data (men i annen rekkefølge). Skal være no-op fordi
			// re-kanoniseringen normaliserer eksisterende verdier først.
			await upsertAppAuthIntegration(appId, "entra_id", {
				allowAllUsers: false,
				groups: ["group-a", "group-m", "group-z"],
				claimsExtra: ["c-a", "c-z"],
				inboundRules: [{ application: "app-a" }, { application: "app-z" }],
			})

			const audits = await getAuditByEntity("application_auth_integration", id)
			expect(audits).toHaveLength(0)
		})
	})
})
