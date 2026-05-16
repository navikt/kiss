import { and, asc, count, desc, eq, inArray, lt } from "drizzle-orm"
import { db } from "../connection.server"
import { type SyncJobState, syncJobs } from "../schema/sync-jobs"
import { appendSyncJobEvent } from "./sync-job-events.server"

export interface SyncJob {
	id: string
	jobType: string
	scopeType: string | null
	scopeId: string | null
	state: SyncJobState
	createdAt: string
	createdBy: string
	updatedAt: string
	updatedBy: string
	startedAt: string | null
	finishedAt: string | null
	message: string | null
	result: Record<string, unknown> | null
	error: string | null
}

function toModel(row: {
	id: string
	jobType: string
	scopeType: string | null
	scopeId: string | null
	state: SyncJobState
	createdAt: Date
	createdBy: string
	updatedAt: Date
	updatedBy: string
	startedAt: Date | null
	finishedAt: Date | null
	message: string | null
	result: Record<string, unknown> | null
	error: string | null
}): SyncJob {
	return {
		id: row.id,
		jobType: row.jobType,
		scopeType: row.scopeType,
		scopeId: row.scopeId,
		state: row.state,
		createdAt: row.createdAt.toISOString(),
		createdBy: row.createdBy,
		updatedAt: row.updatedAt.toISOString(),
		updatedBy: row.updatedBy,
		startedAt: row.startedAt ? row.startedAt.toISOString() : null,
		finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
		message: row.message,
		result: row.result,
		error: row.error,
	}
}

function summarizeSyncJobResultMetadata(result: Record<string, unknown>): Record<string, unknown> {
	const entries = Object.entries(result)
	const scalarEntries = entries.filter(([, value]) => {
		const valueType = typeof value
		return value === null || valueType === "string" || valueType === "number" || valueType === "boolean"
	})
	const appValue = result.apps

	return {
		resultKeys: entries.map(([key]) => key),
		scalarFields: Object.fromEntries(scalarEntries.slice(0, 5)),
		appCount: Array.isArray(appValue) ? appValue.length : undefined,
	}
}

export async function createSyncJob(params: {
	jobType: string
	performedBy: string
	scopeType?: string | null
	scopeId?: string | null
	message?: string | null
}): Promise<SyncJob> {
	return db.transaction(async (tx) => {
		const [job] = await tx
			.insert(syncJobs)
			.values({
				jobType: params.jobType,
				scopeType: params.scopeType ?? null,
				scopeId: params.scopeId ?? null,
				state: "pending",
				message: params.message ?? "Venter på start",
				result: null,
				error: null,
				createdBy: params.performedBy,
				updatedBy: params.performedBy,
			})
			.returning({
				id: syncJobs.id,
				jobType: syncJobs.jobType,
				scopeType: syncJobs.scopeType,
				scopeId: syncJobs.scopeId,
				state: syncJobs.state,
				createdAt: syncJobs.createdAt,
				createdBy: syncJobs.createdBy,
				updatedAt: syncJobs.updatedAt,
				updatedBy: syncJobs.updatedBy,
				startedAt: syncJobs.startedAt,
				finishedAt: syncJobs.finishedAt,
				message: syncJobs.message,
				result: syncJobs.result,
				error: syncJobs.error,
			})

		await appendSyncJobEvent(
			{
				syncJobId: job.id,
				eventType: "job_created",
				createdBy: params.performedBy,
				message: params.message ?? "Venter på start",
				metadata: {
					jobType: params.jobType,
					scopeType: params.scopeType ?? null,
					scopeId: params.scopeId ?? null,
				},
			},
			tx,
		)

		return toModel(job)
	})
}

export async function markSyncJobRunning(jobId: string, performedBy: string, message = "Synkronisering pågår") {
	await db.transaction(async (tx) => {
		const updated = await tx
			.update(syncJobs)
			.set({
				state: "running",
				startedAt: new Date(),
				message,
				updatedBy: performedBy,
				updatedAt: new Date(),
			})
			.where(and(eq(syncJobs.id, jobId), eq(syncJobs.state, "pending")))
			.returning({ id: syncJobs.id })

		if (updated.length === 0) {
			return
		}

		await appendSyncJobEvent(
			{
				syncJobId: jobId,
				eventType: "job_started",
				createdBy: performedBy,
				message,
			},
			tx,
		)
	})
}

export async function markSyncJobCompleted(
	jobId: string,
	result: Record<string, unknown>,
	performedBy: string,
	message: string,
) {
	await db.transaction(async (tx) => {
		const updated = await tx
			.update(syncJobs)
			.set({
				state: "completed",
				finishedAt: new Date(),
				message,
				result,
				error: null,
				updatedBy: performedBy,
				updatedAt: new Date(),
			})
			.where(eq(syncJobs.id, jobId))
			.returning({ id: syncJobs.id })

		if (updated.length === 0) {
			return
		}

		await appendSyncJobEvent(
			{
				syncJobId: jobId,
				eventType: "job_step_completed",
				createdBy: performedBy,
				message: "Steg fullført",
				metadata: summarizeSyncJobResultMetadata(result),
			},
			tx,
		)
		await appendSyncJobEvent(
			{
				syncJobId: jobId,
				eventType: "job_completed",
				createdBy: performedBy,
				message,
			},
			tx,
		)
	})
}

export async function markSyncJobSkipped(jobId: string, message: string, performedBy: string) {
	await db.transaction(async (tx) => {
		const updated = await tx
			.update(syncJobs)
			.set({
				state: "skipped",
				finishedAt: new Date(),
				message,
				error: null,
				updatedBy: performedBy,
				updatedAt: new Date(),
			})
			.where(eq(syncJobs.id, jobId))
			.returning({ id: syncJobs.id })

		if (updated.length === 0) {
			return
		}

		await appendSyncJobEvent(
			{
				syncJobId: jobId,
				eventType: "job_warning",
				createdBy: performedBy,
				message,
			},
			tx,
		)
	})
}

export async function markSyncJobFailed(
	jobId: string,
	error: string,
	performedBy: string,
	message = "Synkronisering feilet",
) {
	await db.transaction(async (tx) => {
		const updated = await tx
			.update(syncJobs)
			.set({
				state: "failed",
				finishedAt: new Date(),
				message,
				error,
				updatedBy: performedBy,
				updatedAt: new Date(),
			})
			.where(eq(syncJobs.id, jobId))
			.returning({ id: syncJobs.id })

		if (updated.length === 0) {
			return
		}

		await appendSyncJobEvent(
			{
				syncJobId: jobId,
				eventType: "job_failed",
				createdBy: performedBy,
				message,
				metadata: { error },
			},
			tx,
		)
	})
}

export async function getSyncJob(jobId: string, jobType?: string): Promise<SyncJob | null> {
	const [job] = await db
		.select({
			id: syncJobs.id,
			jobType: syncJobs.jobType,
			scopeType: syncJobs.scopeType,
			scopeId: syncJobs.scopeId,
			state: syncJobs.state,
			createdAt: syncJobs.createdAt,
			createdBy: syncJobs.createdBy,
			updatedAt: syncJobs.updatedAt,
			updatedBy: syncJobs.updatedBy,
			startedAt: syncJobs.startedAt,
			finishedAt: syncJobs.finishedAt,
			message: syncJobs.message,
			result: syncJobs.result,
			error: syncJobs.error,
		})
		.from(syncJobs)
		.where(jobType ? and(eq(syncJobs.id, jobId), eq(syncJobs.jobType, jobType)) : eq(syncJobs.id, jobId))
		.limit(1)

	return job ? toModel(job) : null
}

export async function listRecentSyncJobs(limit = 10): Promise<SyncJob[]> {
	const rows = await db
		.select({
			id: syncJobs.id,
			jobType: syncJobs.jobType,
			scopeType: syncJobs.scopeType,
			scopeId: syncJobs.scopeId,
			state: syncJobs.state,
			createdAt: syncJobs.createdAt,
			createdBy: syncJobs.createdBy,
			updatedAt: syncJobs.updatedAt,
			updatedBy: syncJobs.updatedBy,
			startedAt: syncJobs.startedAt,
			finishedAt: syncJobs.finishedAt,
			message: syncJobs.message,
			result: syncJobs.result,
			error: syncJobs.error,
		})
		.from(syncJobs)
		.orderBy(desc(syncJobs.createdAt))
		.limit(limit)

	return rows.map(toModel)
}

export interface SyncJobSummary {
	id: string
	jobType: string
	state: SyncJobState
	createdAt: string
	message: string | null
	error: string | null
}

export async function listSyncJobSummaries(filters?: {
	state?: SyncJobState
	jobType?: string
	limit?: number
	offset?: number
}): Promise<SyncJobSummary[]> {
	const conditions = []
	if (filters?.state) {
		conditions.push(eq(syncJobs.state, filters.state))
	}
	if (filters?.jobType) {
		conditions.push(eq(syncJobs.jobType, filters.jobType))
	}

	const query = db
		.select({
			id: syncJobs.id,
			jobType: syncJobs.jobType,
			state: syncJobs.state,
			createdAt: syncJobs.createdAt,
			message: syncJobs.message,
			error: syncJobs.error,
		})
		.from(syncJobs)

	if (conditions.length > 0) {
		query.where(and(...conditions))
	}

	const rows = await query
		.orderBy(desc(syncJobs.createdAt))
		.limit(filters?.limit ?? 100)
		.offset(filters?.offset ?? 0)

	return rows.map((row) => ({
		id: row.id,
		jobType: row.jobType,
		state: row.state,
		createdAt: row.createdAt.toISOString(),
		message: row.message,
		error: row.error,
	}))
}

export async function countSyncJobSummaries(filters?: { state?: SyncJobState; jobType?: string }): Promise<number> {
	const conditions = []
	if (filters?.state) {
		conditions.push(eq(syncJobs.state, filters.state))
	}
	if (filters?.jobType) {
		conditions.push(eq(syncJobs.jobType, filters.jobType))
	}

	const query = db.select({ count: count() }).from(syncJobs)
	if (conditions.length > 0) {
		query.where(and(...conditions))
	}

	const [result] = await query
	return result?.count ?? 0
}

export async function deleteOldFinishedSyncJobs(params: {
	olderThan: Date
	limit?: number
}): Promise<{ deletedJobIds: string[] }> {
	const batchSize = params.limit ?? 500
	const terminalStates: SyncJobState[] = ["completed", "failed", "skipped"]

	const candidates = db
		.select({ id: syncJobs.id })
		.from(syncJobs)
		.where(and(lt(syncJobs.createdAt, params.olderThan), inArray(syncJobs.state, terminalStates)))
		.orderBy(asc(syncJobs.createdAt))
		.limit(batchSize)

	const deletedRows = await db.delete(syncJobs).where(inArray(syncJobs.id, candidates)).returning({ id: syncJobs.id })

	return { deletedJobIds: deletedRows.map((row) => row.id) }
}
