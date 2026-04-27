import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import { getStorageProvider } from "../../lib/storage/index.server"
import { db } from "../connection.server"
import type { AuditEvidenceOverallStatus } from "../schema/audit-evidence"
import { applicationOracleInstances, auditEvidenceSnapshots } from "../schema/audit-evidence"
import { writeAuditLog } from "./audit.server"

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

/** Konfigurer en Oracle-instans for en applikasjon (revisjonsbevis-kilde).
 *
 * Wrappet i transaksjon med audit som del av samme tx for atomisitet.
 * Hvis det allerede finnes en aktiv rad er dette en idempotent no-op
 * som returnerer eksisterende rad uten å skrive audit. Hvis raden ble
 * arkivert i et race kastes concurrency-feil i stedet for stille `null`.
 */
export async function configureOracleInstance(appId: string, instanceId: string, user: string) {
	const result = await db.transaction(async (tx) => {
		const [inserted] = await tx
			.insert(applicationOracleInstances)
			.values({
				applicationId: appId,
				instanceId,
				configuredBy: user,
			})
			.onConflictDoNothing({
				target: [applicationOracleInstances.applicationId, applicationOracleInstances.instanceId],
				where: isNull(applicationOracleInstances.archivedAt),
			})
			.returning()

		if (inserted) {
			await writeAuditLog(
				{
					action: "oracle_instance_configured",
					entityType: "application",
					entityId: appId,
					newValue: JSON.stringify({ instanceId }),
					performedBy: user,
				},
				tx,
			)
			return inserted
		}

		// Konflikt: enten finnes det en eksisterende aktiv rad (idempotent
		// no-op), eller raden ble arkivert i et race. Sjekk eksplisitt.
		const [existing] = await tx
			.select()
			.from(applicationOracleInstances)
			.where(
				and(
					eq(applicationOracleInstances.applicationId, appId),
					eq(applicationOracleInstances.instanceId, instanceId),
					isNull(applicationOracleInstances.archivedAt),
				),
			)
			.limit(1)

		if (!existing) {
			throw new Error("Kunne ikke konfigurere Oracle-instans pga. samtidig endring. Prøv igjen.")
		}

		return existing
	})

	// Sørg for matchende persistens-rad for `(appId, type='oracle', name=instanceId)`
	// slik at caching og oversikts-queries fungerer. Kalles ETTER ytre transaksjon
	// har commit-et — `ensureOraclePersistenceEntries` åpner sin egen transaksjon
	// på en separat connection, og må ikke gjøres i en uncommitted ytre tx (ellers
	// kan persistens-rader bli liggende selv om ytre tx ruller tilbake). Funksjonen
	// er idempotent og selv-helbredende, så den kan trygt kjøres etter commit.
	const { ensureOraclePersistenceEntries } = await import("./audit-logging.server")
	await ensureOraclePersistenceEntries(appId, [instanceId], user)

	return result
}

/** Arkiverer (soft-delete) en Oracle-instans for en applikasjon.
 *
 * Tidligere ble raden hard-slettet. Nå arkiverer vi den slik at vi bevarer
 * sporbarhet på hvilke instanser applikasjonen har vært konfigurert med.
 * Wrappet i transaksjon med audit som del av samme tx — hvis audit-skriving
 * feiler rulles arkiveringen tilbake.
 */
export async function removeOracleInstance(appId: string, instanceId: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [archived] = await tx
			.update(applicationOracleInstances)
			.set({ archivedAt: new Date(), archivedBy: performedBy })
			.where(
				and(
					eq(applicationOracleInstances.applicationId, appId),
					eq(applicationOracleInstances.instanceId, instanceId),
					isNull(applicationOracleInstances.archivedAt),
				),
			)
			.returning()

		if (!archived) return null

		await writeAuditLog(
			{
				action: "oracle_instance_removed",
				entityType: "application",
				entityId: appId,
				previousValue: JSON.stringify({ instanceId }),
				performedBy,
			},
			tx,
		)

		return archived
	})
}

export async function getOracleInstancesForApp(appId: string): Promise<OracleInstanceWithStatus[]> {
	const instances = await db
		.select()
		.from(applicationOracleInstances)
		.where(and(eq(applicationOracleInstances.applicationId, appId), isNull(applicationOracleInstances.archivedAt)))
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
			and(
				eq(applicationOracleInstances.applicationId, appId),
				eq(applicationOracleInstances.instanceId, instanceId),
				isNull(applicationOracleInstances.archivedAt),
			),
		)
}

// ─── Snapshot Storage ─────────────────────────────────────────────────────

/**
 * Lagrer Excel-vedlegg for en Oracle-revisjonsbevis-snapshot i bucket og
 * registrerer metadata-rad i databasen. Returnerer ny snapshot-ID.
 */
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

/**
 * Henter siste audit-evidence-snapshot per Oracle-instans markert for inkludering
 * i rapporten for en applikasjon.
 */
export async function getAuditEvidenceForReport(appId: string): Promise<ReportEvidence[]> {
	const instances = await db
		.select()
		.from(applicationOracleInstances)
		.where(
			and(
				eq(applicationOracleInstances.applicationId, appId),
				eq(applicationOracleInstances.includeInReport, true),
				isNull(applicationOracleInstances.archivedAt),
			),
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
