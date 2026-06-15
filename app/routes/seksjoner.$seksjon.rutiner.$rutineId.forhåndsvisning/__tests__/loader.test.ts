import { beforeEach, describe, expect, it, vi } from "vitest"

// ─── Mocks ────────────────────────────────────────────────────────────────────
// Every mock is declared before the module import so Vitest hoisting works correctly.

const mockGetAuthenticatedUser = vi.fn()
vi.mock("~/lib/auth.server", () => ({
	getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}))

const mockGetSectionBySlug = vi.fn()
vi.mock("~/db/queries/sections.server", () => ({
	getSectionBySlug: (...args: unknown[]) => mockGetSectionBySlug(...args),
}))

// ── routines.server — only read functions should be called ──────────────────
const mockGetRoutine = vi.fn()
const mockGetRoutineActivityLinks = vi.fn()
const mockGetActivityStepsForRoutine = vi.fn()

// Seeding and write functions — must never be invoked by the preview loader
const mockSeedEntraActivity = vi.fn()
const mockSeedOracleRoleCriticalityActivity = vi.fn()
const mockSeedManualActivity = vi.fn()
const mockCreateReview = vi.fn()
const mockAutoCreateActivitiesForReview = vi.fn()
const mockGetReview = vi.fn()
const mockGetReviewActivities = vi.fn()
const mockCompleteReview = vi.fn()
const mockDiscardReview = vi.fn()

vi.mock("~/db/queries/routines.server", () => ({
	getRoutine: (...args: unknown[]) => mockGetRoutine(...args),
	getRoutineActivityLinks: (...args: unknown[]) => mockGetRoutineActivityLinks(...args),
	getActivityStepsForRoutine: (...args: unknown[]) => mockGetActivityStepsForRoutine(...args),
	seedEntraActivity: (...args: unknown[]) => mockSeedEntraActivity(...args),
	seedOracleRoleCriticalityActivity: (...args: unknown[]) => mockSeedOracleRoleCriticalityActivity(...args),
	seedManualActivity: (...args: unknown[]) => mockSeedManualActivity(...args),
	createReview: (...args: unknown[]) => mockCreateReview(...args),
	autoCreateActivitiesForReview: (...args: unknown[]) => mockAutoCreateActivitiesForReview(...args),
	getReview: (...args: unknown[]) => mockGetReview(...args),
	getReviewActivities: (...args: unknown[]) => mockGetReviewActivities(...args),
	completeReview: (...args: unknown[]) => mockCompleteReview(...args),
	discardReview: (...args: unknown[]) => mockDiscardReview(...args),
}))

// ── rulesets.server ──────────────────────────────────────────────────────────
const mockGetRulesetsLinkedToControls = vi.fn()
vi.mock("~/db/queries/rulesets.server", () => ({
	getRulesetsLinkedToControls: (...args: unknown[]) => mockGetRulesetsLinkedToControls(...args),
}))

// ── External API modules — must never be called from the preview loader ──────
const mockGetApplicationDetail = vi.fn()
const mockGetOracleInstancesForApp = vi.fn()
const mockGetEvidenceDownloads = vi.fn()
const mockGetTeamMembersForApp = vi.fn()

vi.mock("~/db/queries/nais.server", () => ({
	getApplicationDetail: (...args: unknown[]) => mockGetApplicationDetail(...args),
}))

vi.mock("~/db/queries/audit-evidence.server", () => ({
	getOracleInstancesForApp: (...args: unknown[]) => mockGetOracleInstancesForApp(...args),
}))

vi.mock("~/db/queries/evidence-downloads.server", () => ({
	getEvidenceDownloadsForActivityWithBucketDetails: (...args: unknown[]) => mockGetEvidenceDownloads(...args),
}))

vi.mock("~/db/queries/applications.server", () => ({
	getTeamMembersForApp: (...args: unknown[]) => mockGetTeamMembersForApp(...args),
}))

vi.mock("~/lib/markdown.server", () => ({
	renderMarkdown: vi.fn((text: string | null) => (text ? `<p>${text}</p>` : null)),
}))

// ── Loader import (after all mocks) ──────────────────────────────────────────
const { loader } = await import("../index")

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ROUTINE_ID = "00000000-0000-0000-0000-000000000001"
const SECTION_ID = "00000000-0000-0000-0000-000000000002"
const LINK_ID_ENTRA = "00000000-0000-0000-0000-000000000010"
const LINK_ID_ORACLE = "00000000-0000-0000-0000-000000000011"
const LINK_ID_RPA = "00000000-0000-0000-0000-000000000012"
const LINK_ID_MANUAL = "00000000-0000-0000-0000-000000000013"

const fakeUser = { navIdent: "Z990001", name: "Glad Fjord", email: "glad@nav.no", groups: [], token: "" }

const fakeSection = { id: SECTION_ID, name: "Test Seksjon", slug: "test-seksjon" }

const baseRoutine = {
	id: ROUTINE_ID,
	sectionId: SECTION_ID,
	name: "Min testrutine",
	description: "Beskrivelse av rutinen",
	frequency: "monthly",
	eventFrequency: null,
	responsibleRole: "Forvaltningsansvarlig",
	isSectionRoutine: 0,
	status: "approved",
	archivedAt: null,
	controls: [],
	activityLinks: [],
}

function makeRequest() {
	return new Request(`http://localhost/seksjoner/test-seksjon/rutiner/${ROUTINE_ID}/forh%C3%A5ndsvisning`, {
		method: "GET",
	})
}

function callLoader(params: Record<string, string | undefined> = {}) {
	return loader({
		request: makeRequest(),
		params: { seksjon: "test-seksjon", rutineId: ROUTINE_ID, ...params },
		context: {},
	} as unknown as Parameters<typeof loader>[0])
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** React Router's `throw data(payload, init)` produces a DataWithResponseInit, not a Response. */
function hasStatus(e: unknown, status: number): boolean {
	if (e instanceof Response) return e.status === status
	if (typeof e === "object" && e !== null && "type" in e && (e as { type: string }).type === "DataWithResponseInit") {
		const init = (e as { init?: { status?: number } }).init
		return init?.status === status
	}
	return false
}

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks()
	mockGetAuthenticatedUser.mockResolvedValue(fakeUser)
	mockGetSectionBySlug.mockResolvedValue(fakeSection)
	mockGetRoutine.mockResolvedValue(baseRoutine)
	mockGetRoutineActivityLinks.mockResolvedValue([])
	mockGetActivityStepsForRoutine.mockResolvedValue([])
	mockGetRulesetsLinkedToControls.mockResolvedValue([])
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("forhåndsvisning loader — parameter validation", () => {
	it("throws 400 when seksjon param is missing", async () => {
		await expect(callLoader({ seksjon: undefined })).rejects.toSatisfy((e: unknown) => hasStatus(e, 400))
	})

	it("throws 400 when rutineId param is missing", async () => {
		await expect(callLoader({ rutineId: undefined })).rejects.toSatisfy((e: unknown) => hasStatus(e, 400))
	})
})

describe("forhåndsvisning loader — section and routine lookups", () => {
	it("throws 404 when section is not found", async () => {
		mockGetSectionBySlug.mockResolvedValue(null)
		await expect(callLoader()).rejects.toSatisfy((e: unknown) => hasStatus(e, 404))
	})

	it("throws 404 when routine is not found", async () => {
		mockGetRoutine.mockResolvedValue(null)
		await expect(callLoader()).rejects.toSatisfy((e: unknown) => hasStatus(e, 404))
	})

	it("throws 403 when routine belongs to a different section", async () => {
		mockGetRoutine.mockResolvedValue({ ...baseRoutine, sectionId: "00000000-0000-0000-0000-000000000099" })
		await expect(callLoader()).rejects.toSatisfy((e: unknown) => hasStatus(e, 403))
	})

	it("calls getSectionBySlug with the seksjon param", async () => {
		await callLoader({ seksjon: "min-seksjon" })
		expect(mockGetSectionBySlug).toHaveBeenCalledWith("min-seksjon")
	})

	it("calls getRoutine with the rutineId param", async () => {
		await callLoader()
		expect(mockGetRoutine).toHaveBeenCalledWith(ROUTINE_ID)
	})
})

describe("forhåndsvisning loader — no seeding or write operations", () => {
	it("never calls seedEntraActivity regardless of activity links", async () => {
		mockGetRoutineActivityLinks.mockResolvedValue([
			{ id: LINK_ID_ENTRA, activityType: "entra_id_group_maintenance", sortOrder: 0, stepTitle: null },
		])
		await callLoader()
		expect(mockSeedEntraActivity).not.toHaveBeenCalled()
	})

	it("never calls seedOracleRoleCriticalityActivity regardless of activity links", async () => {
		mockGetRoutineActivityLinks.mockResolvedValue([
			{ id: LINK_ID_ORACLE, activityType: "oracle_role_criticality", sortOrder: 0, stepTitle: null },
		])
		await callLoader()
		expect(mockSeedOracleRoleCriticalityActivity).not.toHaveBeenCalled()
	})

	it("never calls seedManualActivity regardless of activity links", async () => {
		mockGetRoutineActivityLinks.mockResolvedValue([
			{
				id: LINK_ID_MANUAL,
				activityType: "manual_activity",
				sortOrder: 0,
				stepTitle: "Verifiser tilganger",
				stepDescription: null,
				stepComponents: null,
			},
		])
		await callLoader()
		expect(mockSeedManualActivity).not.toHaveBeenCalled()
	})

	it("never calls createReview", async () => {
		await callLoader()
		expect(mockCreateReview).not.toHaveBeenCalled()
	})

	it("never calls autoCreateActivitiesForReview", async () => {
		await callLoader()
		expect(mockAutoCreateActivitiesForReview).not.toHaveBeenCalled()
	})

	it("never calls getReview", async () => {
		await callLoader()
		expect(mockGetReview).not.toHaveBeenCalled()
	})

	it("never calls getReviewActivities", async () => {
		await callLoader()
		expect(mockGetReviewActivities).not.toHaveBeenCalled()
	})

	it("never calls completeReview", async () => {
		await callLoader()
		expect(mockCompleteReview).not.toHaveBeenCalled()
	})
})

describe("forhåndsvisning loader — no external API calls", () => {
	it("never calls getApplicationDetail (nais API) even when activity links exist", async () => {
		mockGetRoutineActivityLinks.mockResolvedValue([
			{ id: LINK_ID_ENTRA, activityType: "entra_id_group_maintenance", sortOrder: 0, stepTitle: null },
			{ id: LINK_ID_RPA, activityType: "rpa_user_maintenance", sortOrder: 1, stepTitle: null },
		])
		await callLoader()
		expect(mockGetApplicationDetail).not.toHaveBeenCalled()
	})

	it("never calls getOracleInstancesForApp even when oracle activity is configured", async () => {
		mockGetRoutineActivityLinks.mockResolvedValue([
			{ id: LINK_ID_ORACLE, activityType: "oracle_role_criticality", sortOrder: 0, stepTitle: null },
		])
		await callLoader()
		expect(mockGetOracleInstancesForApp).not.toHaveBeenCalled()
	})

	it("never calls getEvidenceDownloadsForActivityWithBucketDetails", async () => {
		mockGetRoutineActivityLinks.mockResolvedValue([
			{ id: LINK_ID_ORACLE, activityType: "oracle_evidence_all", sortOrder: 0, stepTitle: null },
		])
		await callLoader()
		expect(mockGetEvidenceDownloads).not.toHaveBeenCalled()
	})

	it("never calls getTeamMembersForApp", async () => {
		await callLoader()
		expect(mockGetTeamMembersForApp).not.toHaveBeenCalled()
	})
})

describe("forhåndsvisning loader — successful load", () => {
	it("returns section, routine, activityLinks, activitySteps and linkedRulesets", async () => {
		const result = await callLoader()
		const payload = "data" in result ? (result as { data: Record<string, unknown> }).data : result
		expect(payload).toHaveProperty("section")
		expect(payload).toHaveProperty("routine")
		expect(payload).toHaveProperty("activityLinks")
		expect(payload).toHaveProperty("activitySteps")
		expect(payload).toHaveProperty("linkedRulesets")
	})

	it("renders routine description as HTML", async () => {
		const result = await callLoader()
		const payload = "data" in result ? (result as { data: Record<string, unknown> }).data : result
		expect(payload).toHaveProperty("routineDescriptionHtml", "<p>Beskrivelse av rutinen</p>")
	})

	it("calls getRoutineActivityLinks with the routine ID", async () => {
		await callLoader()
		expect(mockGetRoutineActivityLinks).toHaveBeenCalledWith(ROUTINE_ID)
	})

	it("calls getActivityStepsForRoutine with the routine ID", async () => {
		await callLoader()
		expect(mockGetActivityStepsForRoutine).toHaveBeenCalledWith(ROUTINE_ID)
	})

	it("returns activity links from the database", async () => {
		mockGetRoutineActivityLinks.mockResolvedValue([
			{ id: LINK_ID_ENTRA, activityType: "entra_id_group_maintenance", sortOrder: 0, stepTitle: null },
			{ id: LINK_ID_RPA, activityType: "rpa_user_maintenance", sortOrder: 1, stepTitle: null },
		])
		const result = await callLoader()
		const payload = "data" in result ? (result as { data: Record<string, unknown> }).data : result
		const links = payload.activityLinks as Array<{ activityType: string }>
		expect(links).toHaveLength(2)
		expect(links[0].activityType).toBe("entra_id_group_maintenance")
		expect(links[1].activityType).toBe("rpa_user_maintenance")
	})

	it("returns manual activity steps from the database", async () => {
		const fakeSteps = [
			{ id: "step-1", title: "Steg én", description: "Gjør dette", sortOrder: 1 },
			{ id: "step-2", title: "Steg to", description: null, sortOrder: 2 },
		]
		mockGetActivityStepsForRoutine.mockResolvedValue(fakeSteps)
		const result = await callLoader()
		const payload = "data" in result ? (result as { data: Record<string, unknown> }).data : result
		const steps = payload.activitySteps as typeof fakeSteps
		expect(steps).toHaveLength(2)
		expect(steps[0].title).toBe("Steg én")
	})
})

describe("forhåndsvisning loader — rulesets", () => {
	it("does not call getRulesetsLinkedToControls when routine has no controls", async () => {
		mockGetRoutine.mockResolvedValue({ ...baseRoutine, controls: [] })
		await callLoader()
		expect(mockGetRulesetsLinkedToControls).not.toHaveBeenCalled()
	})

	it("calls getRulesetsLinkedToControls with control IDs when routine has controls", async () => {
		const controlId = "00000000-0000-0000-0000-000000000020"
		mockGetRoutine.mockResolvedValue({
			...baseRoutine,
			controls: [
				{ id: controlId, controlId: "K-ST.01", name: "Sikkerhetstesting", responsible: null, domainSlug: null },
			],
		})
		await callLoader()
		expect(mockGetRulesetsLinkedToControls).toHaveBeenCalledWith([controlId], SECTION_ID)
	})

	it("returns linked rulesets with rendered descriptions", async () => {
		const controlId = "00000000-0000-0000-0000-000000000020"
		mockGetRoutine.mockResolvedValue({
			...baseRoutine,
			controls: [
				{ id: controlId, controlId: "K-ST.01", name: "Sikkerhetstesting", responsible: null, domainSlug: null },
			],
		})
		mockGetRulesetsLinkedToControls.mockResolvedValue([
			{
				id: "rs-1",
				name: "Regelsett A",
				description: "Regelsett beskrivelse",
				code: null,
				frequency: "annual",
				status: "approved",
				responsibleName: null,
				responsibleRole: null,
				approvalStatus: "approved",
				lastApproval: null,
				controls: [],
			},
		])
		const result = await callLoader()
		const payload = "data" in result ? (result as { data: Record<string, unknown> }).data : result
		const rulesets = payload.linkedRulesets as Array<{ name: string; descriptionHtml: string | null }>
		expect(rulesets).toHaveLength(1)
		expect(rulesets[0].name).toBe("Regelsett A")
		expect(rulesets[0].descriptionHtml).toBe("<p>Regelsett beskrivelse</p>")
	})
})
