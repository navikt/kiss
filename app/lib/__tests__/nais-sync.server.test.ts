import { beforeEach, describe, expect, it, vi } from "vitest"

const mockWriteAuditLog = vi.fn()
const mockWithAdvisoryLock = vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn())
const mockFetchNaisApps = vi.fn()
const mockGetMonitoredAppsForNaisTeam = vi.fn()
const mockUpsertMonitoredApp = vi.fn()
const mockUpsertAppEnvironment = vi.fn()
const mockUpsertAppPersistence = vi.fn()
const mockUpsertAccessPolicyRulesForEnvironment = vi.fn()
const mockArchiveMissingEnvironmentAccessPolicyRules = vi.fn()
const mockUpsertAppAuthIntegration = vi.fn()
const mockLoggerInfo = vi.fn()

vi.mock("~/db/connection.server", () => ({
	db: {
		transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({})),
		select: vi.fn(),
		insert: vi.fn(),
		update: vi.fn(),
		execute: vi.fn(),
	},
	pool: {},
}))

vi.mock("~/db/queries/audit.server", () => ({
	writeAuditLog: mockWriteAuditLog,
}))

vi.mock("~/db/queries/nais.server", () => ({
	archiveMissingEnvironmentAccessPolicyRules: mockArchiveMissingEnvironmentAccessPolicyRules,
	createAccessPolicySyncSummaryCollector: () => ({
		applicationIds: new Set<string>(),
		applicationEnvironmentIds: new Set<string>(),
		directions: new Set<"inbound" | "outbound">(),
		addedRules: 0,
		removedRules: 0,
	}),
	getMonitoredAppsForNaisTeam: mockGetMonitoredAppsForNaisTeam,
	syncDiscoveredApps: vi.fn(),
	upsertAccessPolicyRulesForEnvironment: mockUpsertAccessPolicyRulesForEnvironment,
	upsertAppAuthIntegration: mockUpsertAppAuthIntegration,
	upsertAppEnvironment: mockUpsertAppEnvironment,
	upsertAppPersistence: mockUpsertAppPersistence,
	upsertMonitoredApp: mockUpsertMonitoredApp,
	upsertNaisTeam: vi.fn(),
}))

vi.mock("~/lib/lock.server", () => ({
	withAdvisoryLock: mockWithAdvisoryLock,
}))

vi.mock("~/lib/logger.server", () => ({
	logger: {
		info: mockLoggerInfo,
	},
}))

vi.mock("~/lib/nais.server", () => ({
	fetchNaisApps: mockFetchNaisApps,
	fetchNaisTeams: vi.fn(),
	mergeAuthIntegrations: vi.fn(),
}))

const { syncNaisAppsForTeam } = await import("~/lib/nais-sync.server")

describe("nais sync summary audit", () => {
	beforeEach(() => {
		vi.clearAllMocks()

		mockFetchNaisApps.mockResolvedValue([
			{
				name: "app-one",
				cluster: "prod-gcp",
				namespace: "ns-one",
				image: "image-one",
				persistence: [],
				authIntegrations: [],
				accessPolicyInbound: [{ application: "client-a", namespace: "team-a", cluster: "prod-gcp" }],
			},
			{
				name: "app-two",
				cluster: "prod-fss",
				namespace: "ns-two",
				image: "image-two",
				persistence: [],
				authIntegrations: [],
				accessPolicyInbound: [
					{ application: "client-b", namespace: "team-a", cluster: "prod-fss" },
					{ application: "client-c", namespace: "team-a", cluster: "prod-fss" },
				],
			},
		])
		mockGetMonitoredAppsForNaisTeam.mockResolvedValue([])

		mockUpsertMonitoredApp.mockImplementation(async (name: string) => ({
			id: `${name}-id`,
			isNew: true,
		}))
		mockUpsertAppEnvironment.mockImplementation(async (appId: string, cluster: string) => ({
			id: `${appId}-${cluster}-env`,
			isNew: true,
		}))
		mockUpsertAppPersistence.mockResolvedValue(false)
		mockUpsertAppAuthIntegration.mockResolvedValue(false)
		mockArchiveMissingEnvironmentAccessPolicyRules.mockResolvedValue(undefined)
		mockUpsertAccessPolicyRulesForEnvironment.mockImplementation(
			async (
				applicationId: string,
				applicationEnvironmentId: string,
				direction: "inbound" | "outbound",
				rules: Array<{ application: string; namespace?: string; cluster?: string }>,
				_performedBy: string,
				context?: {
					accessPolicySyncSummary?: {
						applicationIds: Set<string>
						applicationEnvironmentIds: Set<string>
						directions: Set<"inbound" | "outbound">
						addedRules: number
						removedRules: number
					}
				},
			) => {
				context?.accessPolicySyncSummary?.applicationIds.add(applicationId)
				context?.accessPolicySyncSummary?.applicationEnvironmentIds.add(applicationEnvironmentId)
				context?.accessPolicySyncSummary?.directions.add(direction)
				if (context?.accessPolicySyncSummary) {
					context.accessPolicySyncSummary.addedRules += rules.length
				}
			},
		)
	})

	it("writes one batch summary audit for the team sync run", async () => {
		const result = await syncNaisAppsForTeam("token", "teampensjon", "team-id", "job-1")

		expect(result).toEqual({
			discovered: 2,
			new: 2,
			skipped: 0,
		})
		expect(mockWriteAuditLog).toHaveBeenCalledTimes(1)
		expect(mockWriteAuditLog).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "access_policy_rules_synced",
				entityType: "nais_sync",
				entityId: "teampensjon",
				syncJobId: "job-1",
				metadata: expect.objectContaining({
					teamSlug: "teampensjon",
					syncRunId: expect.any(String),
					applicationsChanged: 2,
					environmentsChanged: 2,
				}),
			}),
		)
		const call = mockWriteAuditLog.mock.calls[0]?.[0] as {
			newValue?: string
		}
		expect(JSON.parse(call.newValue ?? "{}")).toMatchObject({
			teamSlug: "teampensjon",
			addedRules: 3,
			removedRules: 0,
			directions: ["inbound"],
		})
	})

	it("does not write summary audit when there are no access-policy changes", async () => {
		mockFetchNaisApps.mockResolvedValue([])
		mockGetMonitoredAppsForNaisTeam.mockResolvedValue([])
		mockUpsertAccessPolicyRulesForEnvironment.mockResolvedValue(undefined)

		const result = await syncNaisAppsForTeam("token", "teampensjon", "team-id", "job-1")

		expect(result).toEqual({
			discovered: 0,
			new: 0,
			skipped: 0,
		})
		expect(mockWriteAuditLog).not.toHaveBeenCalled()
	})
})
