import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
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
})
