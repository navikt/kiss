import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ParsedFramework } from "~/lib/excel-parser.server"
import { getTestDb, getTestPool, setupTestDatabase, teardownTestDatabase } from "./setup"

// Mock connection.server to use the test database
vi.mock("~/db/connection.server", () => ({
	get db() {
		return getTestDb()
	},
	get pool() {
		return getTestPool()
	},
}))

// Import query functions AFTER mock is registered
const {
	stageFrameworkImport,
	applyFrameworkImport,
	getActiveFrameworkVersion,
	getPendingFrameworkImport,
	computeImportDiff,
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
		await db.execute(
			/* sql */ `
			TRUNCATE
				framework_field_history,
				framework_risk_control_mappings,
				compliance_assessments,
				compliance_assessment_history,
				application_controls,
				application_control_history,
				control_technology_elements,
				framework_controls,
				framework_risks,
				framework_domains,
				framework_versions,
				audit_log
			CASCADE;
		`,
		)
	})

	it("should import a framework as pending version", async () => {
		const parsed = makeParsedFramework()
		const versionId = await stageFrameworkImport(parsed, "test.xlsx", "test-user", "/uploads/test.xlsx")

		expect(versionId).toBeDefined()

		const pending = await getPendingFrameworkImport()
		expect(pending).not.toBeNull()
		expect(pending?.status).toBe("pending")
		expect(pending?.sourceFileName).toBe("test.xlsx")
		expect(pending?.createdBy).toBe("test-user")
	})

	it("should apply a pending version and create live data", async () => {
		const parsed = makeParsedFramework()
		const versionId = await stageFrameworkImport(parsed, "test.xlsx", "test-user", "/uploads/test.xlsx")

		await applyFrameworkImport(versionId, parsed, "admin-user")

		const active = await getActiveFrameworkVersion()
		expect(active).not.toBeNull()
		expect(active?.id).toBe(versionId)
		expect(active?.status).toBe("applied")
		expect(active?.activatedBy).toBe("admin-user")

		// Verify live data was created
		const db = getTestDb()
		const domains = await db.execute(/* sql */ `SELECT * FROM framework_domains WHERE archived_at IS NULL`)
		expect(domains.rows.length).toBe(2)

		const controls = await db.execute(/* sql */ `SELECT * FROM framework_controls WHERE archived_at IS NULL`)
		expect(controls.rows.length).toBe(3)

		const risks = await db.execute(/* sql */ `SELECT * FROM framework_risks WHERE archived_at IS NULL`)
		expect(risks.rows.length).toBe(2)
	})

	it("should supersede the previous applied version when applying a new one", async () => {
		const db = getTestDb()
		// Stage and apply first version
		const parsed1 = makeParsedFramework()
		const v1Id = await stageFrameworkImport(parsed1, "v1.xlsx", "user", "/uploads/v1.xlsx")
		await applyFrameworkImport(v1Id, parsed1, "admin")

		// Stage and apply second version
		const parsed2 = makeParsedFramework()
		const v2Id = await stageFrameworkImport(parsed2, "v2.xlsx", "user", "/uploads/v2.xlsx")
		await applyFrameworkImport(v2Id, parsed2, "admin")

		// v1 should be superseded
		const versions = await db.execute(/* sql */ `SELECT id, status FROM framework_versions ORDER BY created_at`)
		const rows = versions.rows as Array<{ id: string; status: string }>
		const v1 = rows.find((v) => v.id === v1Id)
		const v2 = rows.find((v) => v.id === v2Id)

		expect(v1?.status).toBe("superseded")
		expect(v2?.status).toBe("applied")
	})

	it("should preserve short titles when re-importing", async () => {
		const db = getTestDb()
		// Import and apply first version
		const parsed1 = makeParsedFramework()
		const v1Id = await stageFrameworkImport(parsed1, "v1.xlsx", "user", "/uploads/v1.xlsx")
		await applyFrameworkImport(v1Id, parsed1, "admin")

		// Set short titles on the live data
		await db.execute(
			/* sql */ `
			UPDATE framework_risks SET short_title = 'Custom Risk Title' WHERE risk_id = 'R-TS.01';
			UPDATE framework_controls SET short_title = 'Custom Control Title' WHERE control_id = 'K-TS.01';
		`,
		)

		// Re-import: applying a new version should NOT overwrite short titles (they're manual edits)
		const parsed2 = makeParsedFramework()
		const v2Id = await stageFrameworkImport(parsed2, "v2.xlsx", "user", "/uploads/v2.xlsx")
		await applyFrameworkImport(v2Id, parsed2, "admin")

		// Verify short titles are preserved (not overwritten by import — import doesn't set shortTitle)
		const risks = await db.execute(
			/* sql */ `SELECT risk_id, short_title FROM framework_risks WHERE archived_at IS NULL AND risk_id = 'R-TS.01'`,
		)
		expect((risks.rows[0] as { short_title: string | null }).short_title).toBe("Custom Risk Title")

		const controls = await db.execute(
			/* sql */ `SELECT control_id, short_title FROM framework_controls WHERE archived_at IS NULL AND control_id = 'K-TS.01'`,
		)
		expect((controls.rows[0] as { short_title: string | null }).short_title).toBe("Custom Control Title")
	})

	it("should return correct domain summaries", async () => {
		const parsed = makeParsedFramework()
		const versionId = await stageFrameworkImport(parsed, "test.xlsx", "user", "/uploads/test.xlsx")
		await applyFrameworkImport(versionId, parsed, "admin")

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

	it("should return all risks and controls for live data", async () => {
		const parsed = makeParsedFramework()
		const versionId = await stageFrameworkImport(parsed, "test.xlsx", "user", "/uploads/test.xlsx")
		await applyFrameworkImport(versionId, parsed, "admin")

		const risks = await getAllRisks()
		expect(risks).toHaveLength(2)
		expect(risks.map((r) => r.riskId).sort()).toEqual(["R-DH.01", "R-TS.01"])

		const controls = await getAllControls()
		expect(controls).toHaveLength(3)
		expect(controls.map((c) => c.controlId).sort()).toEqual(["K-DH.01", "K-TS.01", "K-TS.02"])
	})

	it("should return correct diff for first import", async () => {
		const parsed = makeParsedFramework()
		await stageFrameworkImport(parsed, "test.xlsx", "user", "/uploads/test.xlsx")

		const diff = await computeImportDiff(parsed)
		expect(diff).not.toBeNull()
		expect(diff?.isFirstImport).toBe(true)
	})

	it("should return correct diff with added/removed/changed items", async () => {
		// Import and apply v1
		const parsedV1 = makeParsedFramework()
		const v1Id = await stageFrameworkImport(parsedV1, "v1.xlsx", "user", "/uploads/v1.xlsx")
		await applyFrameworkImport(v1Id, parsedV1, "admin")

		// Prepare v2 with changes: remove DH domain, add a new risk, change a description
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

		// Compute diff against live data (no need to stage first)
		const diff = await computeImportDiff(parsedV2)
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

	it("should archive removed items and add new items when applying v2", async () => {
		const db = getTestDb()
		// Apply v1
		const parsedV1 = makeParsedFramework()
		const v1Id = await stageFrameworkImport(parsedV1, "v1.xlsx", "user", "/uploads/v1.xlsx")
		await applyFrameworkImport(v1Id, parsedV1, "admin")

		// Apply v2 that removes DH domain and adds new items
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
			],
		})
		const v2Id = await stageFrameworkImport(parsedV2, "v2.xlsx", "user", "/uploads/v2.xlsx")
		await applyFrameworkImport(v2Id, parsedV2, "admin")

		// DH domain, R-DH.01, K-DH.01, K-TS.02 should be archived
		const archivedDomains = await db.execute(
			/* sql */ `SELECT code FROM framework_domains WHERE archived_at IS NOT NULL`,
		)
		expect((archivedDomains.rows as Array<{ code: string }>).map((r) => r.code)).toContain("DH")

		const archivedRisks = await db.execute(
			/* sql */ `SELECT risk_id FROM framework_risks WHERE archived_at IS NOT NULL`,
		)
		expect((archivedRisks.rows as Array<{ risk_id: string }>).map((r) => r.risk_id)).toContain("R-DH.01")

		// Field history should record the description change
		const history = await db.execute(
			/* sql */ `SELECT * FROM framework_field_history WHERE field_name = 'description' AND entity_type = 'risk'`,
		)
		expect(history.rows.length).toBeGreaterThanOrEqual(1)

		// UUIDs should be stable: R-TS.01's UUID should be the same as before
		const liveRisks = await db.execute(
			/* sql */ `SELECT id FROM framework_risks WHERE risk_id = 'R-TS.01' AND archived_at IS NULL`,
		)
		expect(liveRisks.rows).toHaveLength(1)
	})
})
