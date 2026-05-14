import { beforeEach, describe, expect, it, vi } from "vitest"
import { SYNC_JOB_TYPES } from "~/lib/sync-job-types"

const mockCreateSyncJob = vi.fn()
const mockMarkSyncJobRunning = vi.fn()
const mockMarkSyncJobCompleted = vi.fn()
const mockMarkSyncJobSkipped = vi.fn()
const mockMarkSyncJobFailed = vi.fn()
const mockWithAdvisoryLock = vi.fn()
const mockGetOracleInstances = vi.fn()
const mockGetAuditEvidenceSummary = vi.fn()
const mockDbSelectWhere = vi.fn()
const mockDbInsert = vi.fn()
const mockAuditInsertValues = vi.fn()
const mockPersistenceInsertValues = vi.fn()
const mockPersistenceOnConflictDoUpdate = vi.fn()

const mockAuditLogTable = { __name: "audit_log" }
const mockPersistenceAuditSummariesTable = { __name: "persistence_audit_summaries", persistenceId: "persistence_id" }

vi.mock("drizzle-orm", () => ({
	and: vi.fn(() => ({})),
	eq: vi.fn(() => ({})),
	inArray: vi.fn(() => ({})),
	isNull: vi.fn(() => ({})),
}))

vi.mock("~/db/queries/sync-jobs.server", () => ({
	createSyncJob: mockCreateSyncJob,
	markSyncJobRunning: mockMarkSyncJobRunning,
	markSyncJobCompleted: mockMarkSyncJobCompleted,
	markSyncJobSkipped: mockMarkSyncJobSkipped,
	markSyncJobFailed: mockMarkSyncJobFailed,
}))

vi.mock("~/db/schema/audit", () => ({
	auditLog: mockAuditLogTable,
}))

vi.mock("~/db/schema/audit-logging", () => ({
	persistenceAuditSummaries: mockPersistenceAuditSummariesTable,
}))

vi.mock("~/db/schema/applications", () => ({
	applicationPersistence: {
		id: "id",
		name: "name",
		applicationId: "applicationId",
		oracleInstanceId: "oracleInstanceId",
		type: "type",
		archivedAt: "archivedAt",
	},
}))

vi.mock("~/db/schema/audit-evidence", () => ({
	applicationOracleInstances: {
		applicationId: "applicationId",
		instanceId: "instanceId",
		archivedAt: "archivedAt",
	},
}))

vi.mock("~/db/connection.server", () => ({
	db: {
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: mockDbSelectWhere,
			})),
		})),
		insert: mockDbInsert,
	},
}))

vi.mock("~/lib/lock.server", () => ({
	withAdvisoryLock: mockWithAdvisoryLock,
}))

vi.mock("~/lib/oracle-revisjon.server", () => ({
	getOracleInstances: mockGetOracleInstances,
	getAuditEvidenceSummary: mockGetAuditEvidenceSummary,
}))

vi.mock("~/lib/logger.server", () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

const { runAuditSummarySync, _testing } = await import("~/lib/audit-summary-scheduler.server")

describe("audit summary scheduler tracked sync job", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockCreateSyncJob.mockResolvedValue({ id: "job-1" })
		mockWithAdvisoryLock.mockImplementation(async (_name, callback) => callback())
		mockDbSelectWhere.mockResolvedValueOnce([]).mockResolvedValueOnce([])
		mockGetOracleInstances.mockResolvedValue([])
		mockGetAuditEvidenceSummary.mockResolvedValue(null)

		mockPersistenceOnConflictDoUpdate.mockResolvedValue(undefined)
		mockPersistenceInsertValues.mockReturnValue({ onConflictDoUpdate: mockPersistenceOnConflictDoUpdate })
		mockAuditInsertValues.mockResolvedValue(undefined)
		mockDbInsert.mockImplementation((table: unknown) => {
			if (table === mockPersistenceAuditSummariesTable) {
				return { values: mockPersistenceInsertValues }
			}
			if (table === mockAuditLogTable) {
				return { values: mockAuditInsertValues }
			}
			return { values: vi.fn().mockResolvedValue(undefined) }
		})
	})

	it("marks completed when sync succeeds", async () => {
		mockDbSelectWhere.mockReset()
		mockDbSelectWhere
			.mockResolvedValueOnce([
				{ id: "persist-1", name: "ORACLE1", applicationId: "app-1", oracleInstanceId: "ORACLE1" },
			])
			.mockResolvedValueOnce([])
		mockGetOracleInstances.mockResolvedValue([{ id: "ORACLE1" }])
		mockGetAuditEvidenceSummary.mockResolvedValue({
			conclusion: "OK",
			reason: "ok",
			unifiedAuditingEnabled: true,
			activePolicyCount: 1,
			auditedObjectCount: 1,
			unauditedTableCount: 0,
			excludedUserCount: 0,
			policiesWithoutFailureAudit: 0,
			hasAuditTrailData: true,
			findings: [],
		})

		await runAuditSummarySync()

		expect(mockCreateSyncJob).toHaveBeenCalledWith({
			jobType: SYNC_JOB_TYPES.AUDIT_SUMMARY_SYNC,
			performedBy: "audit-summary-sync",
			scopeType: "scheduler",
			scopeId: "audit-summary-sync",
			message: "Venter på start",
		})
		expect(mockMarkSyncJobRunning).toHaveBeenCalledWith("job-1", "audit-summary-sync", "Synkronisering pågår")
		expect(mockMarkSyncJobCompleted).toHaveBeenCalled()
		expect(mockMarkSyncJobSkipped).not.toHaveBeenCalled()
		expect(mockMarkSyncJobFailed).not.toHaveBeenCalled()
		expect(mockAuditInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "audit_summary_synced",
				syncJobId: "job-1",
			}),
		)
	})

	it("marks skipped when advisory lock is held", async () => {
		mockWithAdvisoryLock.mockResolvedValue(null)

		await runAuditSummarySync()

		expect(mockMarkSyncJobSkipped).toHaveBeenCalledWith(
			"job-1",
			"Synkronisering pågår allerede i en annen prosess.",
			"audit-summary-sync",
		)
		expect(mockMarkSyncJobCompleted).not.toHaveBeenCalled()
		expect(mockMarkSyncJobFailed).not.toHaveBeenCalled()
	})

	it("marks failed when sync throws", async () => {
		mockWithAdvisoryLock.mockRejectedValue(new Error("boom"))

		await runAuditSummarySync()

		expect(mockMarkSyncJobFailed).toHaveBeenCalledWith("job-1", "boom", "audit-summary-sync", "Synkronisering feilet")
		expect(mockMarkSyncJobCompleted).not.toHaveBeenCalled()
		expect(mockMarkSyncJobSkipped).not.toHaveBeenCalled()
	})

	it("does not mark failed when completion persistence fails", async () => {
		mockDbSelectWhere.mockReset()
		mockDbSelectWhere
			.mockResolvedValueOnce([
				{ id: "persist-1", name: "ORACLE1", applicationId: "app-1", oracleInstanceId: "ORACLE1" },
			])
			.mockResolvedValueOnce([])
		mockGetOracleInstances.mockResolvedValue([{ id: "ORACLE1" }])
		mockGetAuditEvidenceSummary.mockResolvedValue({
			conclusion: "OK",
			reason: "ok",
			unifiedAuditingEnabled: true,
			activePolicyCount: 1,
			auditedObjectCount: 1,
			unauditedTableCount: 0,
			excludedUserCount: 0,
			policiesWithoutFailureAudit: 0,
			hasAuditTrailData: true,
			findings: [],
		})
		mockMarkSyncJobCompleted.mockRejectedValue(new Error("db failure"))

		await expect(runAuditSummarySync()).rejects.toThrow("db failure")
		expect(mockMarkSyncJobFailed).not.toHaveBeenCalled()
	})

	it("does not mark failed when skipped persistence fails", async () => {
		mockWithAdvisoryLock.mockResolvedValue(null)
		mockMarkSyncJobSkipped.mockRejectedValue(new Error("db failure"))

		await expect(runAuditSummarySync()).rejects.toThrow("db failure")
		expect(mockMarkSyncJobFailed).not.toHaveBeenCalled()
	})

	it("builds summary audit log values with syncJobId", () => {
		const values = _testing.buildAuditSummarySyncAuditLog({
			processed: 2,
			succeeded: 1,
			failed: 1,
			skipped: 0,
			durationMs: 15,
			syncJobId: "job-1",
		})

		expect(values.syncJobId).toBe("job-1")
		expect(values.action).toBe("audit_summary_synced")
	})
})
