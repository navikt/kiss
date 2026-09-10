import { beforeEach, describe, expect, it, vi } from "vitest"

const mockRequireAuthenticatedUser = vi.fn()
vi.mock("~/lib/auth.server", () => ({
	requireAuthenticatedUser: mockRequireAuthenticatedUser,
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
const mockCopyRuleset = vi.fn()
vi.mock("~/db/queries/rulesets.server", () => ({
	getRulesetDetail: mockGetRulesetDetail,
	getRulesetMeta: mockGetRulesetMeta,
	updateRuleset: mockUpdateRuleset,
	archiveRuleset: mockArchiveRuleset,
	unarchiveRuleset: mockUnarchiveRuleset,
	linkControlToRuleset: mockLinkControlToRuleset,
	unlinkControlFromRuleset: mockUnlinkControlFromRuleset,
	copyRuleset: mockCopyRuleset,
}))

vi.mock("~/db/queries/framework.server", () => ({
	getAllControlsForSelection: vi.fn().mockResolvedValue([]),
}))

const { action } = await import("../index")

const fakeUser = {
	navIdent: "Z990001",
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
	mockRequireAuthenticatedUser.mockResolvedValue(fakeUser)
	mockIsAdmin.mockReturnValue(false)
	mockRequireAnySectionRole.mockImplementation(() => undefined)
	mockGetSectionBySlug.mockResolvedValue(fakeSection)
	mockGetRulesetDetail.mockResolvedValue(makeRuleset())
	mockGetRulesetMeta.mockResolvedValue({
		id: "ruleset-1",
		sectionId: fakeSection.id,
		status: "draft",
		archivedAt: null,
	})
	mockUpdateRuleset.mockResolvedValue(true)
})

describe("ruleset edit action authorization", () => {
	it("allows section-role user to update a draft (unapproved) ruleset", async () => {
		const formData = new FormData()
		formData.set("intent", "update")
		formData.set("name", "Oppdatert regelsett")
		formData.set("responsibleType", "person")
		formData.set("frequency", "annually")

		const result = await callAction(formData)
		const data = getData(result)

		expect(mockRequireAnySectionRole).toHaveBeenCalledWith(fakeUser, fakeSection.id)
		expect(data).toEqual({ success: true, message: "Regelsett oppdatert." })
		expect(mockUpdateRuleset).toHaveBeenCalledWith(
			"ruleset-1",
			expect.objectContaining({ updatedBy: fakeUser.navIdent }),
		)
	})

	it("rejects section-role user when ruleset is approved (active)", async () => {
		mockGetRulesetMeta.mockResolvedValue({
			id: "ruleset-1",
			sectionId: fakeSection.id,
			status: "active",
			archivedAt: null,
		})

		const formData = new FormData()
		formData.set("intent", "update")
		formData.set("name", "Skal avvises")
		formData.set("responsibleType", "person")
		formData.set("frequency", "annually")

		const result = await callAction(formData)
		const data = getData(result)

		expect(data).toEqual({
			success: false,
			error: "Regelsettet er godkjent og kan ikke redigeres direkte. Kopier det for å redigere.",
		})
		expect(mockUpdateRuleset).not.toHaveBeenCalled()
	})

	it("rejects admin too when ruleset is approved (active) — no bypass", async () => {
		mockIsAdmin.mockReturnValue(true)
		mockGetRulesetMeta.mockResolvedValue({
			id: "ruleset-1",
			sectionId: fakeSection.id,
			status: "active",
			archivedAt: null,
		})

		const formData = new FormData()
		formData.set("intent", "update")
		formData.set("name", "Admin skal ikke kunne oppdatere direkte")
		formData.set("responsibleType", "person")
		formData.set("frequency", "annually")

		const result = await callAction(formData)
		const data = getData(result)

		expect(data).toEqual({
			success: false,
			error: "Regelsettet er godkjent og kan ikke redigeres direkte. Kopier det for å redigere.",
		})
		expect(mockUpdateRuleset).not.toHaveBeenCalled()
	})

	it("copies an approved (active) ruleset and redirects to the copy's edit page", async () => {
		mockGetRulesetMeta.mockResolvedValue({
			id: "ruleset-1",
			sectionId: fakeSection.id,
			status: "active",
			archivedAt: null,
		})
		mockCopyRuleset.mockResolvedValue({ id: "ruleset-2", sourceRulesetId: "ruleset-1", status: "draft" })

		const formData = new FormData()
		formData.set("intent", "copy")

		const result = await callAction(formData)

		expect(mockCopyRuleset).toHaveBeenCalledWith("ruleset-1", fakeUser.navIdent)
		expect(result).toBeInstanceOf(Response)
		expect((result as Response).status).toBe(302)
		expect((result as Response).headers.get("Location")).toBe("/seksjoner/pensjon/regelsett/ruleset-2/rediger")
	})

	it("rejects copy intent when ruleset is still a draft", async () => {
		mockGetRulesetMeta.mockResolvedValue({
			id: "ruleset-1",
			sectionId: fakeSection.id,
			status: "draft",
			archivedAt: null,
		})

		const formData = new FormData()
		formData.set("intent", "copy")

		const result = await callAction(formData)
		const data = getData(result)

		expect(data).toEqual({ success: false, error: "Kun godkjente regelsett kan kopieres for redigering." })
		expect(mockCopyRuleset).not.toHaveBeenCalled()
	})
})
