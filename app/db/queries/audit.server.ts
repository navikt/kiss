import { desc, eq, sql } from "drizzle-orm"
import { db } from "../connection.server"
import { type AuditLogAction, auditLog } from "../schema/audit"

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

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

/** Get recent audit log entries across all entities. */
export async function getRecentAuditLog(limit = 100) {
	return db.select().from(auditLog).orderBy(desc(auditLog.performedAt)).limit(limit)
}

/** Get audit log entries by action type. */
export async function getAuditLogByAction(action: AuditLogAction, limit = 50) {
	return db.select().from(auditLog).where(eq(auditLog.action, action)).orderBy(desc(auditLog.performedAt)).limit(limit)
}

/** Get audit log entries for a specific sync job. */
export async function getAuditLogsForSyncJob(syncJobId: string, limit = 100) {
	return db
		.select()
		.from(auditLog)
		.where(eq(auditLog.syncJobId, syncJobId))
		.orderBy(desc(auditLog.performedAt))
		.limit(limit)
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
