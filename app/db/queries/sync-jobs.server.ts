import { and, desc, eq } from "drizzle-orm"
import { db } from "../connection.server"
import { type SyncJobState, syncJobs } from "../schema/sync-jobs"

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

export async function createSyncJob(params: {
	jobType: string
	performedBy: string
	scopeType?: string | null
	scopeId?: string | null
	message?: string | null
}): Promise<SyncJob> {
	const [job] = await db
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

	return toModel(job)
}

export async function markSyncJobRunning(jobId: string, performedBy: string, message = "Synkronisering pågår") {
	await db
		.update(syncJobs)
		.set({
			state: "running",
			startedAt: new Date(),
			message,
			updatedBy: performedBy,
			updatedAt: new Date(),
		})
		.where(and(eq(syncJobs.id, jobId), eq(syncJobs.state, "pending")))
}

export async function markSyncJobCompleted(
	jobId: string,
	result: Record<string, unknown>,
	performedBy: string,
	message: string,
) {
	await db
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
}

export async function markSyncJobSkipped(jobId: string, message: string, performedBy: string) {
	await db
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
}

export async function markSyncJobFailed(
	jobId: string,
	error: string,
	performedBy: string,
	message = "Synkronisering feilet",
) {
	await db
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

	const rows = await query.orderBy(desc(syncJobs.createdAt)).limit(filters?.limit ?? 100)

	return rows.map((row) => ({
		id: row.id,
		jobType: row.jobType,
		state: row.state,
		createdAt: row.createdAt.toISOString(),
		message: row.message,
		error: row.error,
	}))
}
