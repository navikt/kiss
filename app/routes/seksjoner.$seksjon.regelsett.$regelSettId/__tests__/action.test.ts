import { beforeEach, describe, expect, it, vi } from "vitest"

// --- Mocks -----------------------------------------------------------

const mockRequireAuthenticatedUser = vi.fn()
vi.mock("~/lib/auth.server", () => ({
	requireAuthenticatedUser: mockRequireAuthenticatedUser,
	getAuthenticatedUser: vi.fn(),
}))

const mockHasAnySectionRole = vi.fn()
const mockRequireAnySectionRole = vi.fn()
vi.mock("~/lib/authorization.server", () => ({
	hasAnySectionRole: mockHasAnySectionRole,
	hasExactRoleForSection: vi.fn(),
	isAdmin: vi.fn(),
	requireAdmin: vi.fn(),
	requireAnySectionRole: mockRequireAnySectionRole,
}))

const mockGetRulesetMeta = vi.fn()
const mockCopyRuleset = vi.fn()
const mockCopyRulesetToSection = vi.fn()
vi.mock("~/db/queries/rulesets.server", () => ({
	approveRuleset: vi.fn(),
	copyRuleset: mockCopyRuleset,
	copyRulesetToSection: mockCopyRulesetToSection,
	getRulesetDetail: vi.fn(),
	getRulesetMeta: mockGetRulesetMeta,
	getRulesetNamesByIds: vi.fn().mockResolvedValue(new Map()),
	linkRoutineToRuleset: vi.fn(),
	replaceRuleset: vi.fn(),
	unlinkRoutineFromRuleset: vi.fn(),
}))

const mockGetSectionBySlug = vi.fn()
const mockGetSections = vi.fn().mockResolvedValue([])
vi.mock("~/db/queries/sections.server", () => ({
	getSectionBySlug: mockGetSectionBySlug,
	getSections: mockGetSections,
}))

vi.mock("~/db/queries/audit.server", () => ({
	getAuditLogForEntity: vi.fn().mockResolvedValue([]),
}))

vi.mock("~/db/queries/routines.server", () => ({
	getRoutinesForSection: vi.fn().mockResolvedValue([]),
}))

vi.mock("~/db/queries/users.server", () => ({
	getUserNamesByNavIdents: vi.fn().mockResolvedValue(new Map()),
}))

vi.mock("~/lib/markdown.server", () => ({
	renderMarkdown: vi.fn().mockReturnValue(""),
}))

const { action } = await import("../index")

// --- Helpers ---------------------------------------------------------

const fakeUser = {
	navIdent: "Z990001",
	name: "Glad Fjord",
	groups: [],
	token: "t",
	dbRoles: [],
}

const fakeSection = { id: "section-1", name: "Test", slug: "test-seksjon" }

const fakeMeta = {
	id: "ruleset-1",
	sectionId: "section-1",
	status: "active",
	archivedAt: null,
}

function makeRequest(formData: FormData): Request {
	return new Request("http://localhost/seksjoner/test-seksjon/regelsett/ruleset-1", {
		method: "POST",
		body: formData,
	})
}

function callAction(formData: FormData) {
	return action({
		request: makeRequest(formData),
		params: { seksjon: "test-seksjon", regelSettId: "ruleset-1" },
		context: {},
	} as unknown as Parameters<typeof action>[0])
}

// --- Tests -----------------------------------------------------------

beforeEach(() => {
	vi.clearAllMocks()
	mockRequireAuthenticatedUser.mockResolvedValue(fakeUser)
	mockGetSectionBySlug.mockResolvedValue(fakeSection)
	mockGetRulesetMeta.mockResolvedValue(fakeMeta)
	mockGetSections.mockResolvedValue([])
})

describe("copy-to-section intent", () => {
	it("copies ruleset to target section when user has target section role", async () => {
		mockRequireAnySectionRole.mockImplementation(() => {})
		mockGetSections.mockResolvedValue([{ id: "section-2", slug: "annen-seksjon", archivedAt: null }])
		mockCopyRulesetToSection.mockResolvedValue({ id: "ruleset-copy-2" })

		const fd = new FormData()
		fd.set("intent", "copy-to-section")
		fd.set("targetSectionId", "section-2")

		const response = (await callAction(fd)) as Response
		expect(response.status).toBe(302)
		expect(response.headers.get("location")).toContain("annen-seksjon")
		expect(response.headers.get("location")).toContain("ruleset-copy-2")
		expect(mockRequireAnySectionRole).toHaveBeenCalledWith(fakeUser, "section-2")
		expect(mockCopyRulesetToSection).toHaveBeenCalledWith("ruleset-1", "section-2", "Z990001")
	})

	it("rejects copy-to-section when user lacks target section role", async () => {
		mockRequireAnySectionRole.mockImplementation(() => {
			throw new Response("Ingen tilgang", { status: 403 })
		})

		const fd = new FormData()
		fd.set("intent", "copy-to-section")
		fd.set("targetSectionId", "section-2")

		await expect(callAction(fd)).rejects.toMatchObject({ status: 403 })
		expect(mockCopyRulesetToSection).not.toHaveBeenCalled()
	})

	it("returns error result for blank target section", async () => {
		const fd = new FormData()
		fd.set("intent", "copy-to-section")
		fd.set("targetSectionId", "  ")

		const result = await callAction(fd)
		expect(result).toMatchObject({ data: { success: false } })
		expect(mockCopyRulesetToSection).not.toHaveBeenCalled()
	})

	it("rejects copy-to-section when source ruleset is archived", async () => {
		mockRequireAnySectionRole.mockImplementation(() => {})
		mockGetRulesetMeta.mockResolvedValue({ ...fakeMeta, archivedAt: new Date() })

		const fd = new FormData()
		fd.set("intent", "copy-to-section")
		fd.set("targetSectionId", "section-2")

		const result = await callAction(fd)
		expect(result).toMatchObject({ data: { success: false } })
		expect(mockCopyRulesetToSection).not.toHaveBeenCalled()
	})

	it("copies ruleset to target section even when source ruleset is a draft", async () => {
		mockRequireAnySectionRole.mockImplementation(() => {})
		mockGetRulesetMeta.mockResolvedValue({ ...fakeMeta, status: "draft" })
		mockGetSections.mockResolvedValue([{ id: "section-2", slug: "annen-seksjon", archivedAt: null }])
		mockCopyRulesetToSection.mockResolvedValue({ id: "ruleset-copy-2" })

		const fd = new FormData()
		fd.set("intent", "copy-to-section")
		fd.set("targetSectionId", "section-2")

		const response = (await callAction(fd)) as Response
		expect(response.status).toBe(302)
		expect(mockCopyRulesetToSection).toHaveBeenCalledWith("ruleset-1", "section-2", "Z990001")
	})

	it("returns error result when target section does not exist", async () => {
		mockRequireAnySectionRole.mockImplementation(() => {})
		mockGetSections.mockResolvedValue([])

		const fd = new FormData()
		fd.set("intent", "copy-to-section")
		fd.set("targetSectionId", "section-2")

		const result = await callAction(fd)
		expect(result).toMatchObject({ data: { success: false } })
		expect(mockCopyRulesetToSection).not.toHaveBeenCalled()
	})
})
