import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ParsedFramework } from "~/lib/excel-parser.server"
import { getTestDb, setupTestDatabase, teardownTestDatabase } from "./setup"

vi.mock("~/db/connection.server", () => ({
	get db() {
		return getTestDb()
	},
	get pool() {
		return null
	},
}))

const { stageFrameworkImport, applyFrameworkImport } = await import("~/db/queries/framework.server")
const {
	updateControlComment,
	getControlHistory,
	getActiveApplicationControls,
	getBatchComplianceStats,
	getComplianceSummaries,
} = await import("~/db/queries/application-controls.server")

function makeParsedFramework(): ParsedFramework {
	return {
		sheetName: "Rammeverk",
		rows: [
			{
				domain: "Teknisk sikkerhet",
				riskId: "R-TS.01",
				riskDescription: "Uautorisert tilgang",
				controlId: "K-TS.01",
				technologyElement: null,
				requirement: "MFA påkrevd",
				responsible: "IT",
				routine: "Kvartalsvis",
				frequency: "Kvartalsvis",
				documentationRequirement: "MFA-logg",
				testProcedure: "Verifiser MFA",
				dependencies: null,
				references: null,
				commonPitfalls: null,
			},
			{
				domain: "Teknisk sikkerhet",
				riskId: "R-TS.01",
				riskDescription: "Uautorisert tilgang",
				controlId: "K-TS.02",
				technologyElement: null,
				requirement: "Tilgangskontroll",
				responsible: "IT",
				routine: "Månedlig",
				frequency: "Månedlig",
				documentationRequirement: "Tilgangslogg",
				testProcedure: "Verifiser tilganger",
				dependencies: null,
				references: null,
				commonPitfalls: null,
			},
		],
	}
}

async function createTestApp(name: string): Promise<string> {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO monitored_applications (name, created_by, updated_by)
		VALUES ('${name}', 'test', 'test') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function getControlUuids(): Promise<string[]> {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `SELECT id FROM framework_controls WHERE archived_at IS NULL ORDER BY control_id`,
	)
	return (result.rows as Array<{ id: string }>).map((r) => r.id)
}

async function insertApplicationControl(
	appId: string,
	controlId: string,
	status: string,
	isActive = true,
): Promise<string> {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO application_controls
		(application_id, control_id, status, is_active, activated_at, created_by, updated_by)
		VALUES ('${appId}', '${controlId}', '${status}', ${isActive}, NOW(), 'test', 'test')
		RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

describe("Application controls integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	})

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM application_control_history;
			DELETE FROM application_controls;
			DELETE FROM compliance_assessment_history;
			DELETE FROM compliance_assessments;
			DELETE FROM application_team_mappings;
			DELETE FROM application_environments;
			DELETE FROM monitored_applications;
			DELETE FROM framework_field_history;
			DELETE FROM control_technology_elements;
			DELETE FROM framework_risk_control_mappings;
			DELETE FROM framework_controls;
			DELETE FROM framework_risks;
			DELETE FROM framework_domains;
			DELETE FROM framework_versions;
			DELETE FROM audit_log;
		`)

		const parsed = makeParsedFramework()
		const versionId = await stageFrameworkImport(parsed, "test.xlsx", "user", "/uploads/test.xlsx")
		await applyFrameworkImport(versionId, parsed, "admin")
	})

	describe("updateControlComment", () => {
		it("should save a comment on an application control", async () => {
			const appId = await createTestApp("Test App")
			const [controlId] = await getControlUuids()
			const acId = await insertApplicationControl(appId, controlId, "not_implemented")

			await updateControlComment(acId, "Trenger oppfølging", "user1")

			const controls = await getActiveApplicationControls(appId)
			expect(controls).toHaveLength(1)
			expect(controls[0].comment).toBe("Trenger oppfølging")
			expect(controls[0].commentUpdatedBy).toBe("user1")
			expect(controls[0].commentUpdatedAt).not.toBeNull()
		})

		it("should clear a comment when set to null", async () => {
			const appId = await createTestApp("Test App")
			const [controlId] = await getControlUuids()
			const acId = await insertApplicationControl(appId, controlId, "implemented")

			await updateControlComment(acId, "First comment", "user1")
			await updateControlComment(acId, null, "user2")

			const controls = await getActiveApplicationControls(appId)
			expect(controls[0].comment).toBeNull()
			expect(controls[0].commentUpdatedBy).toBe("user2")
		})

		it("should create history entries for comment changes", async () => {
			const appId = await createTestApp("Test App")
			const [controlId] = await getControlUuids()
			const acId = await insertApplicationControl(appId, controlId, "not_implemented")

			await updateControlComment(acId, "First comment", "user1")
			await updateControlComment(acId, "Updated comment", "user2")

			const history = await getControlHistory(acId)
			expect(history).toHaveLength(2)
			// Newest first
			expect(history[0].action).toBe("comment_changed")
			expect(history[0].previousComment).toBe("First comment")
			expect(history[0].newComment).toBe("Updated comment")
			expect(history[0].performedBy).toBe("user2")

			expect(history[1].action).toBe("comment_changed")
			expect(history[1].previousComment).toBeNull()
			expect(history[1].newComment).toBe("First comment")
			expect(history[1].performedBy).toBe("user1")
		})
	})

	describe("getControlHistory", () => {
		it("should return empty array for control with no history", async () => {
			const appId = await createTestApp("Test App")
			const [controlId] = await getControlUuids()
			const acId = await insertApplicationControl(appId, controlId, "implemented")

			const history = await getControlHistory(acId)
			expect(history).toHaveLength(0)
		})
	})

	describe("getBatchComplianceStats", () => {
		it("should aggregate compliance stats by app", async () => {
			const appId = await createTestApp("Test App")
			const controlIds = await getControlUuids()

			await insertApplicationControl(appId, controlIds[0], "implemented")
			await insertApplicationControl(appId, controlIds[1], "not_implemented")

			const stats = await getBatchComplianceStats([appId])
			const appStats = stats.get(appId)

			expect(appStats).toBeDefined()
			expect(appStats?.implemented).toBe(1)
			expect(appStats?.notImplemented).toBe(1)
			expect(appStats?.partial).toBe(0)
			expect(appStats?.notRelevant).toBe(0)
		})

		it("should only count active controls", async () => {
			const appId = await createTestApp("Test App")
			const controlIds = await getControlUuids()

			await insertApplicationControl(appId, controlIds[0], "implemented", true)
			await insertApplicationControl(appId, controlIds[1], "not_implemented", false) // inactive

			const stats = await getBatchComplianceStats([appId])
			const appStats = stats.get(appId)

			expect(appStats?.implemented).toBe(1)
			expect(appStats?.notImplemented).toBe(0)
		})

		it("should return empty map for no app IDs", async () => {
			const stats = await getBatchComplianceStats([])
			expect(stats.size).toBe(0)
		})

		it("should handle multiple apps", async () => {
			const appId1 = await createTestApp("App 1")
			const appId2 = await createTestApp("App 2")
			const controlIds = await getControlUuids()

			await insertApplicationControl(appId1, controlIds[0], "implemented")
			await insertApplicationControl(appId2, controlIds[0], "partially_implemented")
			await insertApplicationControl(appId2, controlIds[1], "not_relevant")

			const stats = await getBatchComplianceStats([appId1, appId2])

			expect(stats.get(appId1)?.implemented).toBe(1)
			expect(stats.get(appId2)?.partial).toBe(1)
			expect(stats.get(appId2)?.notRelevant).toBe(1)
		})
	})

	describe("getComplianceSummaries", () => {
		it("should return totals and per-status counts in a single query", async () => {
			const appId = await createTestApp("Summary App")
			const controlIds = await getControlUuids()

			await insertApplicationControl(appId, controlIds[0], "implemented")
			await insertApplicationControl(appId, controlIds[1], "not_implemented")

			const summaries = await getComplianceSummaries([appId])
			const s = summaries.get(appId)

			expect(s).toBeDefined()
			expect(s?.total).toBe(2)
			expect(s?.implemented).toBe(1)
			expect(s?.notImplemented).toBe(1)
			expect(s?.partial).toBe(0)
			expect(s?.notRelevant).toBe(0)
		})

		it("should exclude inactive rows from counts and total", async () => {
			const appId = await createTestApp("Inactive App")
			const controlIds = await getControlUuids()

			await insertApplicationControl(appId, controlIds[0], "implemented", true)
			await insertApplicationControl(appId, controlIds[1], "not_implemented", false) // inactive

			const summaries = await getComplianceSummaries([appId])
			const s = summaries.get(appId)

			expect(s?.total).toBe(1)
			expect(s?.implemented).toBe(1)
			expect(s?.notImplemented).toBe(0)
		})

		it("should return zeros for apps with no application_controls rows", async () => {
			const appId = await createTestApp("Empty App")

			const summaries = await getComplianceSummaries([appId])
			const s = summaries.get(appId)

			expect(s).toBeDefined()
			expect(s?.total).toBe(0)
			expect(s?.implemented).toBe(0)
			expect(s?.partial).toBe(0)
			expect(s?.notImplemented).toBe(0)
			expect(s?.notRelevant).toBe(0)
		})

		it("should return empty map for empty input", async () => {
			const summaries = await getComplianceSummaries([])
			expect(summaries.size).toBe(0)
		})

		it("should count not_relevant separately", async () => {
			const appId = await createTestApp("NR App")
			const controlIds = await getControlUuids()

			await insertApplicationControl(appId, controlIds[0], "implemented")
			await insertApplicationControl(appId, controlIds[1], "not_relevant")

			const summaries = await getComplianceSummaries([appId])
			const s = summaries.get(appId)

			expect(s?.total).toBe(2)
			expect(s?.implemented).toBe(1)
			expect(s?.notRelevant).toBe(1)
		})

		it("should include null-status rows in total but not in any status count", async () => {
			const appId = await createTestApp("Null Status App")
			const controlIds = await getControlUuids()
			const db = getTestDb()

			await insertApplicationControl(appId, controlIds[0], "implemented")
			// Insert a row with null status
			await db.execute(
				/* sql */ `INSERT INTO application_controls
				(application_id, control_id, status, is_active, activated_at, created_by, updated_by)
				VALUES ('${appId}', '${controlIds[1]}', NULL, true, NOW(), 'test', 'test')`,
			)

			const summaries = await getComplianceSummaries([appId])
			const s = summaries.get(appId)

			expect(s?.total).toBe(2)
			expect(s?.implemented).toBe(1)
			expect(s?.partial).toBe(0)
			expect(s?.notImplemented).toBe(0)
			expect(s?.notRelevant).toBe(0)
		})
	})
})
