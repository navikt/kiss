import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ParsedFramework } from "~/lib/excel-parser.server"
import { getTestDb, setupTestDatabase, teardownTestDatabase } from "./setup"

// Mock connection.server to use the test database
vi.mock("~/db/connection.server", () => ({
	get db() {
		return getTestDb()
	},
	get pool() {
		return null
	},
}))

// Import query functions AFTER mock is registered
const {
	stageFrameworkVersion,
	activateFrameworkVersion,
	getActiveFrameworkVersion,
	getStagingFrameworkVersion,
	getStagingDiff,
	getDomainSummaries,
	getAllRisks,
	getAllControls,
} = await import("~/db/queries/framework.server")

function makeParsedFramework(overrides?: Partial<ParsedFramework>): ParsedFramework {
	return {
		sheetName: "Rammeverk",
		rows: [
			{
				domain: "Teknisk sikkerhet",
				riskId: "R-TS.01",
				riskDescription: "Uautorisert tilgang til systemer",
				controlId: "K-TS.01",
				technologyElement: "Identitetsstyring",
				requirement: "Krav om MFA for alle brukere",
				responsible: "IT-avdelingen",
				routine: "Kvartalsvis gjennomgang",
				frequency: "Kvartalsvis",
				documentationRequirement: "Logg over MFA-status",
				testProcedure: "Verifiser MFA-aktivering",
				dependencies: null,
				references: "ISO 27001 A.9",
				commonPitfalls: "Glemmer tjenestekontoer",
			},
			{
				domain: "Teknisk sikkerhet",
				riskId: "R-TS.01",
				riskDescription: "Uautorisert tilgang til systemer",
				controlId: "K-TS.02",
				technologyElement: "Nettverkssikkerhet",
				requirement: "Brannmurregler skal gjennomgås",
				responsible: "Nettverksteamet",
				routine: "Månedlig gjennomgang",
				frequency: "Månedlig",
				documentationRequirement: "Brannmurlogg",
				testProcedure: "Sjekk brannmurregler",
				dependencies: "K-TS.01",
				references: "ISO 27001 A.13",
				commonPitfalls: null,
			},
			{
				domain: "Datahåndtering",
				riskId: "R-DH.01",
				riskDescription: "Tap av sensitive data",
				controlId: "K-DH.01",
				technologyElement: "Kryptering",
				requirement: "Alle data skal krypteres i hvile",
				responsible: "Datateamet",
				routine: "Årlig revisjon",
				frequency: "Årlig",
				documentationRequirement: "Krypteringsstatus",
				testProcedure: "Verifiser kryptering",
				dependencies: null,
				references: "GDPR Art. 32",
				commonPitfalls: "Manglende nøkkelrotasjon",
			},
		],
		...overrides,
	}
}

describe("Framework integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	})

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		// Clean tables in dependency order
		await db.execute(
			/* sql */ `
			DELETE FROM framework_risk_control_mappings;
			DELETE FROM compliance_assessments;
			DELETE FROM compliance_assessment_history;
			DELETE FROM framework_controls;
			DELETE FROM framework_risks;
			DELETE FROM framework_domains;
			DELETE FROM framework_versions;
			DELETE FROM audit_log;
		`,
		)
	})

	it("should import a framework as staging version", async () => {
		const parsed = makeParsedFramework()
		const versionId = await stageFrameworkVersion(parsed, "test.xlsx", "test-user", "/uploads/test.xlsx")

		expect(versionId).toBeDefined()

		const staging = await getStagingFrameworkVersion()
		expect(staging).not.toBeNull()
		expect(staging?.status).toBe("staging")
		expect(staging?.sourceFileName).toBe("test.xlsx")
		expect(staging?.createdBy).toBe("test-user")
	})

	it("should activate a staging version", async () => {
		const parsed = makeParsedFramework()
		const versionId = await stageFrameworkVersion(parsed, "test.xlsx", "test-user", "/uploads/test.xlsx")

		await activateFrameworkVersion(versionId, "admin-user")

		const active = await getActiveFrameworkVersion()
		expect(active).not.toBeNull()
		expect(active?.id).toBe(versionId)
		expect(active?.status).toBe("active")
		expect(active?.activatedBy).toBe("admin-user")
	})

	it("should archive the previous active version when activating a new one", async () => {
		const db = getTestDb()
		// Stage and activate first version
		const parsed1 = makeParsedFramework()
		const v1Id = await stageFrameworkVersion(parsed1, "v1.xlsx", "user", "/uploads/v1.xlsx")
		await activateFrameworkVersion(v1Id, "admin")

		// Stage and activate second version
		const parsed2 = makeParsedFramework()
		const v2Id = await stageFrameworkVersion(parsed2, "v2.xlsx", "user", "/uploads/v2.xlsx")
		await activateFrameworkVersion(v2Id, "admin")

		// v1 should be archived
		const versions = await db.execute(/* sql */ `SELECT id, status FROM framework_versions ORDER BY created_at`)
		const rows = versions.rows as Array<{ id: string; status: string }>
		const v1 = rows.find((v) => v.id === v1Id)
		const v2 = rows.find((v) => v.id === v2Id)

		expect(v1?.status).toBe("archived")
		expect(v2?.status).toBe("active")
	})

	it("should carry forward short titles on re-import", async () => {
		const db = getTestDb()
		// Import and activate first version
		const parsed1 = makeParsedFramework()
		const v1Id = await stageFrameworkVersion(parsed1, "v1.xlsx", "user", "/uploads/v1.xlsx")
		await activateFrameworkVersion(v1Id, "admin")

		// Set short titles on the active version
		await db.execute(
			/* sql */ `
			UPDATE framework_risks SET short_title = 'Custom Risk Title' WHERE risk_id = 'R-TS.01';
			UPDATE framework_controls SET short_title = 'Custom Control Title' WHERE control_id = 'K-TS.01';
		`,
		)

		// Re-import a new staging version
		const parsed2 = makeParsedFramework()
		const v2Id = await stageFrameworkVersion(parsed2, "v2.xlsx", "user", "/uploads/v2.xlsx")

		// Verify short titles carried forward to staging
		const risks = await db.execute(
			/* sql */ `SELECT risk_id, short_title FROM framework_risks WHERE version_id = '${v2Id}' AND risk_id = 'R-TS.01'`,
		)
		expect((risks.rows[0] as { short_title: string | null }).short_title).toBe("Custom Risk Title")

		const controls = await db.execute(
			/* sql */ `SELECT control_id, short_title FROM framework_controls WHERE version_id = '${v2Id}' AND control_id = 'K-TS.01'`,
		)
		expect((controls.rows[0] as { short_title: string | null }).short_title).toBe("Custom Control Title")
	})

	it("should return correct domain summaries", async () => {
		const parsed = makeParsedFramework()
		const versionId = await stageFrameworkVersion(parsed, "test.xlsx", "user", "/uploads/test.xlsx")
		await activateFrameworkVersion(versionId, "admin")

		const summaries = await getDomainSummaries()
		expect(summaries).toHaveLength(2)

		const ts = summaries.find((d) => d.code === "TS")
		expect(ts).toBeDefined()
		expect(ts?.name).toBe("Teknisk sikkerhet")
		expect(ts?.riskCount).toBe(1)
		expect(ts?.controlCount).toBe(2)

		const dh = summaries.find((d) => d.code === "DH")
		expect(dh).toBeDefined()
		expect(dh?.name).toBe("Datahåndtering")
		expect(dh?.riskCount).toBe(1)
		expect(dh?.controlCount).toBe(1)
	})

	it("should return all risks and controls for active version", async () => {
		const parsed = makeParsedFramework()
		const versionId = await stageFrameworkVersion(parsed, "test.xlsx", "user", "/uploads/test.xlsx")
		await activateFrameworkVersion(versionId, "admin")

		const risks = await getAllRisks()
		expect(risks).toHaveLength(2)
		expect(risks.map((r) => r.riskId).sort()).toEqual(["R-DH.01", "R-TS.01"])

		const controls = await getAllControls()
		expect(controls).toHaveLength(3)
		expect(controls.map((c) => c.controlId).sort()).toEqual(["K-DH.01", "K-TS.01", "K-TS.02"])
	})

	it("should return correct staging diff for first import", async () => {
		const parsed = makeParsedFramework()
		await stageFrameworkVersion(parsed, "test.xlsx", "user", "/uploads/test.xlsx")

		const diff = await getStagingDiff()
		expect(diff).not.toBeNull()
		expect(diff?.isFirstImport).toBe(true)
	})

	it("should return correct staging diff with added/removed/changed items", async () => {
		// Import and activate v1
		const parsedV1 = makeParsedFramework()
		const v1Id = await stageFrameworkVersion(parsedV1, "v1.xlsx", "user", "/uploads/v1.xlsx")
		await activateFrameworkVersion(v1Id, "admin")

		// Import v2 with changes: remove DH domain, add a new risk, change a description
		const parsedV2 = makeParsedFramework({
			rows: [
				{
					domain: "Teknisk sikkerhet",
					riskId: "R-TS.01",
					riskDescription: "ENDRET: Uautorisert tilgang",
					controlId: "K-TS.01",
					technologyElement: "Identitetsstyring",
					requirement: "Krav om MFA for alle brukere",
					responsible: "IT-avdelingen",
					routine: "Kvartalsvis gjennomgang",
					frequency: "Kvartalsvis",
					documentationRequirement: "Logg over MFA-status",
					testProcedure: "Verifiser MFA-aktivering",
					dependencies: null,
					references: "ISO 27001 A.9",
					commonPitfalls: "Glemmer tjenestekontoer",
				},
				{
					domain: "Teknisk sikkerhet",
					riskId: "R-TS.02",
					riskDescription: "Ny risiko for sårbar programvare",
					controlId: "K-TS.03",
					technologyElement: "Patchhåndtering",
					requirement: "Automatisk patching",
					responsible: "Drift",
					routine: "Ukentlig",
					frequency: "Ukentlig",
					documentationRequirement: "Patch-rapport",
					testProcedure: "Verifiser patch-status",
					dependencies: null,
					references: "ISO 27001 A.12",
					commonPitfalls: null,
				},
			],
		})
		await stageFrameworkVersion(parsedV2, "v2.xlsx", "user", "/uploads/v2.xlsx")

		const diff = await getStagingDiff()
		expect(diff).not.toBeNull()
		expect(diff?.isFirstImport).toBe(false)

		// Added: R-TS.02 risk, K-TS.03 control
		expect(diff?.added.risks.map((r) => r.riskId)).toContain("R-TS.02")
		expect(diff?.added.controls.map((c) => c.controlId)).toContain("K-TS.03")

		// Removed: R-DH.01 risk, K-DH.01 and K-TS.02 controls, DH domain
		expect(diff?.removed.risks.map((r) => r.riskId)).toContain("R-DH.01")
		expect(diff?.removed.controls.map((c) => c.controlId)).toContain("K-DH.01")
		expect(diff?.removed.controls.map((c) => c.controlId)).toContain("K-TS.02")
		expect(diff?.removed.domains.map((d) => d.code)).toContain("DH")

		// Changed: R-TS.01 description changed
		const changedRisk = diff?.changed.risks.find((r) => r.riskId === "R-TS.01")
		expect(changedRisk).toBeDefined()
		expect(changedRisk?.fields.find((f) => f.field === "description")?.newValue).toBe("ENDRET: Uautorisert tilgang")
	})
})
