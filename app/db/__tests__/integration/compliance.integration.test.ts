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
const { getAppAssessments } = await import("~/db/queries/applications.server")

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

describe("Compliance integration tests (deprecated complianceAssessments removed)", () => {
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

		const parsed = makeParsedFramework()
		activeVersionId = await stageFrameworkImport(parsed, "test.xlsx", "user", "/uploads/test.xlsx")
		await applyFrameworkImport(activeVersionId, parsed, "admin")
	})

	it("getAppAssessments returns null status for unanswered controls (no legacy writes)", async () => {
		const appId = await createTestApp("Test App")

		const result = await getAppAssessments(appId)
		expect(result).not.toBeNull()
		expect(result?.app.name).toBe("Test App")
		expect(result?.assessments).toHaveLength(1)

		const assessment = result?.assessments[0]
		expect(assessment?.controlId).toBe("K-TS.01")
		expect(assessment?.status).toBeNull()
		expect(assessment?.comment).toBeNull()
		expect(assessment?.assessedBy).toBeNull()
		expect(assessment?.domainCode).toBe("TS")
		expect(assessment?.domainName).toBe("Teknisk sikkerhet")

		const db = getTestDb()
		const assessRows = await db.execute(/* sql */ `SELECT count(*)::int AS c FROM compliance_assessments`)
		expect((assessRows.rows[0] as { c: number }).c).toBe(0)
		const historyRows = await db.execute(/* sql */ `SELECT count(*)::int AS c FROM compliance_assessment_history`)
		expect((historyRows.rows[0] as { c: number }).c).toBe(0)
	})

	it("should return null for non-existent application", async () => {
		const result = await getAppAssessments("00000000-0000-0000-0000-000000000000")
		expect(result).toBeNull()
	})

	it("activeVersionId is created in beforeEach", () => {
		expect(activeVersionId).toBeTruthy()
	})
})
