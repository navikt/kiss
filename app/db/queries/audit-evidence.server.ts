import { and, desc, eq, inArray } from "drizzle-orm"
import type { AuditEvidence } from "../../lib/oracle-revisjon.server"
import { getStorageProvider } from "../../lib/storage/index.server"
import { db } from "../connection.server"
import { applicationOracleInstances, auditEvidenceSections, auditEvidenceSnapshots } from "../schema/audit-evidence"

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
	excelBucketPath: string | null
	sections: SnapshotSection[]
}

export interface SnapshotSection {
	id: string
	sectionId: string
	title: string
	description: string | null
	summary: string | null
	error: string | null
	resultJson: unknown
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
	sections: { title: string; summary: string | null; error: string | null }[]
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
	evidence: AuditEvidence,
	excelBuffer: Buffer | null,
	user: string,
): Promise<string> {
	const storage = getStorageProvider()
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
	const basePath = `audit-evidence/${appId}/${instanceId}/${timestamp}`

	const bucketPath = `${basePath}/evidence.json`
	await storage.upload(bucketPath, Buffer.from(JSON.stringify(evidence)), {
		contentType: "application/json",
	})

	let excelBucketPath: string | null = null
	if (excelBuffer) {
		excelBucketPath = `${basePath}/evidence.xlsx`
		await storage.upload(excelBucketPath, excelBuffer, {
			contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		})
	}

	const snapshotId = await db.transaction(async (tx) => {
		const [snapshot] = await tx
			.insert(auditEvidenceSnapshots)
			.values({
				applicationId: appId,
				instanceId,
				overallStatus: evidence.overallStatus,
				collectedAt: new Date(evidence.collectedAt),
				fetchedBy: user,
				bucketPath,
				excelBucketPath,
			})
			.returning({ id: auditEvidenceSnapshots.id })

		if (evidence.sections.length > 0) {
			await tx.insert(auditEvidenceSections).values(
				evidence.sections.map((s) => ({
					snapshotId: snapshot.id,
					sectionId: s.id,
					title: s.title,
					description: s.description,
					summary: s.summary,
					error: s.error,
					resultJson: s.result,
				})),
			)
		}

		return snapshot.id
	})

	return snapshotId
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

	const sections = await db
		.select()
		.from(auditEvidenceSections)
		.where(eq(auditEvidenceSections.snapshotId, snapshot.id))

	return {
		id: snapshot.id,
		applicationId: snapshot.applicationId,
		instanceId: snapshot.instanceId,
		overallStatus: snapshot.overallStatus,
		collectedAt: snapshot.collectedAt,
		fetchedAt: snapshot.fetchedAt,
		fetchedBy: snapshot.fetchedBy,
		bucketPath: snapshot.bucketPath,
		excelBucketPath: snapshot.excelBucketPath,
		sections: sections.map((s) => ({
			id: s.id,
			sectionId: s.sectionId,
			title: s.title,
			description: s.description,
			summary: s.summary,
			error: s.error,
			resultJson: s.resultJson,
		})),
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

	const sections = await db
		.select()
		.from(auditEvidenceSections)
		.where(eq(auditEvidenceSections.snapshotId, snapshot.id))

	return {
		id: snapshot.id,
		applicationId: snapshot.applicationId,
		instanceId: snapshot.instanceId,
		overallStatus: snapshot.overallStatus,
		collectedAt: snapshot.collectedAt,
		fetchedAt: snapshot.fetchedAt,
		fetchedBy: snapshot.fetchedBy,
		bucketPath: snapshot.bucketPath,
		excelBucketPath: snapshot.excelBucketPath,
		sections: sections.map((s) => ({
			id: s.id,
			sectionId: s.sectionId,
			title: s.title,
			description: s.description,
			summary: s.summary,
			error: s.error,
			resultJson: s.resultJson,
		})),
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

	// Pick the latest snapshot per instance
	const latestByInstance = new Map<string, (typeof snapshots)[0]>()
	for (const s of snapshots) {
		if (!latestByInstance.has(s.instanceId)) {
			latestByInstance.set(s.instanceId, s)
		}
	}

	const latestSnapshots = [...latestByInstance.values()]
	if (latestSnapshots.length === 0) return []

	const snapshotIds = latestSnapshots.map((s) => s.id)
	const allSections = await db
		.select({
			snapshotId: auditEvidenceSections.snapshotId,
			title: auditEvidenceSections.title,
			summary: auditEvidenceSections.summary,
			error: auditEvidenceSections.error,
		})
		.from(auditEvidenceSections)
		.where(inArray(auditEvidenceSections.snapshotId, snapshotIds))

	const sectionsBySnapshot = new Map<string, typeof allSections>()
	for (const s of allSections) {
		const existing = sectionsBySnapshot.get(s.snapshotId) ?? []
		existing.push(s)
		sectionsBySnapshot.set(s.snapshotId, existing)
	}

	return latestSnapshots.map((snap) => ({
		instanceId: snap.instanceId,
		overallStatus: snap.overallStatus,
		collectedAt: snap.collectedAt,
		sections: (sectionsBySnapshot.get(snap.id) ?? []).map((s) => ({
			title: s.title,
			summary: s.summary,
			error: s.error,
		})),
	}))
}
