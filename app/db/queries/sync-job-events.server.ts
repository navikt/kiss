import { and, desc, eq, sql } from "drizzle-orm"
import { db } from "../connection.server"
import { type SyncJobEventType, syncJobEvents } from "../schema/sync-job-events"

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

export interface SyncJobEvent {
	id: string
	syncJobId: string
	eventType: SyncJobEventType
	message: string | null
	metadata: Record<string, unknown> | null
	createdBy: string
	createdAt: string
}

function toModel(row: {
	id: string
	syncJobId: string
	eventType: SyncJobEventType
	message: string | null
	metadata: Record<string, unknown> | null
	createdBy: string
	createdAt: Date
}): SyncJobEvent {
	return {
		id: row.id,
		syncJobId: row.syncJobId,
		eventType: row.eventType,
		message: row.message,
		metadata: row.metadata,
		createdBy: row.createdBy,
		createdAt: row.createdAt.toISOString(),
	}
}

export async function appendSyncJobEvent(
	params: {
		syncJobId: string
		eventType: SyncJobEventType
		createdBy: string
		message?: string | null
		metadata?: Record<string, unknown> | null
	},
	tx?: DbExecutor,
) {
	const executor = tx ?? db
	await executor.insert(syncJobEvents).values({
		syncJobId: params.syncJobId,
		eventType: params.eventType,
		message: params.message ?? null,
		metadata: params.metadata ?? null,
		createdBy: params.createdBy,
		createdAt: sql`clock_timestamp()`,
	})
}

export async function listSyncJobEvents(
	syncJobId: string,
	options: {
		limit?: number
		offset?: number
		eventType?: SyncJobEventType
	} = {},
): Promise<SyncJobEvent[]> {
	const where = and(
		eq(syncJobEvents.syncJobId, syncJobId),
		options.eventType ? eq(syncJobEvents.eventType, options.eventType) : undefined,
	)
	const rows = await db
		.select({
			id: syncJobEvents.id,
			syncJobId: syncJobEvents.syncJobId,
			eventType: syncJobEvents.eventType,
			message: syncJobEvents.message,
			metadata: syncJobEvents.metadata,
			createdBy: syncJobEvents.createdBy,
			createdAt: syncJobEvents.createdAt,
		})
		.from(syncJobEvents)
		.where(where)
		.orderBy(
			desc(syncJobEvents.createdAt),
			desc(sql<number>`CASE
				WHEN ${syncJobEvents.eventType} = 'job_completed' THEN 6
				WHEN ${syncJobEvents.eventType} = 'job_failed' THEN 5
				WHEN ${syncJobEvents.eventType} = 'job_warning' THEN 4
				WHEN ${syncJobEvents.eventType} = 'job_step_completed' THEN 3
				WHEN ${syncJobEvents.eventType} = 'job_started' THEN 2
				WHEN ${syncJobEvents.eventType} = 'job_created' THEN 1
				ELSE 0
			END`),
			desc(syncJobEvents.id),
		)
		.limit(options.limit ?? 25)
		.offset(options.offset ?? 0)

	return rows.map(toModel)
}

export async function getSyncJobEventCount(
	syncJobId: string,
	options: {
		eventType?: SyncJobEventType
	} = {},
) {
	const where = and(
		eq(syncJobEvents.syncJobId, syncJobId),
		options.eventType ? eq(syncJobEvents.eventType, options.eventType) : undefined,
	)
	const [result] = await db.select({ count: sql<number>`count(*)` }).from(syncJobEvents).where(where)
	return Number(result?.count ?? 0)
}

export async function getDistinctSyncJobEventTypes(syncJobId: string): Promise<SyncJobEventType[]> {
	const rows = await db
		.selectDistinct({ eventType: syncJobEvents.eventType })
		.from(syncJobEvents)
		.where(eq(syncJobEvents.syncJobId, syncJobId))
		.orderBy(syncJobEvents.eventType)
	return rows.map((row) => row.eventType)
}
