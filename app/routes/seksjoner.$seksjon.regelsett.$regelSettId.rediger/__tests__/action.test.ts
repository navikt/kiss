import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGetAuthenticatedUser = vi.fn()
const mockRequireUser = vi.fn()
vi.mock("~/lib/auth.server", () => ({
	getAuthenticatedUser: mockGetAuthenticatedUser,
	requireUser: mockRequireUser,
}))

const mockIsAdmin = vi.fn()
const mockRequireAdmin = vi.fn()
const mockRequireAnySectionRole = vi.fn()
vi.mock("~/lib/authorization.server", () => ({
	isAdmin: mockIsAdmin,
	requireAdmin: mockRequireAdmin,
	requireAnySectionRole: mockRequireAnySectionRole,
}))

const mockGetSectionBySlug = vi.fn()
vi.mock("~/db/queries/sections.server", () => ({
	getSectionBySlug: mockGetSectionBySlug,
}))

const mockGetRulesetDetail = vi.fn()
const mockGetRulesetMeta = vi.fn()
const mockUpdateRuleset = vi.fn()
const mockArchiveRuleset = vi.fn()
const mockUnarchiveRuleset = vi.fn()
const mockLinkControlToRuleset = vi.fn()
const mockUnlinkControlFromRuleset = vi.fn()
vi.mock("~/db/queries/rulesets.server", () => ({
	getRulesetDetail: mockGetRulesetDetail,
	getRulesetMeta: mockGetRulesetMeta,
	updateRuleset: mockUpdateRuleset,
	archiveRuleset: mockArchiveRuleset,
	unarchiveRuleset: mockUnarchiveRuleset,
	linkControlToRuleset: mockLinkControlToRuleset,
	unlinkControlFromRuleset: mockUnlinkControlFromRuleset,
}))

vi.mock("~/db/queries/framework.server", () => ({
	getAllControlsForSelection: vi.fn().mockResolvedValue([]),
}))

const { action } = await import("../index")

const fakeUser = {
	navIdent: "A123456",
	name: "Testbruker",
	groups: [],
	token: "t",
	dbRoles: [],
}

const fakeSection = { id: "section-1", slug: "pensjon", name: "Pensjon" }

function makeRuleset(overrides: Record<string, unknown> = {}) {
	return {
		id: "ruleset-1",
		sectionId: fakeSection.id,
		status: "draft",
		lastApproval: null,
		...overrides,
	}
}

function makeRequest(formData: FormData): Request {
	return new Request("http://localhost/seksjoner/pensjon/regelsett/ruleset-1/rediger", {
		method: "POST",
		body: formData,
	})
}

function callAction(formData: FormData) {
	return action({
		request: makeRequest(formData),
		params: { seksjon: fakeSection.slug, regelSettId: "ruleset-1" },
		context: {},
	} as unknown as Parameters<typeof action>[0])
}

function getData(result: unknown): { success: boolean; error?: string; message?: string } {
	if (result && typeof result === "object" && "data" in result) {
		return (result as { data: { success: boolean; error?: string; message?: string } }).data
	}
	throw new Error("Expected DataWithResponseInit result")
}

beforeEach(() => {
	vi.resetAllMocks()
	mockGetAuthenticatedUser.mockResolvedValue(fakeUser)
	mockRequireUser.mockReturnValue(fakeUser)
	mockIsAdmin.mockReturnValue(false)
	mockRequireAnySectionRole.mockImplementation(() => undefined)
	mockGetSectionBySlug.mockResolvedValue(fakeSection)
	mockGetRulesetDetail.mockResolvedValue(makeRuleset())
	mockUpdateRuleset.mockResolvedValue(true)
})

describe("ruleset edit action authorization", () => {
	it("allows section-role user to update an unapproved ruleset", async () => {
		const formData = new FormData()
		formData.set("intent", "update")
		formData.set("name", "Oppdatert regelsett")
		formData.set("responsibleType", "person")
		formData.set("frequency", "annually")

		const result = await callAction(formData)
		const data = getData(result)

		expect(mockRequireAnySectionRole).toHaveBeenCalledWith(fakeUser, fakeSection.id)
		expect(data).toEqual({ success: true, message: "Regelsett oppdatert." })
		expect(mockUpdateRuleset).toHaveBeenCalled()
	})

	it("rejects section-role user when ruleset is approved", async () => {
		mockGetRulesetDetail.mockResolvedValue(makeRuleset({ lastApproval: { validUntil: new Date() }, status: "active" }))

		const formData = new FormData()
		formData.set("intent", "update")
		formData.set("name", "Skal avvises")
		formData.set("responsibleType", "person")
		formData.set("frequency", "annually")

		const result = await callAction(formData)
		const data = getData(result)

		expect(data).toEqual({ success: false, error: "Regelsettet er godkjent og kan ikke redigeres." })
		expect(mockUpdateRuleset).not.toHaveBeenCalled()
	})

	it("allows admin to update an approved ruleset", async () => {
		mockIsAdmin.mockReturnValue(true)
		mockGetRulesetDetail.mockResolvedValue(makeRuleset({ lastApproval: { validUntil: new Date() }, status: "active" }))

		const formData = new FormData()
		formData.set("intent", "update")
		formData.set("name", "Admin kan oppdatere")
		formData.set("responsibleType", "person")
		formData.set("frequency", "annually")

		const result = await callAction(formData)
		const data = getData(result)

		expect(data).toEqual({ success: true, message: "Regelsett oppdatert." })
		expect(mockUpdateRuleset).toHaveBeenCalled()
	})
})
