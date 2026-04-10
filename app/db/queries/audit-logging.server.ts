import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import { db } from "../connection.server"
import { applicationPersistence, applicationTeamMappings, monitoredApplications } from "../schema/applications"
import { auditLog } from "../schema/audit"
import { persistenceAuditConfirmations, persistenceAuditSummaries } from "../schema/audit-logging"
import { devTeams, sections } from "../schema/organization"

// ─── Types ──────────────────────────────────────────────────────────────────

export type AuditLoggingStatus = "active" | "partial" | "inactive" | "unknown" | "confirmed"

export interface AuditOverviewRow {
	persistenceId: string
	appId: string
	appName: string
	teamName: string | null
	teamSlug: string | null
	persistenceType: string
	persistenceName: string
	auditLogging: boolean | null
	summary: {
		conclusion: string
		reason: string | null
		fetchedAt: Date
		findings: Array<{ severity: string; message: string }> | null
	} | null
	confirmation: {
		id: string
		enabledAt: string
		description: string
		evidenceUrl: string
		confirmedBy: string
		confirmedAt: Date
	} | null
	status: AuditLoggingStatus
}

// ─── Database types that should appear in the overview ──────────────────────

const DATABASE_TYPES = ["cloud_sql_postgres", "nais_postgres", "on_prem_postgres", "oracle", "opensearch"] as const

// ─── Unified status computation ─────────────────────────────────────────────

export function computeAuditStatus(
	persistenceType: string,
	auditLogging: boolean | null,
	summaryConclusion: string | null,
	hasActiveConfirmation: boolean,
): AuditLoggingStatus {
	// Oracle with summary data from oracle-revisjon
	if (persistenceType === "oracle" && summaryConclusion) {
		switch (summaryConclusion) {
			case "FULLSTENDIG":
				return "active"
			case "MANGELFULL":
				return "partial"
			case "AV":
				return "inactive"
			default:
				return hasActiveConfirmation ? "confirmed" : "unknown"
		}
	}

	// Cloud SQL with auditLogging flag from Nais
	if (persistenceType === "cloud_sql_postgres" && auditLogging !== null) {
		return auditLogging ? "active" : "inactive"
	}

	// Manual confirmation for any type
	if (hasActiveConfirmation) {
		return "confirmed"
	}

	return "unknown"
}

// ─── Section audit overview query ───────────────────────────────────────────

export async function getSectionAuditOverview(sectionSlug: string): Promise<AuditOverviewRow[]> {
	const [section] = await db.select({ id: sections.id }).from(sections).where(eq(sections.slug, sectionSlug)).limit(1)
	if (!section) return []

	const rows = await db
		.selectDistinctOn([applicationPersistence.id], {
			persistenceId: applicationPersistence.id,
			appId: monitoredApplications.id,
			appName: monitoredApplications.name,
			teamName: devTeams.name,
			teamSlug: devTeams.slug,
			persistenceType: applicationPersistence.type,
			persistenceName: applicationPersistence.name,
			auditLogging: applicationPersistence.auditLogging,
			// Summary fields
			summaryConclusion: persistenceAuditSummaries.conclusion,
			summaryReason: persistenceAuditSummaries.reason,
			summaryFetchedAt: persistenceAuditSummaries.fetchedAt,
			summaryFindings: persistenceAuditSummaries.findings,
			// Confirmation fields
			confirmationId: persistenceAuditConfirmations.id,
			confirmationEnabledAt: persistenceAuditConfirmations.enabledAt,
			confirmationDescription: persistenceAuditConfirmations.description,
			confirmationEvidenceUrl: persistenceAuditConfirmations.evidenceUrl,
			confirmationConfirmedBy: persistenceAuditConfirmations.confirmedBy,
			confirmationConfirmedAt: persistenceAuditConfirmations.confirmedAt,
		})
		.from(applicationPersistence)
		.innerJoin(monitoredApplications, eq(applicationPersistence.applicationId, monitoredApplications.id))
		.innerJoin(applicationTeamMappings, eq(monitoredApplications.id, applicationTeamMappings.applicationId))
		.innerJoin(devTeams, and(eq(applicationTeamMappings.devTeamId, devTeams.id), eq(devTeams.sectionId, section.id)))
		.leftJoin(persistenceAuditSummaries, eq(applicationPersistence.id, persistenceAuditSummaries.persistenceId))
		.leftJoin(
			persistenceAuditConfirmations,
			and(
				eq(applicationPersistence.id, persistenceAuditConfirmations.persistenceId),
				isNull(persistenceAuditConfirmations.revokedAt),
			),
		)
		.where(inArray(applicationPersistence.type, [...DATABASE_TYPES]))
		.orderBy(applicationPersistence.id, desc(devTeams.name))

	return rows.map((row) => ({
		persistenceId: row.persistenceId,
		appId: row.appId,
		appName: row.appName,
		teamName: row.teamName,
		teamSlug: row.teamSlug,
		persistenceType: row.persistenceType,
		persistenceName: row.persistenceName,
		auditLogging: row.auditLogging,
		summary: row.summaryConclusion
			? {
					conclusion: row.summaryConclusion,
					reason: row.summaryReason,
					fetchedAt: row.summaryFetchedAt ?? new Date(),
					findings: row.summaryFindings,
				}
			: null,
		confirmation: row.confirmationId
			? {
					id: row.confirmationId,
					enabledAt: row.confirmationEnabledAt ?? "",
					description: row.confirmationDescription ?? "",
					evidenceUrl: row.confirmationEvidenceUrl ?? "",
					confirmedBy: row.confirmationConfirmedBy ?? "",
					confirmedAt: row.confirmationConfirmedAt ?? new Date(),
				}
			: null,
		status: computeAuditStatus(
			row.persistenceType,
			row.auditLogging,
			row.summaryConclusion,
			row.confirmationId !== null,
		),
	}))
}

// ─── Manual confirmation CRUD ───────────────────────────────────────────────

export async function createAuditConfirmation(params: {
	persistenceId: string
	enabledAt: string
	description: string
	evidenceUrl: string
	performedBy: string
	metadata?: Record<string, unknown>
}) {
	return db.transaction(async (tx) => {
		const [confirmation] = await tx
			.insert(persistenceAuditConfirmations)
			.values({
				persistenceId: params.persistenceId,
				enabledAt: params.enabledAt,
				description: params.description,
				evidenceUrl: params.evidenceUrl,
				confirmedBy: params.performedBy,
				createdBy: params.performedBy,
				updatedBy: params.performedBy,
			})
			.returning()

		await tx.insert(auditLog).values({
			action: "audit_confirmation_created",
			entityType: "persistence_audit_confirmation",
			entityId: confirmation.id,
			newValue: JSON.stringify({
				persistenceId: params.persistenceId,
				enabledAt: params.enabledAt,
				description: params.description,
				evidenceUrl: params.evidenceUrl,
			}),
			metadata: params.metadata ? JSON.stringify(params.metadata) : null,
			performedBy: params.performedBy,
		})

		return confirmation
	})
}

export async function updateAuditConfirmation(params: {
	confirmationId: string
	enabledAt: string
	description: string
	evidenceUrl: string
	performedBy: string
	metadata?: Record<string, unknown>
}) {
	return db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(persistenceAuditConfirmations)
			.where(
				and(
					eq(persistenceAuditConfirmations.id, params.confirmationId),
					isNull(persistenceAuditConfirmations.revokedAt),
				),
			)
			.limit(1)

		if (!existing) throw new Error(`Confirmation not found or already revoked: ${params.confirmationId}`)

		const [updated] = await tx
			.update(persistenceAuditConfirmations)
			.set({
				enabledAt: params.enabledAt,
				description: params.description,
				evidenceUrl: params.evidenceUrl,
				updatedAt: new Date(),
				updatedBy: params.performedBy,
			})
			.where(
				and(
					eq(persistenceAuditConfirmations.id, params.confirmationId),
					isNull(persistenceAuditConfirmations.revokedAt),
				),
			)
			.returning()

		if (!updated) throw new Error(`Confirmation was revoked during update: ${params.confirmationId}`)

		await tx.insert(auditLog).values({
			action: "audit_confirmation_updated",
			entityType: "persistence_audit_confirmation",
			entityId: params.confirmationId,
			previousValue: JSON.stringify({
				enabledAt: existing.enabledAt,
				description: existing.description,
				evidenceUrl: existing.evidenceUrl,
			}),
			newValue: JSON.stringify({
				enabledAt: params.enabledAt,
				description: params.description,
				evidenceUrl: params.evidenceUrl,
			}),
			metadata: params.metadata ? JSON.stringify(params.metadata) : null,
			performedBy: params.performedBy,
		})

		return updated
	})
}

export async function revokeAuditConfirmation(params: {
	confirmationId: string
	performedBy: string
	metadata?: Record<string, unknown>
}) {
	return db.transaction(async (tx) => {
		// Atomic conditional update: only revoke if not already revoked
		const [revoked] = await tx
			.update(persistenceAuditConfirmations)
			.set({
				revokedAt: new Date(),
				revokedBy: params.performedBy,
				updatedAt: new Date(),
				updatedBy: params.performedBy,
			})
			.where(
				and(
					eq(persistenceAuditConfirmations.id, params.confirmationId),
					isNull(persistenceAuditConfirmations.revokedAt),
				),
			)
			.returning()

		if (!revoked) throw new Error(`Confirmation not found or already revoked: ${params.confirmationId}`)

		await tx.insert(auditLog).values({
			action: "audit_confirmation_revoked",
			entityType: "persistence_audit_confirmation",
			entityId: params.confirmationId,
			previousValue: JSON.stringify({
				enabledAt: revoked.enabledAt,
				description: revoked.description,
				evidenceUrl: revoked.evidenceUrl,
			}),
			metadata: params.metadata ? JSON.stringify(params.metadata) : null,
			performedBy: params.performedBy,
		})

		return revoked
	})
}

// ─── Audit confirmation log for a section ───────────────────────────────────

export async function getAuditConfirmationLog(sectionSlug: string, limit = 50) {
	const [section] = await db.select({ id: sections.id }).from(sections).where(eq(sections.slug, sectionSlug)).limit(1)
	if (!section) return []

	// Get all persistence IDs in this section
	const sectionPersistenceIds = db
		.selectDistinct({ id: applicationPersistence.id })
		.from(applicationPersistence)
		.innerJoin(monitoredApplications, eq(applicationPersistence.applicationId, monitoredApplications.id))
		.innerJoin(applicationTeamMappings, eq(monitoredApplications.id, applicationTeamMappings.applicationId))
		.innerJoin(devTeams, and(eq(applicationTeamMappings.devTeamId, devTeams.id), eq(devTeams.sectionId, section.id)))

	// Get all confirmation IDs for this section's persistence
	const confirmationIds = await db
		.selectDistinct({ id: persistenceAuditConfirmations.id })
		.from(persistenceAuditConfirmations)
		.where(inArray(persistenceAuditConfirmations.persistenceId, sectionPersistenceIds))

	if (confirmationIds.length === 0) return []

	return db
		.select()
		.from(auditLog)
		.where(
			and(
				eq(auditLog.entityType, "persistence_audit_confirmation"),
				inArray(
					auditLog.entityId,
					confirmationIds.map((c) => c.id),
				),
			),
		)
		.orderBy(desc(auditLog.performedAt))
		.limit(limit)
}
