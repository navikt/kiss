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

const { syncDiscoveredApps, resolveAppNames, upsertNaisTeam } = await import("~/db/queries/nais.server")

async function getActiveDiscovered(teamSlug: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `SELECT d.name, d.archived_at FROM nais_discovered_apps d
			JOIN nais_teams t ON t.id = d.nais_team_id
			WHERE t.slug = '${teamSlug}' AND d.archived_at IS NULL
			ORDER BY d.name`,
	)
	return r.rows as Array<{ name: string; archived_at: unknown }>
}

async function getAllDiscovered(teamSlug: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `SELECT d.id, d.name, d.archived_at, d.archived_by FROM nais_discovered_apps d
			JOIN nais_teams t ON t.id = d.nais_team_id
			WHERE t.slug = '${teamSlug}'
			ORDER BY d.name, d.discovered_at`,
	)
	return r.rows as Array<{ id: string; name: string; archived_at: unknown; archived_by: string | null }>
}

async function getAuditByEntity(entityType: string, entityId: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `SELECT action, previous_value, new_value, performed_by FROM audit_log
			WHERE entity_type = '${entityType}' AND entity_id = '${entityId}'
			ORDER BY performed_at, action`,
	)
	return r.rows as Array<{
		action: string
		previous_value: string | null
		new_value: string | null
		performed_by: string
	}>
}

describe("nais_discovered_apps soft-delete + audit konsistens", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	}, 120_000)

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM nais_discovered_apps;
			DELETE FROM nais_teams;
			DELETE FROM audit_log;
		`)
	})

	it("inserts new discovered apps and writes one audit per app", async () => {
		await upsertNaisTeam("team-a", "Team A", 2)
		await syncDiscoveredApps("team-a", ["app-1", "app-2"])

		const active = await getActiveDiscovered("team-a")
		expect(active.map((r) => r.name)).toEqual(["app-1", "app-2"])

		const audit = await getAuditByEntity("nais_team", "team-a")
		expect(audit).toHaveLength(2)
		expect(audit.every((a) => a.action === "nais_discovered_app_added")).toBe(true)
		expect(audit.every((a) => a.performed_by === "nais-sync")).toBe(true)
	})

	it("archives apps that disappear from a subsequent sync", async () => {
		await upsertNaisTeam("team-b", "Team B", 2)
		await syncDiscoveredApps("team-b", ["app-1", "app-2"])
		await syncDiscoveredApps("team-b", ["app-1"])

		const active = await getActiveDiscovered("team-b")
		expect(active.map((r) => r.name)).toEqual(["app-1"])

		const all = await getAllDiscovered("team-b")
		expect(all).toHaveLength(2)
		const archivedRow = all.find((r) => r.name === "app-2")
		expect(archivedRow?.archived_at).not.toBeNull()
		expect(archivedRow?.archived_by).toBe("nais-sync")

		const audit = await getAuditByEntity("nais_team", "team-b")
		const archived = audit.filter((a) => a.action === "nais_discovered_app_archived")
		expect(archived).toHaveLength(1)
		expect(archived[0].previous_value).toBe(JSON.stringify({ name: "app-2" }))
	})

	it("revives a previously archived app and reuses the same row", async () => {
		await upsertNaisTeam("team-c", "Team C", 1)
		await syncDiscoveredApps("team-c", ["app-x"])
		await syncDiscoveredApps("team-c", [])
		await syncDiscoveredApps("team-c", ["app-x"])

		const all = await getAllDiscovered("team-c")
		expect(all).toHaveLength(1)
		expect(all[0].archived_at).toBeNull()

		const audit = await getAuditByEntity("nais_team", "team-c")
		const added = audit.filter((a) => a.action === "nais_discovered_app_added")
		const archived = audit.filter((a) => a.action === "nais_discovered_app_archived")
		expect(added).toHaveLength(2)
		expect(archived).toHaveLength(1)
		expect(added[1].new_value).toBe(JSON.stringify({ name: "app-x", revived: true }))
	})

	it("idempotent re-discovery writes no audit when nothing changes", async () => {
		await upsertNaisTeam("team-d", "Team D", 2)
		await syncDiscoveredApps("team-d", ["app-1", "app-2"])
		const before = await getAuditByEntity("nais_team", "team-d")
		expect(before).toHaveLength(2)

		await syncDiscoveredApps("team-d", ["app-1", "app-2"])
		const after = await getAuditByEntity("nais_team", "team-d")
		expect(after).toHaveLength(2)
	})

	it("resolveAppNames excludes archived discovered apps", async () => {
		await upsertNaisTeam("team-e", "Team E", 2)
		await syncDiscoveredApps("team-e", ["app-keep", "app-gone"])
		await syncDiscoveredApps("team-e", ["app-keep"])

		const result = await resolveAppNames(["app-keep", "app-gone", "unknown"])
		expect(result["app-keep"]).toEqual({ status: "discovered" })
		expect(result["app-gone"]).toEqual({ status: "unknown" })
		expect(result.unknown).toEqual({ status: "unknown" })
	})

	it("partial unique index permits an archived row alongside an active row for same (name, team)", async () => {
		await upsertNaisTeam("team-f", "Team F", 1)
		await syncDiscoveredApps("team-f", ["app-y"])
		await syncDiscoveredApps("team-f", [])

		// Manually demote revival path — insert as fresh row to simulate parallel re-discovery
		// after archival. Skal lykkes uten unique-violation siden eksisterende rad er arkivert.
		const db = getTestDb()
		const teamRow = await db.execute(/* sql */ `SELECT id FROM nais_teams WHERE slug = 'team-f'`)
		const teamId = (teamRow.rows[0] as { id: string }).id
		await db.execute(/* sql */ `INSERT INTO nais_discovered_apps (name, nais_team_id) VALUES ('app-y', '${teamId}')`)

		const all = await getAllDiscovered("team-f")
		expect(all).toHaveLength(2)
		const active = all.filter((r) => r.archived_at === null)
		expect(active).toHaveLength(1)
	})

	it("partial unique index prevents two active rows for same (name, team)", async () => {
		await upsertNaisTeam("team-g", "Team G", 1)
		await syncDiscoveredApps("team-g", ["app-z"])

		const db = getTestDb()
		const teamRow = await db.execute(/* sql */ `SELECT id FROM nais_teams WHERE slug = 'team-g'`)
		const teamId = (teamRow.rows[0] as { id: string }).id

		await expect(
			db.execute(/* sql */ `INSERT INTO nais_discovered_apps (name, nais_team_id) VALUES ('app-z', '${teamId}')`),
		).rejects.toThrow()
	})

	it("archive + audit kjører atomisk i samme transaksjon", async () => {
		await upsertNaisTeam("team-h", "Team H", 1)
		await syncDiscoveredApps("team-h", ["app-1"])

		await syncDiscoveredApps("team-h", [])

		const all = await getAllDiscovered("team-h")
		expect(all).toHaveLength(1)
		expect(all[0].archived_at).not.toBeNull()

		const audit = await getAuditByEntity("nais_team", "team-h")
		expect(audit.filter((a) => a.action === "nais_discovered_app_archived")).toHaveLength(1)
	})
})
