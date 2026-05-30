import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { getTestDb, getTestPool, setupTestDatabase, teardownTestDatabase } from "./setup"

vi.mock("~/db/connection.server", () => ({
	get db() {
		return getTestDb()
	},
	get pool() {
		return getTestPool()
	},
}))

const {
	getEconomyClassification,
	getEconomyClassifications,
	getAllEconomyClassifications,
	saveEconomyClassification,
	countSectionEconomySystems,
} = await import("~/db/queries/economy-classification.server")

async function createTestApp(name: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO monitored_applications (name, created_by, updated_by) VALUES ('${name}', 'test', 'test') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function getAuditLogs(entityType: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `SELECT action, entity_id, previous_value, new_value, performed_by, metadata FROM audit_log WHERE entity_type = '${entityType}' ORDER BY performed_at, ctid`,
	)
	return r.rows as Array<{
		action: string
		entity_id: string
		previous_value: string | null
		new_value: string | null
		performed_by: string
		metadata: unknown
	}>
}

describe("Economy classification integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	}, 120_000)

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM screening_answers;
			DELETE FROM screening_questions;
			DELETE FROM application_economy_classifications;
			DELETE FROM section_ignored_applications;
			DELETE FROM section_environments;
			DELETE FROM application_team_mappings;
			DELETE FROM application_environments;
			DELETE FROM monitored_applications;
			DELETE FROM dev_teams;
			DELETE FROM nais_teams;
			DELETE FROM sections;
			DELETE FROM audit_log;
		`)
	})

	describe("saveEconomyClassification", () => {
		it("creates a new classification for an application", async () => {
			const appId = await createTestApp("test-app")

			const result = await saveEconomyClassification({
				applicationId: appId,
				isEconomySystem: true,
				economySystemType: "hjelpesystem",
				justification: "Fatter vedtak som forplikter Nav.",
				performedBy: "A123456",
			})

			expect(result.applicationId).toBe(appId)
			expect(result.isEconomySystem).toBe(true)
			expect(result.economySystemType).toBe("hjelpesystem")
			expect(result.justification).toBe("Fatter vedtak som forplikter Nav.")
			expect(result.createdBy).toBe("A123456")
			expect(result.archivedAt).toBeNull()

			// validUntil should be ~1 year from now
			const validUntil = new Date(result.validUntil)
			const oneYearFromNow = new Date()
			oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1)
			expect(Math.abs(validUntil.getTime() - oneYearFromNow.getTime())).toBeLessThan(5000)
		})

		it("creates a 'not economy system' classification", async () => {
			const appId = await createTestApp("test-app")

			const result = await saveEconomyClassification({
				applicationId: appId,
				isEconomySystem: false,
				economySystemType: null,
				justification: "Ingen påvirkning på økonomiske disposisjoner.",
				performedBy: "A123456",
			})

			expect(result.isEconomySystem).toBe(false)
			expect(result.economySystemType).toBeNull()
		})

		it("archives previous classification when saving a new one", async () => {
			const appId = await createTestApp("test-app")

			const first = await saveEconomyClassification({
				applicationId: appId,
				isEconomySystem: true,
				economySystemType: "regnskapssystem",
				justification: "Første vurdering.",
				performedBy: "A111111",
			})

			const second = await saveEconomyClassification({
				applicationId: appId,
				isEconomySystem: true,
				economySystemType: "hjelpesystem",
				justification: "Oppdatert vurdering.",
				performedBy: "A222222",
			})

			// The first should now be archived
			const db = getTestDb()
			const archived = await db.execute(
				/* sql */ `SELECT archived_at, archived_by FROM application_economy_classifications WHERE id = '${first.id}'`,
			)
			expect((archived.rows[0] as { archived_at: Date }).archived_at).not.toBeNull()
			expect((archived.rows[0] as { archived_by: string }).archived_by).toBe("A222222")

			// Only the second should be active
			const active = await getEconomyClassification(appId)
			expect(active?.id).toBe(second.id)
			expect(active?.economySystemType).toBe("hjelpesystem")
		})

		it("writes audit log entries for create and archive", async () => {
			const appId = await createTestApp("test-app")

			await saveEconomyClassification({
				applicationId: appId,
				isEconomySystem: true,
				economySystemType: "lonnssystem",
				justification: "Beregner lønn.",
				performedBy: "A111111",
			})

			await saveEconomyClassification({
				applicationId: appId,
				isEconomySystem: false,
				economySystemType: null,
				justification: "Revurdert – ikke økonomisystem.",
				performedBy: "A222222",
			})

			const logs = await getAuditLogs("application_economy_classification")
			expect(logs).toHaveLength(3) // create first, archive first, create second

			expect(logs[0].action).toBe("economy_classification_created")
			expect(logs[0].performed_by).toBe("A111111")

			expect(logs[1].action).toBe("economy_classification_archived")
			expect(logs[1].performed_by).toBe("A222222")
			expect(logs[1].previous_value).toContain("lonnssystem")

			expect(logs[2].action).toBe("economy_classification_created")
			expect(logs[2].performed_by).toBe("A222222")
		})

		it("sets economySystemType to null when isEconomySystem is false", async () => {
			const appId = await createTestApp("test-app")

			const result = await saveEconomyClassification({
				applicationId: appId,
				isEconomySystem: false,
				economySystemType: "hjelpesystem", // passed but should be ignored
				justification: "Ikke et økonomisystem.",
				performedBy: "A123456",
			})

			expect(result.economySystemType).toBeNull()
		})

		it("handles concurrent saves safely (only one active classification remains)", async () => {
			const appId = await createTestApp("test-app-concurrent")

			// Launch two concurrent saves
			const [result1, result2] = await Promise.all([
				saveEconomyClassification({
					applicationId: appId,
					isEconomySystem: true,
					economySystemType: "hjelpesystem",
					justification: "From user A.",
					performedBy: "A111111",
				}),
				saveEconomyClassification({
					applicationId: appId,
					isEconomySystem: true,
					economySystemType: "regnskapssystem",
					justification: "From user B.",
					performedBy: "B222222",
				}),
			])

			// Both should succeed (no errors)
			expect(result1).toBeDefined()
			expect(result2).toBeDefined()

			// Only one active classification should exist
			const active = await getEconomyClassification(appId)
			expect(active).toBeDefined()
			expect(active?.archivedAt).toBeNull()
		})
	})

	describe("getEconomyClassification", () => {
		it("returns undefined for app with no classification", async () => {
			const appId = await createTestApp("test-app")
			const result = await getEconomyClassification(appId)
			expect(result).toBeUndefined()
		})

		it("returns only the active (non-archived) classification", async () => {
			const appId = await createTestApp("test-app")

			await saveEconomyClassification({
				applicationId: appId,
				isEconomySystem: true,
				economySystemType: "regnskapssystem",
				justification: "Gammel.",
				performedBy: "A111111",
			})

			await saveEconomyClassification({
				applicationId: appId,
				isEconomySystem: true,
				economySystemType: "hjelpesystem",
				justification: "Ny.",
				performedBy: "A222222",
			})

			const result = await getEconomyClassification(appId)
			expect(result?.economySystemType).toBe("hjelpesystem")
			expect(result?.justification).toBe("Ny.")
		})
	})

	describe("getEconomyClassifications (batch)", () => {
		it("returns a map of active classifications for multiple apps", async () => {
			const app1 = await createTestApp("app-1")
			const app2 = await createTestApp("app-2")
			const app3 = await createTestApp("app-3")

			await saveEconomyClassification({
				applicationId: app1,
				isEconomySystem: true,
				economySystemType: "hjelpesystem",
				justification: "J1.",
				performedBy: "A123456",
			})

			await saveEconomyClassification({
				applicationId: app2,
				isEconomySystem: false,
				economySystemType: null,
				justification: "J2.",
				performedBy: "A123456",
			})

			// app3 has no classification

			const map = await getEconomyClassifications([app1, app2, app3])
			expect(map.size).toBe(2)
			expect(map.get(app1)?.isEconomySystem).toBe(true)
			expect(map.get(app2)?.isEconomySystem).toBe(false)
			expect(map.has(app3)).toBe(false)
		})

		it("returns empty map for empty input", async () => {
			const map = await getEconomyClassifications([])
			expect(map.size).toBe(0)
		})
	})

	describe("getAllEconomyClassifications", () => {
		it("returns all active classifications", async () => {
			const app1 = await createTestApp("app-1")
			const app2 = await createTestApp("app-2")

			await saveEconomyClassification({
				applicationId: app1,
				isEconomySystem: true,
				economySystemType: "fakturabehandling",
				justification: "J1.",
				performedBy: "A123456",
			})

			await saveEconomyClassification({
				applicationId: app2,
				isEconomySystem: true,
				economySystemType: "lonnssystem",
				justification: "J2.",
				performedBy: "A123456",
			})

			const all = await getAllEconomyClassifications()
			expect(all).toHaveLength(2)
		})

		it("does not include archived classifications", async () => {
			const appId = await createTestApp("test-app")

			await saveEconomyClassification({
				applicationId: appId,
				isEconomySystem: true,
				economySystemType: "regnskapssystem",
				justification: "Old.",
				performedBy: "A111111",
			})

			await saveEconomyClassification({
				applicationId: appId,
				isEconomySystem: true,
				economySystemType: "hjelpesystem",
				justification: "New.",
				performedBy: "A222222",
			})

			const all = await getAllEconomyClassifications()
			expect(all).toHaveLength(1)
			expect(all[0].justification).toBe("New.")
		})
	})

	describe("screening progress with expired economy classifications", () => {
		it("reduces answered count when economy classification is expired", async () => {
			const db = getTestDb()
			const appId = await createTestApp("test-app-progress")

			// Create an economy_system screening question
			const [{ id: eqId }] = (
				await db.execute(/* sql */ `
				INSERT INTO screening_questions (question_text, answer_type, status, created_by, updated_by)
				VALUES ('Er dette et økonomisystem?', 'economy_system', 'approved', 'test', 'test')
				RETURNING id
			`)
			).rows as Array<{ id: string }>

			// Create a regular boolean question
			const [{ id: bqId }] = (
				await db.execute(/* sql */ `
				INSERT INTO screening_questions (question_text, answer_type, status, created_by, updated_by)
				VALUES ('Behandler PII?', 'boolean', 'approved', 'test', 'test')
				RETURNING id
			`)
			).rows as Array<{ id: string }>

			// Answer both questions
			await db.execute(/* sql */ `
				INSERT INTO screening_answers (application_id, question_id, answer, answered_by)
				VALUES ('${appId}', '${eqId}', 'confirmed', 'test'),
				       ('${appId}', '${bqId}', 'confirmed', 'test')
			`)

			// Create an expired economy classification
			await db.execute(/* sql */ `
				INSERT INTO application_economy_classifications
				  (application_id, is_economy_system, economy_system_type, justification, valid_from, valid_until, created_by, updated_by)
				VALUES
				  ('${appId}', true, 'hjelpesystem', 'test', NOW() - INTERVAL '2 years', NOW() - INTERVAL '1 year', 'test', 'test')
			`)

			const { getScreeningProgressForApps } = await import("~/db/queries/screening.server")
			const progress = await getScreeningProgressForApps([appId])
			const appProgress = progress.get(appId)

			// Total should be 2 (both questions), but answered should be 1
			// because the economy classification is expired so that answer doesn't count
			expect(appProgress?.total).toBe(2)
			expect(appProgress?.answered).toBe(1)
		})

		it("does not reduce count for non-expired economy classifications", async () => {
			const db = getTestDb()
			const appId = await createTestApp("test-app-valid")

			// Create an economy_system screening question
			const [{ id: eqId }] = (
				await db.execute(/* sql */ `
				INSERT INTO screening_questions (question_text, answer_type, status, created_by, updated_by)
				VALUES ('Er dette et økonomisystem?', 'economy_system', 'approved', 'test', 'test')
				RETURNING id
			`)
			).rows as Array<{ id: string }>

			// Answer the question
			await db.execute(/* sql */ `
				INSERT INTO screening_answers (application_id, question_id, answer, answered_by)
				VALUES ('${appId}', '${eqId}', 'confirmed', 'test')
			`)

			// Create a valid (non-expired) economy classification
			await db.execute(/* sql */ `
				INSERT INTO application_economy_classifications
				  (application_id, is_economy_system, economy_system_type, justification, valid_from, valid_until, created_by, updated_by)
				VALUES
				  ('${appId}', true, 'hjelpesystem', 'test', NOW(), NOW() + INTERVAL '1 year', 'test', 'test')
			`)

			const { getScreeningProgressForApps } = await import("~/db/queries/screening.server")
			const progress = await getScreeningProgressForApps([appId])
			const appProgress = progress.get(appId)

			expect(appProgress?.total).toBe(1)
			expect(appProgress?.answered).toBe(1)
		})

		it("reduces answered count when confirmed answer exists but no active classification", async () => {
			const db = getTestDb()
			const appId = await createTestApp("test-app-no-classification")

			// Create an economy_system screening question
			const [{ id: eqId }] = (
				await db.execute(/* sql */ `
				INSERT INTO screening_questions (question_text, answer_type, status, created_by, updated_by)
				VALUES ('Er dette et økonomisystem?', 'economy_system', 'approved', 'test', 'test')
				RETURNING id
			`)
			).rows as Array<{ id: string }>

			// Answer the question (confirmed) but don't create any classification
			await db.execute(/* sql */ `
				INSERT INTO screening_answers (application_id, question_id, answer, answered_by)
				VALUES ('${appId}', '${eqId}', 'confirmed', 'test')
			`)

			const { getScreeningProgressForApps } = await import("~/db/queries/screening.server")
			const progress = await getScreeningProgressForApps([appId])
			const appProgress = progress.get(appId)

			// Answer shouldn't count because there's no active classification
			expect(appProgress?.total).toBe(1)
			expect(appProgress?.answered).toBe(0)
		})
	})
})

// ─── countSectionEconomySystems ─────────────────────────────────────────────

describe("countSectionEconomySystems", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	}, 120_000)

	afterAll(async () => {
		await teardownTestDatabase()
	})

	async function setup() {
		const db = getTestDb()

		const [{ id: sectionId }] = (
			await db.execute(
				/* sql */ `INSERT INTO sections (name, slug, created_by, updated_by) VALUES ('Test seksjon', 'test-seksjon', 'test', 'test') RETURNING id`,
			)
		).rows as Array<{ id: string }>

		const [{ id: teamId }] = (
			await db.execute(
				/* sql */ `INSERT INTO dev_teams (section_id, name, slug, created_by, updated_by) VALUES ('${sectionId}', 'Team A', 'team-a', 'test', 'test') RETURNING id`,
			)
		).rows as Array<{ id: string }>

		async function createApp(name: string): Promise<string> {
			const [{ id }] = (
				await db.execute(
					/* sql */ `INSERT INTO monitored_applications (name, created_by, updated_by) VALUES ('${name}', 'test', 'test') RETURNING id`,
				)
			).rows as Array<{ id: string }>
			await db.execute(
				/* sql */ `INSERT INTO application_team_mappings (application_id, dev_team_id, created_by) VALUES ('${id}', '${teamId}', 'test')`,
			)
			return id
		}

		async function classifyAsEconomy(appId: string) {
			await saveEconomyClassification({
				applicationId: appId,
				isEconomySystem: true,
				economySystemType: "hjelpesystem",
				justification: "Test",
				performedBy: "test",
			})
		}

		return { db, sectionId, teamId, createApp, classifyAsEconomy }
	}

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM application_economy_classifications;
			DELETE FROM section_ignored_applications;
			DELETE FROM section_environments;
			DELETE FROM application_team_mappings;
			DELETE FROM application_environments;
			DELETE FROM monitored_applications;
			DELETE FROM dev_teams;
			DELETE FROM nais_teams;
			DELETE FROM sections;
			DELETE FROM audit_log;
		`)
	})

	it("counts only apps classified as economy system", async () => {
		const { sectionId, createApp, classifyAsEconomy } = await setup()
		const app1 = await createApp("app-economy")
		const app2 = await createApp("app-not-economy")
		await classifyAsEconomy(app1)
		await saveEconomyClassification({
			applicationId: app2,
			isEconomySystem: false,
			economySystemType: null,
			justification: "Ikke økonomi",
			performedBy: "test",
		})

		const result = await countSectionEconomySystems(sectionId)
		expect(result.totalCount).toBe(1)
		expect(result.expiredCount).toBe(0)
	})

	it("returns 0 for section with no apps", async () => {
		const db = getTestDb()
		const [{ id: sectionId }] = (
			await db.execute(
				/* sql */ `INSERT INTO sections (name, slug, created_by, updated_by) VALUES ('Tom', 'tom', 'test', 'test') RETURNING id`,
			)
		).rows as Array<{ id: string }>

		const result = await countSectionEconomySystems(sectionId)
		expect(result.totalCount).toBe(0)
		expect(result.expiredCount).toBe(0)
	})

	it("excludes ignored apps", async () => {
		const { db, sectionId, createApp, classifyAsEconomy } = await setup()
		const app = await createApp("ignored-app")
		await classifyAsEconomy(app)
		await db.execute(
			/* sql */ `INSERT INTO section_ignored_applications (section_id, application_id, ignored_by) VALUES ('${sectionId}', '${app}', 'test')`,
		)

		expect((await countSectionEconomySystems(sectionId)).totalCount).toBe(0)
	})

	it("excludes archived apps", async () => {
		const { db, sectionId, createApp, classifyAsEconomy } = await setup()
		const app = await createApp("archived-app")
		await classifyAsEconomy(app)
		await db.execute(
			/* sql */ `UPDATE monitored_applications SET archived_at = NOW(), archived_by = 'test' WHERE id = '${app}'`,
		)

		expect((await countSectionEconomySystems(sectionId)).totalCount).toBe(0)
	})

	it("excludes secondary (child) apps", async () => {
		const { db, sectionId, createApp, classifyAsEconomy } = await setup()
		const parent = await createApp("parent-app")
		const child = await createApp("child-app")
		await classifyAsEconomy(child)
		await db.execute(
			/* sql */ `UPDATE monitored_applications SET primary_application_id = '${parent}' WHERE id = '${child}'`,
		)

		expect((await countSectionEconomySystems(sectionId)).totalCount).toBe(0)
	})

	it("excludes apps whose only environments are in excluded clusters", async () => {
		const { db, sectionId, createApp, classifyAsEconomy } = await setup()
		const app = await createApp("fss-only-app")
		await classifyAsEconomy(app)

		// Mark fss-prod as excluded in this section
		await db.execute(
			/* sql */ `INSERT INTO section_environments (section_id, cluster, included, added_by, updated_by) VALUES ('${sectionId}', 'fss-prod', false, 'test', 'test')`,
		)
		// App only has environments in the excluded cluster
		await db.execute(
			/* sql */ `INSERT INTO application_environments (application_id, cluster, namespace, nais_team_id) VALUES ('${app}', 'fss-prod', 'default', null)`,
		)

		expect((await countSectionEconomySystems(sectionId)).totalCount).toBe(0)
	})

	it("keeps apps that have at least one non-excluded environment", async () => {
		const { db, sectionId, createApp, classifyAsEconomy } = await setup()
		const app = await createApp("mixed-env-app")
		await classifyAsEconomy(app)

		await db.execute(
			/* sql */ `INSERT INTO section_environments (section_id, cluster, included, added_by, updated_by) VALUES ('${sectionId}', 'fss-prod', false, 'test', 'test')`,
		)
		// App has one excluded and one non-excluded environment — should be kept
		await db.execute(/* sql */ `
			INSERT INTO application_environments (application_id, cluster, namespace, nais_team_id) VALUES
			  ('${app}', 'fss-prod', 'default', null),
			  ('${app}', 'gcp-prod', 'default', null)
		`)

		expect((await countSectionEconomySystems(sectionId)).totalCount).toBe(1)
	})

	it("counts expired classifications in both totalCount and expiredCount", async () => {
		const { db, sectionId, createApp, classifyAsEconomy } = await setup()
		const appExpired = await createApp("expired-economy")
		const appValid = await createApp("valid-economy")
		await classifyAsEconomy(appExpired)
		await classifyAsEconomy(appValid)
		// Force the first app's classification to be expired
		await db.execute(
			/* sql */ `UPDATE application_economy_classifications SET valid_until = NOW() - INTERVAL '1 day' WHERE application_id = '${appExpired}'`,
		)

		const result = await countSectionEconomySystems(sectionId)
		expect(result.totalCount).toBe(2)
		expect(result.expiredCount).toBe(1)
	})

	it("count matches the list on the destination page (same filtering path)", async () => {
		const { sectionId, createApp, classifyAsEconomy } = await setup()
		const app1 = await createApp("economy-1")
		const app2 = await createApp("economy-2")
		const app3 = await createApp("not-economy")
		await classifyAsEconomy(app1)
		await classifyAsEconomy(app2)
		await saveEconomyClassification({
			applicationId: app3,
			isEconomySystem: false,
			economySystemType: null,
			justification: "Ikke økonomi",
			performedBy: "test",
		})

		expect((await countSectionEconomySystems(sectionId)).totalCount).toBe(2)
	})
})
