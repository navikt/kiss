import { beforeEach, describe, expect, it, vi } from "vitest"
import { SYNC_JOB_TYPES } from "~/lib/sync-job-types"

const mockCreateSyncJob = vi.fn()
const mockMarkSyncJobRunning = vi.fn()
const mockMarkSyncJobCompleted = vi.fn()
const mockMarkSyncJobSkipped = vi.fn()
const mockMarkSyncJobFailed = vi.fn()
const mockWithAdvisoryLock = vi.fn()
const mockGetAppsWithProdEnvironments = vi.fn()
const mockTouchSyncAttempt = vi.fn()
const mockUpsertDeploymentVerification = vi.fn()
const mockGetVerificationSummary = vi.fn()
const mockDbSelectLimit = vi.fn()
const mockDbInsert = vi.fn()
const mockAuditInsertValues = vi.fn()
const mockAuditLogTable = { __name: "audit_log" }

vi.mock("drizzle-orm", () => ({
	and: vi.fn(() => ({})),
	eq: vi.fn(() => ({})),
}))

vi.mock("~/db/queries/sync-jobs.server", () => ({
	createSyncJob: mockCreateSyncJob,
	markSyncJobRunning: mockMarkSyncJobRunning,
	markSyncJobCompleted: mockMarkSyncJobCompleted,
	markSyncJobSkipped: mockMarkSyncJobSkipped,
	markSyncJobFailed: mockMarkSyncJobFailed,
}))

vi.mock("~/db/queries/deployment-audit.server", () => ({
	getAppsWithProdEnvironments: mockGetAppsWithProdEnvironments,
	touchSyncAttempt: mockTouchSyncAttempt,
	upsertDeploymentVerification: mockUpsertDeploymentVerification,
}))

vi.mock("~/lib/deployment-audit.server", () => ({
	getVerificationSummary: mockGetVerificationSummary,
}))

vi.mock("~/db/schema/audit", () => ({
	auditLog: mockAuditLogTable,
}))

vi.mock("~/db/schema/deployment-audit", () => ({
	deploymentVerificationSummaries: {
		applicationId: "applicationId",
		environment: "environment",
		status: "status",
		lastSyncAttemptedAt: "lastSyncAttemptedAt",
	},
}))

vi.mock("~/db/connection.server", () => ({
	db: {
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					limit: mockDbSelectLimit,
				})),
			})),
		})),
		insert: mockDbInsert,
	},
}))

vi.mock("~/lib/lock.server", () => ({
	withAdvisoryLock: mockWithAdvisoryLock,
}))

vi.mock("~/lib/logger.server", () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

const { runDeploymentAuditSync, _testing } = await import("~/lib/deployment-audit-scheduler.server")

describe("deployment audit scheduler tracked sync job", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockCreateSyncJob.mockResolvedValue({ id: "job-1" })
		mockWithAdvisoryLock.mockImplementation(async (_name, callback) => callback())
		mockDbSelectLimit.mockResolvedValue([])
		mockAuditInsertValues.mockResolvedValue(undefined)
		mockDbInsert.mockImplementation((table: unknown) => {
			if (table === mockAuditLogTable) {
				return { values: mockAuditInsertValues }
			}
			return { values: vi.fn().mockResolvedValue(undefined) }
		})
	})

	it("marks completed when sync succeeds", async () => {
		mockGetAppsWithProdEnvironments.mockResolvedValue([
			{ applicationId: "app-1", cluster: "prod-gcp", teamSlug: "team-a", appName: "app-a" },
		])
		mockGetVerificationSummary.mockRejectedValue(new Error("api failure"))

		await runDeploymentAuditSync()

		expect(mockCreateSyncJob).toHaveBeenCalledWith({
			jobType: SYNC_JOB_TYPES.DEPLOYMENT_AUDIT_SYNC,
			performedBy: "deployment-audit-sync",
			scopeType: "scheduler",
			scopeId: "deployment-audit-sync",
			message: "Venter på start",
		})
		expect(mockMarkSyncJobRunning).toHaveBeenCalledWith("job-1", "deployment-audit-sync", "Synkronisering pågår")
		expect(mockMarkSyncJobCompleted).toHaveBeenCalled()
		expect(mockMarkSyncJobSkipped).not.toHaveBeenCalled()
		expect(mockMarkSyncJobFailed).not.toHaveBeenCalled()
		expect(mockAuditInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "deployment_verification_synced",
				syncJobId: "job-1",
			}),
		)
	})

	it("marks skipped when advisory lock is held", async () => {
		mockWithAdvisoryLock.mockResolvedValue(null)

		await runDeploymentAuditSync()

		expect(mockMarkSyncJobSkipped).toHaveBeenCalledWith(
			"job-1",
			"Synkronisering pågår allerede i en annen prosess.",
			"deployment-audit-sync",
		)
		expect(mockMarkSyncJobCompleted).not.toHaveBeenCalled()
		expect(mockMarkSyncJobFailed).not.toHaveBeenCalled()
	})

	it("marks failed when sync throws", async () => {
		mockWithAdvisoryLock.mockRejectedValue(new Error("boom"))

		await runDeploymentAuditSync()

		expect(mockMarkSyncJobFailed).toHaveBeenCalledWith(
			"job-1",
			"boom",
			"deployment-audit-sync",
			"Synkronisering feilet",
		)
		expect(mockMarkSyncJobCompleted).not.toHaveBeenCalled()
		expect(mockMarkSyncJobSkipped).not.toHaveBeenCalled()
	})

	it("does not mark failed when completion persistence fails", async () => {
		mockGetAppsWithProdEnvironments.mockResolvedValue([
			{ applicationId: "app-1", cluster: "prod-gcp", teamSlug: "team-a", appName: "app-a" },
		])
		mockGetVerificationSummary.mockRejectedValue(new Error("api failure"))
		mockMarkSyncJobCompleted.mockRejectedValue(new Error("db failure"))

		await expect(runDeploymentAuditSync()).rejects.toThrow("db failure")
		expect(mockMarkSyncJobFailed).not.toHaveBeenCalled()
	})

	it("does not mark failed when skipped persistence fails", async () => {
		mockWithAdvisoryLock.mockResolvedValue(null)
		mockMarkSyncJobSkipped.mockRejectedValue(new Error("db failure"))

		await expect(runDeploymentAuditSync()).rejects.toThrow("db failure")
		expect(mockMarkSyncJobFailed).not.toHaveBeenCalled()
	})

	it("builds summary audit log values with syncJobId", () => {
		const values = _testing.buildDeploymentAuditSyncLog({
			processed: 2,
			succeeded: 1,
			failed: 1,
			skippedNotMonitored: 0,
			durationMs: 18,
			syncJobId: "job-1",
		})

		expect(values.syncJobId).toBe("job-1")
		expect(values.action).toBe("deployment_verification_synced")
	})
})
