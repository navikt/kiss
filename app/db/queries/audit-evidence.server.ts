import { and, desc, eq, inArray } from "drizzle-orm"
import { getStorageProvider } from "../../lib/storage/index.server"
import { db } from "../connection.server"
import type { AuditEvidenceOverallStatus } from "../schema/audit-evidence"
import { applicationOracleInstances, auditEvidenceSnapshots } from "../schema/audit-evidence"

// ─── Types ────────────────────────────────────────────────────────────────

export interface OracleInstanceWithStatus {
	id: string
	instanceId: string
	includeInReport: boolean
	configuredBy: string
	configuredAt: Date
	latestSnapshot: { overallStatus: string; fetchedAt: Date } | null
}

export interface SnapshotDetail {
	id: string
	applicationId: string
	instanceId: string
	overallStatus: string
	collectedAt: Date
	fetchedAt: Date
	fetchedBy: string
	bucketPath: string
}

export interface SnapshotHistoryItem {
	id: string
	overallStatus: string
	collectedAt: Date
	fetchedAt: Date
	fetchedBy: string
}

export interface ReportEvidence {
	instanceId: string
	overallStatus: string
	collectedAt: Date
}

// ─── Oracle Instance Configuration ───────────────────────────────────────

export async function configureOracleInstance(appId: string, instanceId: string, user: string) {
	const [row] = await db
		.insert(applicationOracleInstances)
		.values({
			applicationId: appId,
			instanceId,
			configuredBy: user,
		})
		.returning()
	return row
}

export async function removeOracleInstance(appId: string, instanceId: string) {
	await db
		.delete(applicationOracleInstances)
		.where(
			and(eq(applicationOracleInstances.applicationId, appId), eq(applicationOracleInstances.instanceId, instanceId)),
		)
}

export async function getOracleInstancesForApp(appId: string): Promise<OracleInstanceWithStatus[]> {
	const instances = await db
		.select()
		.from(applicationOracleInstances)
		.where(eq(applicationOracleInstances.applicationId, appId))
		.orderBy(applicationOracleInstances.instanceId)

	if (instances.length === 0) return []

	const instanceIds = instances.map((i) => i.instanceId)
	const snapshots = await db
		.select()
		.from(auditEvidenceSnapshots)
		.where(
			and(eq(auditEvidenceSnapshots.applicationId, appId), inArray(auditEvidenceSnapshots.instanceId, instanceIds)),
		)
		.orderBy(desc(auditEvidenceSnapshots.fetchedAt))

	const latestByInstance = new Map<string, (typeof snapshots)[0]>()
	for (const s of snapshots) {
		if (!latestByInstance.has(s.instanceId)) {
			latestByInstance.set(s.instanceId, s)
		}
	}

	return instances.map((i) => {
		const latest = latestByInstance.get(i.instanceId)
		return {
			id: i.id,
			instanceId: i.instanceId,
			includeInReport: i.includeInReport,
			configuredBy: i.configuredBy,
			configuredAt: i.configuredAt,
			latestSnapshot: latest ? { overallStatus: latest.overallStatus, fetchedAt: latest.fetchedAt } : null,
		}
	})
}

export async function setIncludeInReport(appId: string, instanceId: string, include: boolean) {
	await db
		.update(applicationOracleInstances)
		.set({ includeInReport: include })
		.where(
			and(eq(applicationOracleInstances.applicationId, appId), eq(applicationOracleInstances.instanceId, instanceId)),
		)
}

// ─── Snapshot Storage ─────────────────────────────────────────────────────

export async function saveAuditEvidenceSnapshot(
	appId: string,
	instanceId: string,
	overallStatus: AuditEvidenceOverallStatus,
	collectedAt: string,
	excelBuffer: Buffer,
	user: string,
): Promise<string> {
	const storage = getStorageProvider()
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
	const bucketPath = `audit-evidence/${appId}/${instanceId}/${timestamp}/evidence.xlsx`

	await storage.upload(bucketPath, excelBuffer, {
		contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	})

	const [snapshot] = await db
		.insert(auditEvidenceSnapshots)
		.values({
			applicationId: appId,
			instanceId,
			overallStatus,
			collectedAt: new Date(collectedAt),
			fetchedBy: user,
			bucketPath,
		})
		.returning({ id: auditEvidenceSnapshots.id })

	return snapshot.id
}

// ─── Snapshot Queries ─────────────────────────────────────────────────────

export async function getLatestSnapshot(appId: string, instanceId: string): Promise<SnapshotDetail | null> {
	const [snapshot] = await db
		.select()
		.from(auditEvidenceSnapshots)
		.where(and(eq(auditEvidenceSnapshots.applicationId, appId), eq(auditEvidenceSnapshots.instanceId, instanceId)))
		.orderBy(desc(auditEvidenceSnapshots.fetchedAt))
		.limit(1)

	if (!snapshot) return null

	return {
		id: snapshot.id,
		applicationId: snapshot.applicationId,
		instanceId: snapshot.instanceId,
		overallStatus: snapshot.overallStatus,
		collectedAt: snapshot.collectedAt,
		fetchedAt: snapshot.fetchedAt,
		fetchedBy: snapshot.fetchedBy,
		bucketPath: snapshot.bucketPath,
	}
}

export async function getSnapshotHistory(appId: string, instanceId: string): Promise<SnapshotHistoryItem[]> {
	const rows = await db
		.select({
			id: auditEvidenceSnapshots.id,
			overallStatus: auditEvidenceSnapshots.overallStatus,
			collectedAt: auditEvidenceSnapshots.collectedAt,
			fetchedAt: auditEvidenceSnapshots.fetchedAt,
			fetchedBy: auditEvidenceSnapshots.fetchedBy,
		})
		.from(auditEvidenceSnapshots)
		.where(and(eq(auditEvidenceSnapshots.applicationId, appId), eq(auditEvidenceSnapshots.instanceId, instanceId)))
		.orderBy(desc(auditEvidenceSnapshots.fetchedAt))

	return rows
}

export async function getSnapshot(snapshotId: string): Promise<SnapshotDetail | null> {
	const [snapshot] = await db.select().from(auditEvidenceSnapshots).where(eq(auditEvidenceSnapshots.id, snapshotId))

	if (!snapshot) return null

	return {
		id: snapshot.id,
		applicationId: snapshot.applicationId,
		instanceId: snapshot.instanceId,
		overallStatus: snapshot.overallStatus,
		collectedAt: snapshot.collectedAt,
		fetchedAt: snapshot.fetchedAt,
		fetchedBy: snapshot.fetchedBy,
		bucketPath: snapshot.bucketPath,
	}
}

// ─── Report Queries ───────────────────────────────────────────────────────

export async function getAuditEvidenceForReport(appId: string): Promise<ReportEvidence[]> {
	const instances = await db
		.select()
		.from(applicationOracleInstances)
		.where(
			and(eq(applicationOracleInstances.applicationId, appId), eq(applicationOracleInstances.includeInReport, true)),
		)
		.orderBy(applicationOracleInstances.instanceId)

	if (instances.length === 0) return []

	const instanceIds = instances.map((i) => i.instanceId)
	const snapshots = await db
		.select()
		.from(auditEvidenceSnapshots)
		.where(
			and(eq(auditEvidenceSnapshots.applicationId, appId), inArray(auditEvidenceSnapshots.instanceId, instanceIds)),
		)
		.orderBy(desc(auditEvidenceSnapshots.fetchedAt))

	const latestByInstance = new Map<string, (typeof snapshots)[0]>()
	for (const s of snapshots) {
		if (!latestByInstance.has(s.instanceId)) {
			latestByInstance.set(s.instanceId, s)
		}
	}

	return [...latestByInstance.values()].map((snap) => ({
		instanceId: snap.instanceId,
		overallStatus: snap.overallStatus,
		collectedAt: snap.collectedAt,
	}))
}
