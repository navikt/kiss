import { and, eq, isNull, sql } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { writeAuditLog } from "~/db/queries/audit.server"
import { getSyncJobEventCount } from "~/db/queries/sync-job-events.server"
import { auditLog } from "~/db/schema/audit"
import { getTestDb, getTestPool, setupTestDatabase, teardownTestDatabase, truncateWithRetry } from "./setup"

vi.mock("~/db/connection.server", () => ({
	get db() {
		return getTestDb()
	},
	get pool() {
		return getTestPool()
	},
}))

const {
	countSyncJobSummaries,
	createSyncJob,
	deleteOldFinishedSyncJobs,
	listSyncJobSummaries,
	markSyncJobCompleted,
	markSyncJobFailed,
	markSyncJobRunning,
} = await import("~/db/queries/sync-jobs.server")

describe("Sync jobs integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	})

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		await truncateWithRetry(["sync_job_events", "sync_jobs"])
	})

	it("counts summaries with filters", async () => {
		const job1 = await createSyncJob({ jobType: "nais_full_sync", performedBy: "test-user" })
		await markSyncJobRunning(job1.id, "test-user")
		await markSyncJobCompleted(job1.id, { ok: true }, "test-user", "Ferdig")

		const job2 = await createSyncJob({ jobType: "nais_full_sync", performedBy: "test-user" })
		await markSyncJobFailed(job2.id, "Boom", "test-user")

		await createSyncJob({ jobType: "rpa_group_member_sync", performedBy: "test-user" })

		expect(await countSyncJobSummaries()).toBe(3)
		expect(await countSyncJobSummaries({ jobType: "nais_full_sync" })).toBe(2)
		expect(await countSyncJobSummaries({ state: "failed" })).toBe(1)
		expect(await countSyncJobSummaries({ state: "completed", jobType: "nais_full_sync" })).toBe(1)
	})

	it("supports pagination with limit/offset", async () => {
		for (let i = 0; i < 6; i++) {
			await createSyncJob({
				jobType: i % 2 === 0 ? "nais_full_sync" : "rpa_group_member_sync",
				performedBy: "test-user",
			})
		}

		const page1 = await listSyncJobSummaries({ limit: 3, offset: 0 })
		const page2 = await listSyncJobSummaries({ limit: 3, offset: 3 })

		expect(page1).toHaveLength(3)
		expect(page2).toHaveLength(3)
		expect(new Set([...page1.map((job) => job.id), ...page2.map((job) => job.id)]).size).toBe(6)
	})

	it("deletes only old terminal jobs and cascades to sync_job_events", async () => {
		const db = getTestDb()
		const oldCompleted = await createSyncJob({ jobType: "nais_full_sync", performedBy: "test-user" })
		await markSyncJobRunning(oldCompleted.id, "test-user")
		await markSyncJobCompleted(oldCompleted.id, { ok: true }, "test-user", "Ferdig")

		const oldRunning = await createSyncJob({ jobType: "nais_full_sync", performedBy: "test-user" })
		await markSyncJobRunning(oldRunning.id, "test-user")

		const recentCompleted = await createSyncJob({ jobType: "nais_full_sync", performedBy: "test-user" })
		await markSyncJobRunning(recentCompleted.id, "test-user")
		await markSyncJobCompleted(recentCompleted.id, { ok: true }, "test-user", "Ferdig")

		await db.execute(
			sql`UPDATE sync_jobs
				SET created_at = now() - interval '120 days'
				WHERE id IN (${oldCompleted.id}, ${oldRunning.id})`,
		)

		await writeAuditLog({
			action: "nais_sync_completed",
			entityType: "sync_job",
			entityId: oldCompleted.id,
			performedBy: "test-user",
			syncJobId: oldCompleted.id,
		})

		expect(await getSyncJobEventCount(oldCompleted.id)).toBeGreaterThan(0)

		const { deletedJobIds } = await deleteOldFinishedSyncJobs({
			olderThan: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
			limit: 100,
		})

		expect(deletedJobIds).toContain(oldCompleted.id)
		expect(deletedJobIds).not.toContain(oldRunning.id)
		expect(deletedJobIds).not.toContain(recentCompleted.id)
		expect(await getSyncJobEventCount(oldCompleted.id)).toBe(0)

		const [auditRowAfterDelete] = await db
			.select({
				id: auditLog.id,
				syncJobId: auditLog.syncJobId,
			})
			.from(auditLog)
			.where(
				and(eq(auditLog.entityType, "sync_job"), eq(auditLog.entityId, oldCompleted.id), isNull(auditLog.syncJobId)),
			)
			.limit(1)

		expect(auditRowAfterDelete).toBeDefined()
	})
})
