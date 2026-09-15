import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { db } from "../connection.server"
import { type AuditLogAction, auditLog } from "../schema/audit"

export type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Write an audit log entry. Accepts an optional transaction handle. */
export async function writeAuditLog(
	entry: {
		action: AuditLogAction
		entityType: string
		entityId: string
		previousValue?: string | null
		newValue?: string | null
		metadata?: Record<string, unknown>
		performedBy: string
		syncJobId?: string
	},
	tx?: DbExecutor,
) {
	const executor = tx ?? db
	await executor.insert(auditLog).values({
		action: entry.action,
		entityType: entry.entityType,
		entityId: entry.entityId,
		previousValue: entry.previousValue ?? null,
		newValue: entry.newValue ?? null,
		metadata: entry.metadata
			? JSON.stringify({ ...entry.metadata, syncJobId: entry.syncJobId })
			: entry.syncJobId
				? JSON.stringify({ syncJobId: entry.syncJobId })
				: null,
		performedBy: entry.performedBy,
		syncJobId: entry.syncJobId ?? null,
	})
}

/** Get audit log entries for a specific entity. */
export async function getAuditLogForEntity(entityType: string, entityId: string, limit = 50) {
	return db
		.select()
		.from(auditLog)
		.where(sql`${auditLog.entityType} = ${entityType} AND ${auditLog.entityId} = ${entityId}`)
		.orderBy(desc(auditLog.performedAt))
		.limit(limit)
}

/** Get audit log entries for multiple entities of the same type (e.g. checklist steps belonging to a routine).
 * `perEntityLimit` applies PER entityId (not to the combined result set), so merging audit logs for many
 * entities (e.g. a routine's checklist steps) doesn't silently drop older history for some entities once the
 * total across all of them exceeds the limit. `overallLimit` then caps the final merged/sorted result so a
 * routine with many retained checklist steps can't produce an unbounded response payload. Uses a single
 * set-based query with a window function (rather than one query per entityId) to avoid an N+1 burst. */
export async function getAuditLogForEntities(
	entityType: string,
	entityIds: string[],
	perEntityLimit = 50,
	overallLimit = 200,
) {
	if (entityIds.length === 0) return []
	// sql.join() genererer individuelle parametriserte bindinger ($1, $2, ...), i motsetning til
	// å sende JS-arrayet direkte som én ANY(...)-parameter (se samme mønster i application-controls.server.ts).
	const entityIdsIn = sql.join(
		entityIds.map((id) => sql`${id}`),
		sql`, `,
	)
	const result = await db.execute<{
		id: string
		action: AuditLogAction
		entity_type: string
		entity_id: string
		previous_value: string | null
		new_value: string | null
		metadata: string | null
		performed_by: string
		performed_at: Date
		sync_job_id: string | null
	}>(sql`
		SELECT id, action, entity_type, entity_id, previous_value, new_value, metadata, performed_by, performed_at, sync_job_id
		FROM (
			SELECT *, row_number() OVER (PARTITION BY entity_id ORDER BY performed_at DESC) AS rn
			FROM ${auditLog}
			WHERE entity_type = ${entityType} AND entity_id IN (${entityIdsIn})
		) ranked
		WHERE rn <= ${perEntityLimit}
		ORDER BY performed_at DESC
		LIMIT ${overallLimit}
	`)
	return result.rows.map((row) => ({
		id: row.id,
		action: row.action,
		entityType: row.entity_type,
		entityId: row.entity_id,
		previousValue: row.previous_value,
		newValue: row.new_value,
		metadata: row.metadata,
		performedBy: row.performed_by,
		performedAt: new Date(row.performed_at),
		syncJobId: row.sync_job_id,
	}))
}

/** Get recent audit log entries across all entities. */
export async function getRecentAuditLog(limit = 100) {
	return db.select().from(auditLog).orderBy(desc(auditLog.performedAt), desc(auditLog.id)).limit(limit)
}

/** Get recent audit log entries filtered by entity types. */
export async function getRecentAuditLogByEntityTypes(entityTypes: string[], limit = 100) {
	if (entityTypes.length === 0) return []
	return db
		.select()
		.from(auditLog)
		.where(inArray(auditLog.entityType, entityTypes))
		.orderBy(desc(auditLog.performedAt), desc(auditLog.id))
		.limit(limit)
}

/** Get audit log entries by action type. */
export async function getAuditLogByAction(action: AuditLogAction, limit = 50) {
	return db
		.select()
		.from(auditLog)
		.where(eq(auditLog.action, action))
		.orderBy(desc(auditLog.performedAt), desc(auditLog.id))
		.limit(limit)
}

/** Get audit log entries for a specific sync job. */
export async function getAuditLogsForSyncJob(
	syncJobId: string,
	options: {
		limit?: number
		offset?: number
		action?: AuditLogAction
		entityType?: string
	} = {},
) {
	const limit = options.limit ?? 100
	const offset = options.offset ?? 0
	const where = and(
		eq(auditLog.syncJobId, syncJobId),
		options.action ? eq(auditLog.action, options.action) : undefined,
		options.entityType ? eq(auditLog.entityType, options.entityType) : undefined,
	)

	return db
		.select()
		.from(auditLog)
		.where(where)
		.orderBy(desc(auditLog.performedAt), desc(auditLog.id))
		.limit(limit)
		.offset(offset)
}

/** Get the total audit log count for a specific sync job. */
export async function getAuditLogCountForSyncJob(
	syncJobId: string,
	options: {
		action?: AuditLogAction
		entityType?: string
	} = {},
) {
	const where = and(
		eq(auditLog.syncJobId, syncJobId),
		options.action ? eq(auditLog.action, options.action) : undefined,
		options.entityType ? eq(auditLog.entityType, options.entityType) : undefined,
	)

	const [result] = await db.select({ count: sql<number>`count(*)` }).from(auditLog).where(where)
	return Number(result?.count ?? 0)
}

/** Get all distinct actions used by audit logs for a specific sync job. */
export async function getDistinctAuditLogActionsForSyncJob(syncJobId: string) {
	const rows = await db
		.selectDistinct({ action: auditLog.action })
		.from(auditLog)
		.where(eq(auditLog.syncJobId, syncJobId))
		.orderBy(auditLog.action)

	return rows.map((row) => row.action)
}

/** Get all distinct entity types used by audit logs for a specific sync job. */
export async function getDistinctAuditLogEntityTypesForSyncJob(syncJobId: string) {
	const rows = await db
		.selectDistinct({ entityType: auditLog.entityType })
		.from(auditLog)
		.where(eq(auditLog.syncJobId, syncJobId))
		.orderBy(auditLog.entityType)

	return rows.map((row) => row.entityType)
}

/** Get audit log entries for multiple sync jobs. */
export async function getAuditLogsForSyncJobs(syncJobIds: string[], limit = 100) {
	if (syncJobIds.length === 0) {
		return []
	}
	return db
		.select()
		.from(auditLog)
		.where(sql`${auditLog.syncJobId} = ANY(${syncJobIds})`)
		.orderBy(desc(auditLog.performedAt))
		.limit(limit)
}
