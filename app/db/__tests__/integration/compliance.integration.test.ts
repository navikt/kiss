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
const { saveAssessment, getAppAssessments } = await import("~/db/queries/applications.server")

function makeParsedFramework(): ParsedFramework {
	return {
		sheetName: "Rammeverk",
		rows: [
			{
				domain: "Teknisk sikkerhet",
				riskId: "R-TS.01",
				riskDescription: "Uautorisert tilgang til systemer",
				controlId: "K-TS.01",
				technologyElement: null,
				requirement: "Krav om MFA",
				responsible: "IT",
				routine: "Kvartalsvis",
				frequency: "Kvartalsvis",
				documentationRequirement: "MFA-logg",
				testProcedure: "Verifiser MFA",
				dependencies: null,
				references: "ISO 27001",
				commonPitfalls: null,
			},
		],
	}
}

/** Helper: create a monitored application directly in the DB. */
async function createTestApp(name: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `
		INSERT INTO monitored_applications (name, created_by, updated_by)
		VALUES ('${name}', 'test', 'test')
		RETURNING id
	`,
	)
	return (result.rows[0] as { id: string }).id
}

/** Get the control UUID for the test control. */
async function getControlUuid(_versionId: string) {
	const db = getTestDb()
	const result = await db.execute(/* sql */ `SELECT id FROM framework_controls WHERE archived_at IS NULL LIMIT 1`)
	return (result.rows[0] as { id: string }).id
}

describe("Compliance integration tests", () => {
	let activeVersionId: string

	beforeAll(async () => {
		await setupTestDatabase()
	})

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(
			/* sql */ `
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
			DELETE FROM technology_elements;
			DELETE FROM audit_log;
		`,
		)

		// Set up live framework data for each test
		const parsed = makeParsedFramework()
		activeVersionId = await stageFrameworkImport(parsed, "test.xlsx", "user", "/uploads/test.xlsx")
		await applyFrameworkImport(activeVersionId, parsed, "admin")
	})

	it("should save a new compliance assessment", async () => {
		const db = getTestDb()
		const appId = await createTestApp("Test App")
		const controlUuid = await getControlUuid(activeVersionId)

		await saveAssessment(appId, controlUuid, "implemented", "Fully compliant", "assessor")

		const result = await db.execute(/* sql */ `SELECT * FROM compliance_assessments`)
		expect(result.rows).toHaveLength(1)

		const row = result.rows[0] as Record<string, unknown>
		expect(row.application_id).toBe(appId)
		expect(row.status).toBe("implemented")
		expect(row.comment).toBe("Fully compliant")
		expect(row.assessed_by).toBe("assessor")
	})

	it("should write history on initial assessment", async () => {
		const db = getTestDb()
		const appId = await createTestApp("Test App")
		const controlUuid = await getControlUuid(activeVersionId)

		await saveAssessment(appId, controlUuid, "implemented", "Initial", "assessor")

		const history = await db.execute(/* sql */ `SELECT * FROM compliance_assessment_history`)
		expect(history.rows).toHaveLength(1)

		const row = history.rows[0] as Record<string, unknown>
		expect(row.previous_status).toBeNull()
		expect(row.new_status).toBe("implemented")
		expect(row.new_comment).toBe("Initial")
	})

	it("should update an existing assessment and create history", async () => {
		const db = getTestDb()
		const appId = await createTestApp("Test App")
		const controlUuid = await getControlUuid(activeVersionId)

		// First save
		await saveAssessment(appId, controlUuid, "not_implemented", "Not done yet", "assessor")

		// Update
		await saveAssessment(appId, controlUuid, "implemented", "Now completed", "assessor")

		// Check assessment was updated
		const assessments = await db.execute(/* sql */ `SELECT * FROM compliance_assessments`)
		expect(assessments.rows).toHaveLength(1)
		expect((assessments.rows[0] as Record<string, unknown>).status).toBe("implemented")

		// Check history has two entries
		const history = await db.execute(/* sql */ `SELECT * FROM compliance_assessment_history ORDER BY changed_at`)
		expect(history.rows).toHaveLength(2)

		// First history: initial creation
		const h1 = history.rows[0] as Record<string, unknown>
		expect(h1.previous_status).toBeNull()
		expect(h1.new_status).toBe("not_implemented")

		// Second history: update
		const h2 = history.rows[1] as Record<string, unknown>
		expect(h2.previous_status).toBe("not_implemented")
		expect(h2.new_status).toBe("implemented")
	})

	it("should return correct shape from getAppAssessments", async () => {
		const appId = await createTestApp("Test App")
		const controlUuid = await getControlUuid(activeVersionId)

		await saveAssessment(appId, controlUuid, "partially_implemented", "In progress", "assessor")

		const result = await getAppAssessments(appId)
		expect(result).not.toBeNull()
		expect(result?.app.name).toBe("Test App")
		expect(result?.assessments).toHaveLength(1)

		const assessment = result?.assessments[0]
		expect(assessment?.controlId).toBe("K-TS.01")
		expect(assessment?.status).toBe("partially_implemented")
		expect(assessment?.comment).toBe("In progress")
		expect(assessment?.assessedBy).toBe("assessor")
		expect(assessment?.domainCode).toBe("TS")
		expect(assessment?.domainName).toBe("Teknisk sikkerhet")
	})

	it("should return null for non-existent application", async () => {
		const result = await getAppAssessments("00000000-0000-0000-0000-000000000000")
		expect(result).toBeNull()
	})

	it("should return assessments with null status for unanswered controls", async () => {
		const appId = await createTestApp("Unanswered App")

		const result = await getAppAssessments(appId)
		expect(result).not.toBeNull()
		expect(result?.assessments).toHaveLength(1)
		expect(result?.assessments[0]?.status).toBeNull()
	})
})
