import { beforeEach, describe, expect, it, vi } from "vitest"

// --- Mocks -----------------------------------------------------------

const mockRequireAuthenticatedUser = vi.fn()
vi.mock("~/lib/auth.server", () => ({
	requireAuthenticatedUser: (...args: unknown[]) => mockRequireAuthenticatedUser(...args),
}))

const mockRequireApplicationManagementAccess = vi.fn()
vi.mock("~/lib/authorization.server", () => ({
	requireApplicationManagementAccess: (...args: unknown[]) => mockRequireApplicationManagementAccess(...args),
	isAdmin: vi.fn(() => true),
}))

const mockConfigureOracleInstance = vi.fn()
const mockRemoveOracleInstance = vi.fn()
const mockGetOracleInstancesForApp = vi.fn()
const mockSaveAuditEvidenceSnapshot = vi.fn()
const mockSetIncludeInReport = vi.fn()
vi.mock("~/db/queries/audit-evidence.server", () => ({
	configureOracleInstance: (...args: unknown[]) => mockConfigureOracleInstance(...args),
	getOracleInstancesForApp: (...args: unknown[]) => mockGetOracleInstancesForApp(...args),
	removeOracleInstance: (...args: unknown[]) => mockRemoveOracleInstance(...args),
	saveAuditEvidenceSnapshot: (...args: unknown[]) => mockSaveAuditEvidenceSnapshot(...args),
	setIncludeInReport: (...args: unknown[]) => mockSetIncludeInReport(...args),
}))

const mockLinkAppToTeam = vi.fn()
const mockUnlinkAppFromTeam = vi.fn()
vi.mock("~/db/queries/applications.server", () => ({
	getAppScopeIds: vi.fn().mockResolvedValue({ sectionIds: [] }),
	getAppAssessments: vi.fn(),
	getAvailableTeamsForApp: vi.fn().mockResolvedValue([]),
	linkAppToTeam: mockLinkAppToTeam,
	unlinkAppFromTeam: mockUnlinkAppFromTeam,
}))

const mockGetApplicationDetail = vi.fn()
const mockLinkApplication = vi.fn()
const mockUnlinkApplication = vi.fn()
const mockPromoteToPrimary = vi.fn()
const mockLinkPersistenceToOracleInstance = vi.fn()
vi.mock("~/db/queries/nais.server", () => ({
	findLinkCandidates: vi.fn().mockResolvedValue([]),
	getLinkCandidatesForSection: vi.fn().mockResolvedValue([]),
	getApplicationDetail: (...args: unknown[]) => mockGetApplicationDetail(...args),
	linkPersistenceToOracleInstance: (...args: unknown[]) => mockLinkPersistenceToOracleInstance(...args),
	linkApplication: (...args: unknown[]) => mockLinkApplication(...args),
	promoteToPrimary: (...args: unknown[]) => mockPromoteToPrimary(...args),
	unlinkApplication: (...args: unknown[]) => mockUnlinkApplication(...args),
}))

const mockCanUserSeeInstance = vi.fn()
vi.mock("~/lib/oracle-access.server", () => ({
	canUserSeeInstance: (...args: unknown[]) => mockCanUserSeeInstance(...args),
	filterInstancesByAccess: (instances: Array<{ group: string | null }>, groups: string[]) =>
		instances.filter((instance) => mockCanUserSeeInstance(instance, groups)),
}))

const mockGetOracleInstances = vi.fn()
const mockGetAuditEvidence = vi.fn()
const mockGetAuditEvidenceExcel = vi.fn()
vi.mock("~/lib/oracle-revisjon.server", () => ({
	getOracleInstances: (...args: unknown[]) => mockGetOracleInstances(...args),
	getAuditEvidence: (...args: unknown[]) => mockGetAuditEvidence(...args),
	getAuditEvidenceExcel: (...args: unknown[]) => mockGetAuditEvidenceExcel(...args),
}))

const mockConfirmApplicationElement = vi.fn()
const mockRejectApplicationElement = vi.fn()
vi.mock("~/db/queries/technology-elements.server", () => ({
	getApplicationElements: vi.fn().mockResolvedValue([]),
	getAllTechnologyElements: vi.fn().mockResolvedValue([]),
	addApplicationElement: vi.fn(),
	removeApplicationElement: vi.fn(),
	confirmApplicationElement: (...args: unknown[]) => mockConfirmApplicationElement(...args),
	rejectApplicationElement: (...args: unknown[]) => mockRejectApplicationElement(...args),
}))

vi.mock("~/lib/markdown.server", () => ({
	renderMarkdown: vi.fn(() => ""),
}))

vi.mock("~/db/queries/users.server", () => ({
	getUserNamesByNavIdents: vi.fn().mockResolvedValue(new Map()),
}))

const { action } = await import("../index")
const { loader } = await import("../loader.server")

// --- Helpers ---------------------------------------------------------

function makeRequest(formData: FormData, rawUrl = "http://localhost/applikasjoner/app-1/rediger"): Request {
	return new Request(rawUrl, {
		method: "POST",
		body: formData,
	})
}

// React Router v8 leverer en normalisert `url` som søsken-argument til `request`, der
// .data-suffiks og index/_routes-søkeparametre allerede er fjernet. Simuler det her slik at
// testene reflekterer den faktiske v8-kontrakten, i stedet for å sende rå request-URL som url.
function normalizeUrl(rawUrl: string): URL {
	const normalized = new URL(rawUrl)
	normalized.pathname = normalized.pathname.replace(/\.data$/, "")
	normalized.searchParams.delete("index")
	normalized.searchParams.delete("_routes")
	return normalized
}

function callAction(formData: FormData, appId = "app-1") {
	const rawUrl = `http://localhost/applikasjoner/${appId}/rediger`
	return action({
		request: makeRequest(formData, rawUrl),
		params: { appId },
		url: normalizeUrl(rawUrl),
		context: {},
	} as unknown as Parameters<typeof action>[0])
}

// --- Tests -----------------------------------------------------------

describe("applikasjoner.$appId.detaljer action – team linking", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockGetOracleInstancesForApp.mockReset()
		mockGetOracleInstances.mockReset()
		mockGetApplicationDetail.mockReset()
		mockRequireAuthenticatedUser.mockResolvedValue({ navIdent: "Z123456", groups: ["allowed-group"] })
		mockCanUserSeeInstance.mockImplementation(
			(instance, groups) => instance.group === null || groups.includes(instance.group),
		)
	})

	it("requires management access to both applications when linking them", async () => {
		const formData = new FormData()
		formData.set("intent", "link")
		formData.set("linkedId", "app-2")

		const result = (await callAction(formData)) as Response

		expect(mockRequireApplicationManagementAccess).toHaveBeenNthCalledWith(
			1,
			{ navIdent: "Z123456", groups: ["allowed-group"] },
			"app-1",
		)
		expect(mockRequireApplicationManagementAccess).toHaveBeenNthCalledWith(
			2,
			{ navIdent: "Z123456", groups: ["allowed-group"] },
			"app-2",
		)
		expect(mockLinkApplication).toHaveBeenCalledWith("app-2", "app-1", "Z123456")
		expect(result.headers.get("Location")).toBe("/applikasjoner/app-1/rediger")
	})

	it("does not unlink an application that is not linked to the current app", async () => {
		mockGetApplicationDetail.mockResolvedValueOnce({ linkedApps: [] })
		const formData = new FormData()
		formData.set("intent", "unlink")
		formData.set("unlinkId", "app-2")

		await expect(callAction(formData)).rejects.toMatchObject({ status: 403 })

		expect(mockUnlinkApplication).not.toHaveBeenCalled()
		expect(mockRequireApplicationManagementAccess).toHaveBeenCalledTimes(1)
	})

	it("requires management access to the linked app before unlinking it", async () => {
		mockGetApplicationDetail.mockResolvedValueOnce({ linkedApps: [{ id: "app-2" }] })
		const formData = new FormData()
		formData.set("intent", "unlink")
		formData.set("unlinkId", "app-2")

		const result = (await callAction(formData)) as Response

		expect(mockRequireApplicationManagementAccess).toHaveBeenNthCalledWith(
			2,
			{ navIdent: "Z123456", groups: ["allowed-group"] },
			"app-2",
		)
		expect(mockUnlinkApplication).toHaveBeenCalledWith("app-2", "app-1", "Z123456")
		expect(result.headers.get("Location")).toBe("/applikasjoner/app-1/rediger")
	})

	it("requires access to every linked application before promoting a child", async () => {
		mockGetApplicationDetail.mockResolvedValueOnce({ linkedApps: [{ id: "app-2" }, { id: "app-3" }] })
		const formData = new FormData()
		formData.set("intent", "promoteToPrimary")
		formData.set("newPrimaryId", "app-2")

		const result = (await callAction(formData)) as Response

		expect(mockRequireApplicationManagementAccess).toHaveBeenNthCalledWith(
			2,
			{ navIdent: "Z123456", groups: ["allowed-group"] },
			"app-2",
		)
		expect(mockRequireApplicationManagementAccess).toHaveBeenNthCalledWith(
			3,
			{ navIdent: "Z123456", groups: ["allowed-group"] },
			"app-3",
		)
		expect(mockPromoteToPrimary).toHaveBeenCalledWith("app-2", "app-1", "Z123456", ["app-1", "app-2", "app-3"])
		expect(result.headers.get("Location")).toBe("/applikasjoner/app-2/rediger")
	})

	it("requires access to every sibling before promoting this child", async () => {
		mockGetApplicationDetail
			.mockResolvedValueOnce({ primaryApp: { id: "app-primary" } })
			.mockResolvedValueOnce({ linkedApps: [{ id: "app-1" }, { id: "app-sibling" }] })
		const formData = new FormData()
		formData.set("intent", "promoteThis")
		formData.set("currentPrimaryId", "app-primary")

		const result = (await callAction(formData)) as Response

		expect(mockRequireApplicationManagementAccess).toHaveBeenNthCalledWith(
			4,
			{ navIdent: "Z123456", groups: ["allowed-group"] },
			"app-sibling",
		)
		expect(mockPromoteToPrimary).toHaveBeenCalledWith("app-1", "app-primary", "Z123456", [
			"app-primary",
			"app-1",
			"app-sibling",
		])
		expect(result.headers.get("Location")).toBe("/applikasjoner/app-1/rediger")
	})

	it("rejects linking an application to itself", async () => {
		const formData = new FormData()
		formData.set("intent", "link")
		formData.set("linkedId", "app-1")

		await expect(callAction(formData)).rejects.toMatchObject({ status: 400 })

		expect(mockLinkApplication).not.toHaveBeenCalled()
	})

	it("passes the authorized application ID when confirming or rejecting an element", async () => {
		const confirmForm = new FormData()
		confirmForm.set("intent", "confirmElement")
		confirmForm.set("linkId", "element-link-1")
		await callAction(confirmForm)

		const rejectForm = new FormData()
		rejectForm.set("intent", "rejectElement")
		rejectForm.set("linkId", "element-link-2")
		rejectForm.set("reason", "Ikke relevant")
		await callAction(rejectForm)

		expect(mockConfirmApplicationElement).toHaveBeenCalledWith("app-1", "element-link-1", "Z123456")
		expect(mockRejectApplicationElement).toHaveBeenCalledWith("app-1", "element-link-2", "Ikke relevant", "Z123456")
	})

	it("allows configuration only for an Oracle instance visible to the user", async () => {
		mockGetOracleInstances.mockResolvedValueOnce([{ id: "instance-1", group: "allowed-group" }])
		const formData = new FormData()
		formData.set("intent", "addOracleInstance")
		formData.set("instanceId", "instance-1")

		const result = (await callAction(formData)) as Response

		expect(mockConfigureOracleInstance).toHaveBeenCalledWith("app-1", "instance-1", "Z123456")
		expect(result.headers.get("Location")).toBe("/applikasjoner/app-1/rediger")
	})

	it("rejects configuration of an Oracle instance outside the user's groups", async () => {
		mockGetOracleInstances.mockResolvedValueOnce([{ id: "instance-1", group: "restricted-group" }])
		const formData = new FormData()
		formData.set("intent", "addOracleInstance")
		formData.set("instanceId", "instance-1")

		await expect(callAction(formData)).rejects.toMatchObject({ status: 403 })

		expect(mockConfigureOracleInstance).not.toHaveBeenCalled()
	})

	it("rejects removing an Oracle instance that is not actively linked to the application", async () => {
		mockGetOracleInstancesForApp.mockResolvedValueOnce([])
		const formData = new FormData()
		formData.set("intent", "removeOracleInstance")
		formData.set("instanceId", "instance-1")

		await expect(callAction(formData)).rejects.toMatchObject({ status: 403 })

		expect(mockRemoveOracleInstance).not.toHaveBeenCalled()
		expect(mockGetOracleInstances).not.toHaveBeenCalled()
	})

	it("allows removing a configured instance missing from the Oracle API", async () => {
		mockGetOracleInstancesForApp.mockResolvedValueOnce([{ instanceId: "missing-instance" }])
		mockGetOracleInstances.mockResolvedValueOnce([])
		const formData = new FormData()
		formData.set("intent", "removeOracleInstance")
		formData.set("instanceId", "missing-instance")

		await callAction(formData)

		expect(mockRequireApplicationManagementAccess).toHaveBeenCalledWith(
			{ navIdent: "Z123456", groups: ["allowed-group"] },
			"app-1",
		)
		expect(mockRemoveOracleInstance).toHaveBeenCalledWith("app-1", "missing-instance", "Z123456")
	})

	it("still rejects removal of an existing instance outside the user's groups", async () => {
		mockGetOracleInstancesForApp.mockResolvedValueOnce([{ instanceId: "instance-1" }])
		mockGetOracleInstances.mockResolvedValueOnce([{ id: "instance-1", group: "restricted-group" }])
		const formData = new FormData()
		formData.set("intent", "removeOracleInstance")
		formData.set("instanceId", "instance-1")

		await expect(callAction(formData)).rejects.toMatchObject({ status: 403 })

		expect(mockRemoveOracleInstance).not.toHaveBeenCalled()
	})

	it("does not treat an Oracle API failure as a missing instance", async () => {
		mockGetOracleInstancesForApp.mockResolvedValueOnce([{ instanceId: "instance-1" }])
		const error = new Error("Oracle API unavailable")
		mockGetOracleInstances.mockRejectedValueOnce(error)
		const formData = new FormData()
		formData.set("intent", "removeOracleInstance")
		formData.set("instanceId", "instance-1")

		await expect(callAction(formData)).rejects.toBe(error)

		expect(mockRemoveOracleInstance).not.toHaveBeenCalled()
	})

	it("allows removal of an existing instance within the user's groups", async () => {
		mockGetOracleInstancesForApp.mockResolvedValueOnce([{ instanceId: "instance-1" }])
		mockGetOracleInstances.mockResolvedValueOnce([{ id: "instance-1", group: "allowed-group" }])
		const formData = new FormData()
		formData.set("intent", "removeOracleInstance")
		formData.set("instanceId", "instance-1")

		await callAction(formData)

		expect(mockRemoveOracleInstance).toHaveBeenCalledWith("app-1", "instance-1", "Z123456")
	})

	it.each(["fetchEvidence", "toggleOracleReport", "addOracleInstance"])(
		"rejects %s for an instance missing from the Oracle API",
		async (intent) => {
			mockGetOracleInstancesForApp.mockResolvedValueOnce([{ instanceId: "missing-instance" }])
			mockGetOracleInstances.mockResolvedValueOnce([])
			const formData = new FormData()
			formData.set("intent", intent)
			formData.set("instanceId", "missing-instance")

			await expect(callAction(formData)).rejects.toMatchObject({ status: 403 })

			expect(mockGetAuditEvidence).not.toHaveBeenCalled()
			expect(mockSetIncludeInReport).not.toHaveBeenCalled()
			expect(mockConfigureOracleInstance).not.toHaveBeenCalled()
		},
	)

	it("exposes missing configurations for removal without exposing snapshots or restricted instances", async () => {
		mockGetApplicationDetail.mockResolvedValueOnce({
			app: { id: "app-1", archivedBy: null },
			linkedApps: [],
			environments: [],
			persistence: [],
		})
		mockGetOracleInstancesForApp.mockResolvedValueOnce([
			{ id: "config-1", instanceId: "missing-instance", latestSnapshot: { overallStatus: "sensitive" } },
			{ id: "config-2", instanceId: "restricted-instance" },
			{ id: "config-3", instanceId: "allowed-instance" },
		])
		mockGetOracleInstances.mockResolvedValueOnce([
			{ id: "restricted-instance", group: "restricted-group" },
			{ id: "allowed-instance", group: "allowed-group" },
		])

		const result = await loader({
			request: new Request("http://localhost/applikasjoner/app-1/rediger"),
			params: { appId: "app-1" },
			context: {},
		} as Parameters<typeof loader>[0])

		expect(result.data.unavailableOracleInstances).toEqual([{ id: "config-1", instanceId: "missing-instance" }])
		expect(result.data.oracleInstances).toEqual([{ id: "config-3", instanceId: "allowed-instance" }])
	})

	it("rejects fetching evidence for an Oracle instance outside the user's groups", async () => {
		mockGetOracleInstancesForApp.mockResolvedValueOnce([{ instanceId: "instance-1" }])
		mockGetOracleInstances.mockResolvedValueOnce([{ id: "instance-1", group: "restricted-group" }])
		const formData = new FormData()
		formData.set("intent", "fetchEvidence")
		formData.set("instanceId", "instance-1")

		await expect(callAction(formData)).rejects.toMatchObject({ status: 403 })

		expect(mockGetAuditEvidence).not.toHaveBeenCalled()
		expect(mockGetAuditEvidenceExcel).not.toHaveBeenCalled()
		expect(mockSaveAuditEvidenceSnapshot).not.toHaveBeenCalled()
	})

	it("rejects linking a persistence row that does not belong to the application", async () => {
		mockGetApplicationDetail.mockResolvedValueOnce({ persistence: [] })
		const formData = new FormData()
		formData.set("intent", "linkPersistenceToOracle")
		formData.set("persistenceId", "foreign-persistence")
		formData.set("oracleInstanceId", "instance-1")

		await expect(callAction(formData)).rejects.toMatchObject({ status: 403 })

		expect(mockLinkPersistenceToOracleInstance).not.toHaveBeenCalled()
	})

	it("allows clearing a stale Oracle persistence link after its instance was archived", async () => {
		mockGetApplicationDetail.mockResolvedValueOnce({
			persistence: [
				{
					id: "persistence-1",
					type: "oracle",
					oracleInstanceId: "archived-instance",
				},
			],
		})
		mockGetOracleInstancesForApp.mockResolvedValueOnce([])
		const formData = new FormData()
		formData.set("intent", "linkPersistenceToOracle")
		formData.set("persistenceId", "persistence-1")

		const result = (await callAction(formData)) as Response

		expect(mockLinkPersistenceToOracleInstance).toHaveBeenCalledWith("persistence-1", null, "Z123456")
		expect(mockGetOracleInstances).not.toHaveBeenCalled()
		expect(result.headers.get("Location")).toBe("/applikasjoner/app-1/rediger")
	})

	it("links a team to an application", async () => {
		const formData = new FormData()
		formData.set("intent", "link-team")
		formData.set("devTeamId", "team-1")

		try {
			await callAction(formData)
		} catch (thrown) {
			// redirect throws a Response
			expect(thrown).toBeInstanceOf(Response)
			expect((thrown as Response).status).toBe(302)
		}

		expect(mockLinkAppToTeam).toHaveBeenCalledWith("app-1", "team-1", "Z123456")
	})

	it("redirects to /rediger without leaking the .data single-fetch suffix", async () => {
		const formData = new FormData()
		formData.set("intent", "link-team")
		formData.set("devTeamId", "team-1")

		const rawUrl = "http://localhost/applikasjoner/app-1/rediger.data"
		const result = (await action({
			request: makeRequest(formData, rawUrl),
			params: { appId: "app-1" },
			url: normalizeUrl(rawUrl),
			context: {},
		} as unknown as Parameters<typeof action>[0])) as Response

		expect(result.headers.get("Location")).toBe("/applikasjoner/app-1/rediger")
	})

	it("unlinks a team from an application", async () => {
		const formData = new FormData()
		formData.set("intent", "unlink-team")
		formData.set("devTeamId", "team-1")

		try {
			await callAction(formData)
		} catch (thrown) {
			expect(thrown).toBeInstanceOf(Response)
			expect((thrown as Response).status).toBe(302)
		}

		expect(mockUnlinkAppFromTeam).toHaveBeenCalledWith("app-1", "team-1", "Z123456")
	})

	it("returns 400 when link-team is missing devTeamId", async () => {
		const formData = new FormData()
		formData.set("intent", "link-team")

		try {
			await callAction(formData)
			expect.unreachable("Should have thrown 400")
		} catch (thrown) {
			expect(thrown).toBeInstanceOf(Response)
			expect((thrown as Response).status).toBe(400)
		}

		expect(mockLinkAppToTeam).not.toHaveBeenCalled()
	})

	it("returns 400 when unlink-team is missing devTeamId", async () => {
		const formData = new FormData()
		formData.set("intent", "unlink-team")

		try {
			await callAction(formData)
			expect.unreachable("Should have thrown 400")
		} catch (thrown) {
			expect(thrown).toBeInstanceOf(Response)
			expect((thrown as Response).status).toBe(400)
		}

		expect(mockUnlinkAppFromTeam).not.toHaveBeenCalled()
	})
})
