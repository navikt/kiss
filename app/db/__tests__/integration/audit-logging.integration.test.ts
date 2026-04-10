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

const {
	getSectionAuditOverview,
	createAuditConfirmation,
	updateAuditConfirmation,
	revokeAuditConfirmation,
	getAuditConfirmationLog,
} = await import("~/db/queries/audit-logging.server")

describe("Audit logging integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	})

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM persistence_audit_confirmations;
			DELETE FROM persistence_audit_summaries;
			DELETE FROM audit_log;
			DELETE FROM application_persistence;
			DELETE FROM application_team_mappings;
			DELETE FROM application_environments;
			DELETE FROM monitored_applications;
			DELETE FROM nais_teams;
			DELETE FROM dev_teams;
			DELETE FROM clusters;
			DELETE FROM sections;
		`)
	})

	// ─── Helpers ──────────────────────────────────────────────────────

	async function createTestSection(name: string, slug: string) {
		const db = getTestDb()
		const result = await db.execute(
			/* sql */ `INSERT INTO sections (name, slug, created_by, updated_by) VALUES ('${name}', '${slug}', 'test', 'test') RETURNING id`,
		)
		return (result.rows[0] as Record<string, string>).id
	}

	async function createTestTeam(name: string, slug: string, sectionId: string) {
		const db = getTestDb()
		const result = await db.execute(
			/* sql */ `INSERT INTO dev_teams (name, slug, section_id, created_by, updated_by) VALUES ('${name}', '${slug}', '${sectionId}', 'test', 'test') RETURNING id`,
		)
		return (result.rows[0] as Record<string, string>).id
	}

	async function createTestApp(name: string) {
		const db = getTestDb()
		const result = await db.execute(
			/* sql */ `INSERT INTO monitored_applications (name, created_by, updated_by) VALUES ('${name}', 'test', 'test') RETURNING id`,
		)
		return (result.rows[0] as Record<string, string>).id
	}

	async function linkAppToTeam(appId: string, teamId: string) {
		const db = getTestDb()
		await db.execute(
			/* sql */ `INSERT INTO application_team_mappings (application_id, dev_team_id, created_by) VALUES ('${appId}', '${teamId}', 'test')`,
		)
	}

	async function createPersistence(appId: string, name: string, type: string) {
		const db = getTestDb()
		const result = await db.execute(
			/* sql */ `INSERT INTO application_persistence (application_id, name, type) VALUES ('${appId}', '${name}', '${type}') RETURNING id`,
		)
		return (result.rows[0] as Record<string, string>).id
	}

	async function insertSummary(persistenceId: string, conclusion: string) {
		const db = getTestDb()
		await db.execute(
			/* sql */ `INSERT INTO persistence_audit_summaries (persistence_id, conclusion, reason, fetched_at, last_sync_attempted_at, created_by, updated_by) VALUES ('${persistenceId}', '${conclusion}', 'Test reason', NOW(), NOW(), 'sync', 'sync')`,
		)
	}

	// ─── getSectionAuditOverview ─────────────────────────────────────

	describe("getSectionAuditOverview", () => {
		it("returns empty array for unknown section", async () => {
			const result = await getSectionAuditOverview("non-existent")
			expect(result).toEqual([])
		})

		it("returns databases for apps in the section", async () => {
			const sectionId = await createTestSection("Pensjon", "pensjon")
			const teamId = await createTestTeam("Backend", "backend", sectionId)
			const appId = await createTestApp("my-app")
			await linkAppToTeam(appId, teamId)
			await createPersistence(appId, "my-db", "cloud_sql_postgres")

			const result = await getSectionAuditOverview("pensjon")
			expect(result).toHaveLength(1)
			expect(result[0].appName).toBe("my-app")
			expect(result[0].persistenceName).toBe("my-db")
			expect(result[0].persistenceType).toBe("cloud_sql_postgres")
			expect(result[0].status).toBe("unknown")
		})

		it("excludes non-database types like bucket and valkey", async () => {
			const sectionId = await createTestSection("Pensjon", "pensjon")
			const teamId = await createTestTeam("Backend", "backend", sectionId)
			const appId = await createTestApp("my-app")
			await linkAppToTeam(appId, teamId)
			await createPersistence(appId, "my-bucket", "bucket")
			await createPersistence(appId, "my-cache", "valkey")
			await createPersistence(appId, "my-db", "oracle")

			const result = await getSectionAuditOverview("pensjon")
			expect(result).toHaveLength(1)
			expect(result[0].persistenceType).toBe("oracle")
		})

		it("includes Oracle summary data when available", async () => {
			const sectionId = await createTestSection("Pensjon", "pensjon")
			const teamId = await createTestTeam("Backend", "backend", sectionId)
			const appId = await createTestApp("oracle-app")
			await linkAppToTeam(appId, teamId)
			const persistenceId = await createPersistence(appId, "pen", "oracle")
			await insertSummary(persistenceId, "FULLSTENDIG")

			const result = await getSectionAuditOverview("pensjon")
			expect(result).toHaveLength(1)
			expect(result[0].status).toBe("active")
			expect(result[0].summary).not.toBeNull()
			expect(result[0].summary?.conclusion).toBe("FULLSTENDIG")
		})

		it("does not include apps from other sections", async () => {
			const section1Id = await createTestSection("Pensjon", "pensjon")
			const section2Id = await createTestSection("Helse", "helse")
			const team1Id = await createTestTeam("Team-P", "team-p", section1Id)
			const team2Id = await createTestTeam("Team-H", "team-h", section2Id)

			const app1Id = await createTestApp("app-pensjon")
			await linkAppToTeam(app1Id, team1Id)
			await createPersistence(app1Id, "db-p", "cloud_sql_postgres")

			const app2Id = await createTestApp("app-helse")
			await linkAppToTeam(app2Id, team2Id)
			await createPersistence(app2Id, "db-h", "cloud_sql_postgres")

			const result = await getSectionAuditOverview("pensjon")
			expect(result).toHaveLength(1)
			expect(result[0].appName).toBe("app-pensjon")
		})
	})

	// ─── createAuditConfirmation ────────────────────────────────────

	describe("createAuditConfirmation", () => {
		it("creates a confirmation and writes audit log", async () => {
			const sectionId = await createTestSection("Pensjon", "pensjon")
			const teamId = await createTestTeam("Backend", "backend", sectionId)
			const appId = await createTestApp("my-app")
			await linkAppToTeam(appId, teamId)
			const persistenceId = await createPersistence(appId, "my-db", "nais_postgres")

			const confirmation = await createAuditConfirmation({
				persistenceId,
				enabledAt: "2025-01-15",
				description: "Audit logging er aktivert via Nais config",
				evidenceUrl: "https://github.com/navikt/my-app/pull/42",
				performedBy: "T123456",
				metadata: { sectionSlug: "pensjon" },
			})

			expect(confirmation).toBeDefined()
			expect(confirmation.persistenceId).toBe(persistenceId)
			expect(confirmation.enabledAt).toBe("2025-01-15")
			expect(confirmation.confirmedBy).toBe("T123456")

			// Verify audit log
			const db = getTestDb()
			const auditResult = await db.execute(
				/* sql */ `SELECT * FROM audit_log WHERE action = 'audit_confirmation_created'`,
			)
			expect(auditResult.rows).toHaveLength(1)
			const auditRow = auditResult.rows[0] as Record<string, unknown>
			expect(auditRow.entity_id).toBe(confirmation.id)
			expect(auditRow.performed_by).toBe("T123456")
		})

		it("makes the overview show 'confirmed' status", async () => {
			const sectionId = await createTestSection("Pensjon", "pensjon")
			const teamId = await createTestTeam("Backend", "backend", sectionId)
			const appId = await createTestApp("my-app")
			await linkAppToTeam(appId, teamId)
			const persistenceId = await createPersistence(appId, "my-db", "on_prem_postgres")

			await createAuditConfirmation({
				persistenceId,
				enabledAt: "2025-01-15",
				description: "Manuelt bekreftet audit logging",
				evidenceUrl: "https://confluence.nav.no/display/PEN/audit",
				performedBy: "T123456",
			})

			const overview = await getSectionAuditOverview("pensjon")
			expect(overview).toHaveLength(1)
			expect(overview[0].status).toBe("confirmed")
			expect(overview[0].confirmation).not.toBeNull()
		})
	})

	// ─── updateAuditConfirmation ────────────────────────────────────

	describe("updateAuditConfirmation", () => {
		it("updates description and writes audit log with previous value", async () => {
			const sectionId = await createTestSection("Pensjon", "pensjon")
			const teamId = await createTestTeam("Backend", "backend", sectionId)
			const appId = await createTestApp("my-app")
			await linkAppToTeam(appId, teamId)
			const persistenceId = await createPersistence(appId, "my-db", "nais_postgres")

			const confirmation = await createAuditConfirmation({
				persistenceId,
				enabledAt: "2025-01-15",
				description: "Opprinnelig beskrivelse her",
				evidenceUrl: "https://github.com/navikt/test/pull/1",
				performedBy: "T123456",
			})

			const updated = await updateAuditConfirmation({
				confirmationId: confirmation.id,
				enabledAt: "2025-02-01",
				description: "Oppdatert beskrivelse med mer detaljer",
				evidenceUrl: "https://github.com/navikt/test/pull/2",
				performedBy: "T654321",
			})

			expect(updated.enabledAt).toBe("2025-02-01")
			expect(updated.description).toBe("Oppdatert beskrivelse med mer detaljer")

			// Verify audit log has previous value
			const db = getTestDb()
			const auditResult = await db.execute(
				/* sql */ `SELECT * FROM audit_log WHERE action = 'audit_confirmation_updated'`,
			)
			expect(auditResult.rows).toHaveLength(1)
			const auditRow = auditResult.rows[0] as Record<string, string>
			const prev = JSON.parse(auditRow.previous_value)
			expect(prev.description).toBe("Opprinnelig beskrivelse her")
		})

		it("throws when updating a revoked confirmation", async () => {
			const sectionId = await createTestSection("Pensjon", "pensjon")
			const teamId = await createTestTeam("Backend", "backend", sectionId)
			const appId = await createTestApp("my-app")
			await linkAppToTeam(appId, teamId)
			const persistenceId = await createPersistence(appId, "my-db", "nais_postgres")

			const confirmation = await createAuditConfirmation({
				persistenceId,
				enabledAt: "2025-01-15",
				description: "Skal tilbakekalles snart",
				evidenceUrl: "https://github.com/navikt/test/pull/1",
				performedBy: "T123456",
			})

			await revokeAuditConfirmation({
				confirmationId: confirmation.id,
				performedBy: "T654321",
			})

			await expect(
				updateAuditConfirmation({
					confirmationId: confirmation.id,
					enabledAt: "2025-03-01",
					description: "Prøver å oppdatere tilbakekalt",
					evidenceUrl: "https://github.com/navikt/test/pull/3",
					performedBy: "T999999",
				}),
			).rejects.toThrow(/revoked/)
		})
	})

	// ─── revokeAuditConfirmation ────────────────────────────────────

	describe("revokeAuditConfirmation", () => {
		it("revokes a confirmation and writes audit log", async () => {
			const sectionId = await createTestSection("Pensjon", "pensjon")
			const teamId = await createTestTeam("Backend", "backend", sectionId)
			const appId = await createTestApp("my-app")
			await linkAppToTeam(appId, teamId)
			const persistenceId = await createPersistence(appId, "my-db", "nais_postgres")

			const confirmation = await createAuditConfirmation({
				persistenceId,
				enabledAt: "2025-01-15",
				description: "Bekreftet audit logging",
				evidenceUrl: "https://github.com/navikt/test/pull/1",
				performedBy: "T123456",
			})

			const revoked = await revokeAuditConfirmation({
				confirmationId: confirmation.id,
				performedBy: "T654321",
			})

			expect(revoked.revokedAt).not.toBeNull()
			expect(revoked.revokedBy).toBe("T654321")

			// Overview should show 'unknown' again
			const overview = await getSectionAuditOverview("pensjon")
			expect(overview[0].status).toBe("unknown")
			expect(overview[0].confirmation).toBeNull()
		})

		it("throws when revoking an already-revoked confirmation", async () => {
			const sectionId = await createTestSection("Pensjon", "pensjon")
			const teamId = await createTestTeam("Backend", "backend", sectionId)
			const appId = await createTestApp("my-app")
			await linkAppToTeam(appId, teamId)
			const persistenceId = await createPersistence(appId, "my-db", "nais_postgres")

			const confirmation = await createAuditConfirmation({
				persistenceId,
				enabledAt: "2025-01-15",
				description: "Bekreftet audit logging",
				evidenceUrl: "https://github.com/navikt/test/pull/1",
				performedBy: "T123456",
			})

			await revokeAuditConfirmation({
				confirmationId: confirmation.id,
				performedBy: "T654321",
			})

			await expect(
				revokeAuditConfirmation({
					confirmationId: confirmation.id,
					performedBy: "T999999",
				}),
			).rejects.toThrow(/already revoked/)
		})

		it("allows creating a new confirmation after revocation", async () => {
			const sectionId = await createTestSection("Pensjon", "pensjon")
			const teamId = await createTestTeam("Backend", "backend", sectionId)
			const appId = await createTestApp("my-app")
			await linkAppToTeam(appId, teamId)
			const persistenceId = await createPersistence(appId, "my-db", "nais_postgres")

			const first = await createAuditConfirmation({
				persistenceId,
				enabledAt: "2025-01-15",
				description: "Første bekreftelse som tilbakekalles",
				evidenceUrl: "https://github.com/navikt/test/pull/1",
				performedBy: "T123456",
			})

			await revokeAuditConfirmation({
				confirmationId: first.id,
				performedBy: "T654321",
			})

			// Should be able to create a new confirmation for the same persistence
			const second = await createAuditConfirmation({
				persistenceId,
				enabledAt: "2025-06-01",
				description: "Ny bekreftelse etter tilbakekalling",
				evidenceUrl: "https://github.com/navikt/test/pull/5",
				performedBy: "T111111",
			})

			expect(second.id).not.toBe(first.id)

			const overview = await getSectionAuditOverview("pensjon")
			expect(overview[0].status).toBe("confirmed")
			expect(overview[0].confirmation?.id).toBe(second.id)
		})
	})

	// ─── getAuditConfirmationLog ────────────────────────────────────

	describe("getAuditConfirmationLog", () => {
		it("returns audit log entries scoped to a section", async () => {
			const section1Id = await createTestSection("Pensjon", "pensjon")
			const section2Id = await createTestSection("Helse", "helse")
			const team1Id = await createTestTeam("Team-P", "team-p", section1Id)
			const team2Id = await createTestTeam("Team-H", "team-h", section2Id)

			const app1Id = await createTestApp("app-pensjon")
			await linkAppToTeam(app1Id, team1Id)
			const p1Id = await createPersistence(app1Id, "db-p", "nais_postgres")

			const app2Id = await createTestApp("app-helse")
			await linkAppToTeam(app2Id, team2Id)
			const p2Id = await createPersistence(app2Id, "db-h", "nais_postgres")

			await createAuditConfirmation({
				persistenceId: p1Id,
				enabledAt: "2025-01-01",
				description: "Pensjon confirmation test",
				evidenceUrl: "https://github.com/navikt/pen/pull/1",
				performedBy: "T111111",
			})

			await createAuditConfirmation({
				persistenceId: p2Id,
				enabledAt: "2025-01-01",
				description: "Helse confirmation test data",
				evidenceUrl: "https://github.com/navikt/helse/pull/1",
				performedBy: "T222222",
			})

			const pensjonLog = await getAuditConfirmationLog("pensjon")
			expect(pensjonLog).toHaveLength(1)
			expect(pensjonLog[0].performedBy).toBe("T111111")

			const helseLog = await getAuditConfirmationLog("helse")
			expect(helseLog).toHaveLength(1)
			expect(helseLog[0].performedBy).toBe("T222222")
		})

		it("returns empty array for section with no confirmations", async () => {
			await createTestSection("Tom", "tom")
			const result = await getAuditConfirmationLog("tom")
			expect(result).toEqual([])
		})
	})
})
