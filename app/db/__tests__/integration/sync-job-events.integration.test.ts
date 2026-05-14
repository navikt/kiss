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

const { appendSyncJobEvent, getDistinctSyncJobEventTypes, getSyncJobEventCount, listSyncJobEvents } = await import(
	"~/db/queries/sync-job-events.server"
)
const { createSyncJob, markSyncJobCompleted, markSyncJobFailed, markSyncJobRunning, markSyncJobSkipped } = await import(
	"~/db/queries/sync-jobs.server"
)

describe("Sync job events integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	})

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		await truncateWithRetry(["sync_job_events", "sync_jobs"])
	})

	it("persists and queries events with filter/count/distinct", async () => {
		const job = await createSyncJob({
			jobType: "nais_full_sync",
			performedBy: "test-user",
		})

		await appendSyncJobEvent({
			syncJobId: job.id,
			eventType: "job_started",
			createdBy: "test-user",
			message: "Start",
		})
		await appendSyncJobEvent({
			syncJobId: job.id,
			eventType: "job_warning",
			createdBy: "test-user",
			message: "Varsel",
		})

		const totalCount = await getSyncJobEventCount(job.id)
		const warningCount = await getSyncJobEventCount(job.id, { eventType: "job_warning" })
		const eventTypes = await getDistinctSyncJobEventTypes(job.id)
		const filtered = await listSyncJobEvents(job.id, { eventType: "job_warning" })

		expect(totalCount).toBe(3)
		expect(warningCount).toBe(1)
		expect(eventTypes).toEqual(["job_created", "job_started", "job_warning"])
		expect(filtered).toHaveLength(1)
		expect(filtered[0].eventType).toBe("job_warning")
	})

	it("writes compact completion metadata to event timeline", async () => {
		const job = await createSyncJob({
			jobType: "nais_full_sync",
			performedBy: "test-user",
		})

		await markSyncJobRunning(job.id, "test-user")
		await markSyncJobCompleted(
			job.id,
			{
				processedTeams: 3,
				apps: [{ id: "a1" }, { id: "a2" }, { id: "a3" }],
				status: "ok",
			},
			"test-user",
			"Ferdig",
		)

		const events = await listSyncJobEvents(job.id)
		const stepEvent = events.find((event) => event.eventType === "job_step_completed")
		const completedEvent = events.find((event) => event.eventType === "job_completed")
		const stepIndex = events.findIndex((event) => event.eventType === "job_step_completed")
		const completedIndex = events.findIndex((event) => event.eventType === "job_completed")

		expect(stepEvent).toBeDefined()
		expect(stepEvent?.metadata).toMatchObject({
			resultKeys: ["processedTeams", "apps", "status"],
			appCount: 3,
		})
		expect(stepEvent?.metadata).not.toHaveProperty("apps")
		expect(completedEvent?.metadata).toBeNull()
		expect(completedIndex).toBeLessThan(stepIndex)
	})

	it("writes warning event for skipped jobs", async () => {
		const job = await createSyncJob({
			jobType: "nais_full_sync",
			performedBy: "test-user",
		})

		await markSyncJobSkipped(job.id, "Skippet pga lock", "test-user")
		const events = await listSyncJobEvents(job.id)
		const skippedEvent = events.find((event) => event.eventType === "job_warning")

		expect(skippedEvent).toBeDefined()
		expect(skippedEvent?.message).toBe("Skippet pga lock")
		expect(skippedEvent?.metadata).toBeNull()
	})

	it("writes failed event with error metadata", async () => {
		const job = await createSyncJob({
			jobType: "nais_full_sync",
			performedBy: "test-user",
		})

		await markSyncJobFailed(job.id, "Boom", "test-user", "Synk feilet")
		const events = await listSyncJobEvents(job.id)
		const failedEvent = events.find((event) => event.eventType === "job_failed")

		expect(failedEvent).toBeDefined()
		expect(failedEvent?.message).toBe("Synk feilet")
		expect(failedEvent?.metadata).toMatchObject({ error: "Boom" })
	})

	it("respects pagination limit/offset for multi-page event timelines", async () => {
		const job = await createSyncJob({
			jobType: "nais_full_sync",
			performedBy: "test-user",
		})

		// Create 30 events to exceed a single page (pageSize=25)
		for (let i = 0; i < 30; i++) {
			await appendSyncJobEvent({
				syncJobId: job.id,
				eventType: i % 2 === 0 ? "job_started" : "job_warning",
				createdBy: "test-user",
				message: `Event ${i}`,
			})
		}

		// First page (offset 0, limit 25)
		const page1 = await listSyncJobEvents(job.id, { offset: 0, limit: 25 })
		expect(page1).toHaveLength(25)

		// Second page (offset 25, limit 25) should contain job_created + remaining events
		const page2 = await listSyncJobEvents(job.id, { offset: 25, limit: 25 })
		expect(page2).toHaveLength(6)

		// Verify order is preserved: should be descending by created_at
		const allEvents = await listSyncJobEvents(job.id, { offset: 0, limit: 1000 })
		for (let i = 1; i < allEvents.length; i++) {
			const prev = new Date(allEvents[i - 1].createdAt).getTime()
			const curr = new Date(allEvents[i].createdAt).getTime()
			expect(curr).toBeLessThanOrEqual(prev)
		}
	})
})
