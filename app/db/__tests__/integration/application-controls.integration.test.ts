import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ParsedFramework } from "~/lib/excel-parser.server"
import { getTestDb, getTestPool, setupTestDatabase, teardownTestDatabase, truncateWithRetry } from "./setup"

vi.mock("~/db/connection.server", () => ({
	get db() {
		return getTestDb()
	},
	get pool() {
		return getTestPool()
	},
}))

const { stageFrameworkImport, applyFrameworkImport } = await import("~/db/queries/framework.server")
const {
	updateControlComment,
	getControlHistory,
	getActiveApplicationControls,
	getBatchComplianceStats,
	getComplianceSummaries,
	syncApplicationControls,
	getRoutineComplianceSummaries,
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
			{
				domain: "Teknisk sikkerhet",
				riskId: "R-TS.01",
				riskDescription: "Uautorisert tilgang",
				controlId: "K-TS.03",
				technologyElement: null,
				requirement: "Loggkontroll",
				responsible: "IT",
				routine: "Ukentlig",
				frequency: "Ukentlig",
				documentationRequirement: "Hendelseslogg",
				testProcedure: "Verifiser logger",
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
		await truncateWithRetry([
			"compliance_assessment_history",
			"compliance_assessments",
			"application_control_history",
			"application_controls",
			"application_team_mappings",
			"application_environments",
			"monitored_applications",
			"routine_reviews",
			"routines",
			"sections",
			"framework_field_history",
			"control_technology_elements",
			"framework_risk_control_mappings",
			"framework_controls",
			"framework_risks",
			"framework_domains",
			"framework_versions",
			"audit_log",
		])

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

	describe("syncApplicationControls no-op behavior", () => {
		it("does not update rows when nothing has changed", async () => {
			const db = getTestDb()
			const appId = await createTestApp("NoOpApp")

			// Framework already staged/applied in beforeEach

			// First sync creates application_controls rows
			await syncApplicationControls(appId)

			// Record updated_at timestamps
			const before = await db.execute(
				/* sql */ `SELECT id, updated_at FROM application_controls WHERE application_id = '${appId}' ORDER BY id`,
			)
			const beforeRows = before.rows as Array<{ id: string; updated_at: string }>
			expect(beforeRows.length).toBeGreaterThan(0)

			// Wait 10ms to ensure timestamp difference is detectable
			await new Promise((r) => setTimeout(r, 10))

			// Second sync — nothing changed, should be a no-op
			const result = await syncApplicationControls(appId)
			expect(result).not.toBeNull()
			expect(result?.unchanged).toBe(beforeRows.length)
			expect(result?.statusChanged).toBe(0)
			expect(result?.activated).toBe(0)

			// Verify updated_at is unchanged
			const after = await db.execute(
				/* sql */ `SELECT id, updated_at FROM application_controls WHERE application_id = '${appId}' ORDER BY id`,
			)
			const afterRows = after.rows as Array<{ id: string; updated_at: string }>
			for (let i = 0; i < beforeRows.length; i++) {
				expect(afterRows[i].updated_at).toEqual(beforeRows[i].updated_at)
			}
		})
	})

	describe("getRoutineComplianceSummaries", () => {
		async function insertControlWithRoutineIds(
			appId: string,
			controlId: string,
			matchingRoutineIds: string[],
			isActive = true,
		) {
			const db = getTestDb()
			const ids = matchingRoutineIds.map((id) => `'${id}'`).join(",")
			await db.execute(
				/* sql */ `INSERT INTO application_controls
				(application_id, control_id, routine_compliance, matching_routine_ids, is_active, activated_at, created_by, updated_by)
				VALUES ('${appId}', '${controlId}', 'never_reviewed',
					ARRAY[${ids.length > 0 ? ids : ""}]::uuid[], ${isActive}, NOW(), 'test', 'test')`,
			)
		}

		async function createTestSection(): Promise<string> {
			const db = getTestDb()
			const slug = `sec-${crypto.randomUUID().slice(0, 8)}`
			const result = await db.execute(
				/* sql */ `INSERT INTO sections (name, slug, created_by, updated_by) VALUES ('TestSection', '${slug}', 'test', 'test') RETURNING id`,
			)
			return (result.rows[0] as { id: string }).id
		}

		async function createTestRoutineForSection(sectionId: string): Promise<string> {
			const db = getTestDb()
			const result = await db.execute(
				/* sql */ `INSERT INTO routines (name, section_id, frequency, status, created_by, updated_by)
				VALUES ('TestRoutine', '${sectionId}', 'quarterly', 'approved', 'test', 'test') RETURNING id`,
			)
			return (result.rows[0] as { id: string }).id
		}

		async function insertRoutineReview(appId: string, routineId: string, status: string) {
			const db = getTestDb()
			await db.execute(
				/* sql */ `INSERT INTO routine_reviews (routine_id, application_id, title, status, reviewed_at, created_by)
				VALUES ('${routineId}', '${appId}', 'Test Review', '${status}', NOW(), 'test')`,
			)
		}

		it("returns empty map for empty input", async () => {
			const result = await getRoutineComplianceSummaries([])
			expect(result.size).toBe(0)
		})

		it("returns zeros for app with no application_controls rows", async () => {
			const appId = await createTestApp("NoControls")
			const result = await getRoutineComplianceSummaries([appId])
			expect(result.get(appId)).toEqual({ gjennomfort: 0, ikkeGjennomfort: 0, maaFolgesOpp: 0, total: 0 })
		})

		it("counts distinct routines — not control rows", async () => {
			const appId = await createTestApp("DistinctRoutines")
			const sectionId = await createTestSection()
			const routineId = await createTestRoutineForSection(sectionId)
			const controlIds = await getControlUuids()

			// Same routine matches two different controls — should count once
			await insertControlWithRoutineIds(appId, controlIds[0], [routineId])
			await insertControlWithRoutineIds(appId, controlIds[1], [routineId])
			// A completed review makes it gjennomfort
			await insertRoutineReview(appId, routineId, "completed")

			const result = await getRoutineComplianceSummaries([appId])
			const s = result.get(appId)
			expect(s?.gjennomfort).toBe(1)
			expect(s?.total).toBe(1)
		})

		it("does not double-count a routine that appears in controls with different compliance statuses", async () => {
			const appId = await createTestApp("DoubleCount")
			const sectionId = await createTestSection()
			const routineId = await createTestRoutineForSection(sectionId)
			const controlIds = await getControlUuids()

			// Same routine in both a 'completed' and a 'never_reviewed' control
			await insertControlWithRoutineIds(appId, controlIds[0], [routineId])
			await insertControlWithRoutineIds(appId, controlIds[1], [routineId])
			// Completed review → gjennomfort
			await insertRoutineReview(appId, routineId, "completed")

			const result = await getRoutineComplianceSummaries([appId])
			const s = result.get(appId)
			expect(s?.gjennomfort).toBe(1)
			expect(s?.ikkeGjennomfort).toBe(0)
			expect(s?.total).toBe(1)
		})

		it("filters out inactive application_controls rows", async () => {
			const appId = await createTestApp("InactiveControls")
			const controlIds = await getControlUuids()
			const routineId = crypto.randomUUID()

			await insertControlWithRoutineIds(appId, controlIds[0], [routineId], false)

			const result = await getRoutineComplianceSummaries([appId])
			const s = result.get(appId)
			expect(s?.gjennomfort).toBe(0)
			expect(s?.total).toBe(0)
		})

		it("counts gjennomfort and ikkeGjennomfort correctly", async () => {
			const appId = await createTestApp("MixedCompliance")
			const sectionId = await createTestSection()
			const controlIds = await getControlUuids()
			const routineId1 = await createTestRoutineForSection(sectionId)
			const routineId2 = await createTestRoutineForSection(sectionId)
			const routineId3 = await createTestRoutineForSection(sectionId)

			await insertControlWithRoutineIds(appId, controlIds[0], [routineId1])
			await insertControlWithRoutineIds(appId, controlIds[1], [routineId2])
			await insertControlWithRoutineIds(appId, controlIds[2], [routineId3])
			// Only routineId1 has a completed review
			await insertRoutineReview(appId, routineId1, "completed")

			const result = await getRoutineComplianceSummaries([appId])
			const s = result.get(appId)
			expect(s?.gjennomfort).toBe(1)
			expect(s?.ikkeGjennomfort).toBe(2)
			expect(s?.total).toBe(3)
		})

		it("counts maaFolgesOpp from needs_follow_up reviews", async () => {
			const appId = await createTestApp("FollowUp")
			const sectionId = await createTestSection()
			const routineId = await createTestRoutineForSection(sectionId)
			const controlIds = await getControlUuids()
			await insertControlWithRoutineIds(appId, controlIds[0], [routineId])
			await insertRoutineReview(appId, routineId, "needs_follow_up")

			const result = await getRoutineComplianceSummaries([appId])
			// needs_follow_up counts as gjennomfort (reviewed but with open points)
			expect(result.get(appId)?.gjennomfort).toBe(1)
			expect(result.get(appId)?.ikkeGjennomfort).toBe(0)
			expect(result.get(appId)?.maaFolgesOpp).toBe(1)
		})

		it("counts needs_follow_up as gjennomfort — consistent with app detail page", async () => {
			const appId = await createTestApp("NeedsFollowUpGjennomfort")
			const sectionId = await createTestSection()
			const routineId = await createTestRoutineForSection(sectionId)
			const controlIds = await getControlUuids()
			await insertControlWithRoutineIds(appId, controlIds[0], [routineId])
			await insertRoutineReview(appId, routineId, "needs_follow_up")

			const result = await getRoutineComplianceSummaries([appId])
			expect(result.get(appId)?.gjennomfort).toBe(1)
			expect(result.get(appId)?.ikkeGjennomfort).toBe(0)
			expect(result.get(appId)?.total).toBe(1)
		})

		it("sets maaFolgesOpp even when app has no active application_controls rows", async () => {
			const appId = await createTestApp("FollowUpNoControls")
			const sectionId = await createTestSection()
			const routineId = await createTestRoutineForSection(sectionId)
			await insertRoutineReview(appId, routineId, "needs_follow_up")

			const result = await getRoutineComplianceSummaries([appId])
			expect(result.get(appId)?.maaFolgesOpp).toBe(1)
		})

		it("handles multiple apps in one call", async () => {
			const appId1 = await createTestApp("MultiApp1")
			const appId2 = await createTestApp("MultiApp2")
			const sectionId = await createTestSection()
			const controlIds = await getControlUuids()
			const routineId1 = await createTestRoutineForSection(sectionId)
			const routineId2 = await createTestRoutineForSection(sectionId)

			await insertControlWithRoutineIds(appId1, controlIds[0], [routineId1])
			await insertControlWithRoutineIds(appId2, controlIds[1], [routineId2])
			// appId1's routine has a completed review; appId2's does not
			await insertRoutineReview(appId1, routineId1, "completed")

			const result = await getRoutineComplianceSummaries([appId1, appId2])
			expect(result.get(appId1)?.gjennomfort).toBe(1)
			expect(result.get(appId1)?.ikkeGjennomfort).toBe(0)
			expect(result.get(appId2)?.gjennomfort).toBe(0)
			expect(result.get(appId2)?.ikkeGjennomfort).toBe(1)
		})
	})
})
