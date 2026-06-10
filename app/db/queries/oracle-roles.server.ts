import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import { db } from "../connection.server"
import { type GroupCriticality, groupCriticalityEnum, monitoredApplications } from "../schema/applications"
import { applicationOracleInstances, oracleRoleAssessments } from "../schema/audit-evidence"
import { routineReviewActivities, routineReviews, routines } from "../schema/routines"
import { writeAuditLog } from "./audit.server"
import { getSectionAppIds } from "./nais.server"

// ─── Oracle Role Criticality CRUD ────────────────────────────────────────

export async function upsertOracleRoleCriticality(
	applicationId: string,
	instanceId: string,
	roleName: string,
	criticality: GroupCriticality,
	performedBy: string,
) {
	const canonical = roleName.toUpperCase().trim()

	return db.transaction(async (tx) => {
		const now = new Date()

		// Attempt INSERT first. The partial unique index (archived_at IS NULL) prevents duplicate active rows
		// atomically, avoiding a TOCTOU race if two concurrent calls both see existing = null.
		const [inserted] = await tx
			.insert(oracleRoleAssessments)
			.values({
				applicationId,
				instanceId,
				roleName: canonical,
				criticality,
				assessedBy: performedBy,
				assessedAt: now,
				updatedBy: performedBy,
				updatedAt: now,
				createdBy: performedBy,
				createdAt: now,
			})
			.onConflictDoNothing({
				target: [oracleRoleAssessments.applicationId, oracleRoleAssessments.instanceId, oracleRoleAssessments.roleName],
				where: isNull(oracleRoleAssessments.archivedAt),
			})
			.returning()

		if (inserted) {
			await writeAuditLog(
				{
					action: "oracle_role_criticality_updated",
					entityType: "application",
					entityId: applicationId,
					newValue: JSON.stringify({ instanceId, roleName: canonical, criticality }),
					performedBy,
				},
				tx,
			)
			return inserted
		}

		// Conflict: an active row already exists — fetch it and update
		const existing = await tx
			.select({ id: oracleRoleAssessments.id, criticality: oracleRoleAssessments.criticality })
			.from(oracleRoleAssessments)
			.where(
				and(
					eq(oracleRoleAssessments.applicationId, applicationId),
					eq(oracleRoleAssessments.instanceId, instanceId),
					eq(oracleRoleAssessments.roleName, canonical),
					isNull(oracleRoleAssessments.archivedAt),
				),
			)
			.then((rows) => rows[0])

		if (!existing) {
			// The active row was archived between the INSERT conflict and this SELECT (race condition).
			// Throw a controlled error so the caller can retry instead of crashing with a TypeError.
			throw new Error("Oracle-rollevurdering finnes ikke lenger (mulig race condition). Prøv igjen.")
		}

		const [updated] = await tx
			.update(oracleRoleAssessments)
			.set({
				criticality,
				assessedBy: performedBy,
				assessedAt: now,
				updatedBy: performedBy,
				updatedAt: now,
			})
			.where(eq(oracleRoleAssessments.id, existing.id))
			.returning()

		await writeAuditLog(
			{
				action: "oracle_role_criticality_updated",
				entityType: "application",
				entityId: applicationId,
				previousValue: JSON.stringify({ instanceId, roleName: canonical, criticality: existing.criticality }),
				newValue: JSON.stringify({ instanceId, roleName: canonical, criticality }),
				performedBy,
			},
			tx,
		)

		return updated
	})
}

/** Get all active (non-archived) role assessments for an application, keyed by "instanceId:roleName". */
export async function getOracleRoleAssessments(
	applicationId: string,
): Promise<Record<string, { criticality: GroupCriticality; updatedBy: string; updatedAt: string }>> {
	const rows = await db
		.select()
		.from(oracleRoleAssessments)
		.where(and(eq(oracleRoleAssessments.applicationId, applicationId), isNull(oracleRoleAssessments.archivedAt)))

	const result: Record<string, { criticality: GroupCriticality; updatedBy: string; updatedAt: string }> = {}
	for (const row of rows) {
		if (!groupCriticalityEnum.includes(row.criticality as GroupCriticality)) continue
		const key = `${row.instanceId}:${row.roleName}`
		result[key] = {
			criticality: row.criticality as GroupCriticality,
			updatedBy: row.updatedBy,
			updatedAt: row.updatedAt.toISOString(),
		}
	}
	return result
}

/** Verify that an Oracle instance is linked to an application. */
export async function isInstanceLinkedToApp(applicationId: string, instanceId: string): Promise<boolean> {
	const row = await db
		.select({ id: applicationOracleInstances.id })
		.from(applicationOracleInstances)
		.where(
			and(
				eq(applicationOracleInstances.applicationId, applicationId),
				eq(applicationOracleInstances.instanceId, instanceId),
				isNull(applicationOracleInstances.archivedAt),
			),
		)
		.then((rows) => rows[0] ?? null)
	return row !== null
}

// ─── Latest Oracle Role Criticality Review ───────────────────────────────

/**
 * Returns the most recent completed review that contains an oracle_role_criticality
 * activity for the given application, used to link back to the source gjennomgang.
 */
export async function getLatestOracleRoleCriticalityReview(applicationId: string): Promise<{
	reviewId: string
	routineId: string
	sectionId: string | null
	title: string
	reviewedAt: Date
} | null> {
	const row = await db
		.select({
			reviewId: routineReviews.id,
			routineId: routineReviews.routineId,
			sectionId: routines.sectionId,
			title: routineReviews.title,
			reviewedAt: routineReviews.reviewedAt,
		})
		.from(routineReviewActivities)
		.innerJoin(routineReviews, eq(routineReviewActivities.reviewId, routineReviews.id))
		.innerJoin(routines, eq(routineReviews.routineId, routines.id))
		.where(
			and(eq(routineReviewActivities.type, "oracle_role_criticality"), eq(routineReviews.applicationId, applicationId)),
		)
		.orderBy(desc(routineReviews.reviewedAt))
		.limit(1)
		.then((rows) => rows[0] ?? null)

	return row
}

// ─── Section-level Oracle Role Overview ──────────────────────────────────

export interface SectionOracleRoleRow {
	instanceId: string
	roleName: string
	applications: Array<{
		applicationId: string
		applicationName: string
	}>
	criticality: GroupCriticality
	assessedBy: string
	assessedAt: Date
}

/** Get all Oracle roles with assessments across all applications in a section. */
export async function getSectionOracleRoles(sectionId: string): Promise<SectionOracleRoleRow[]> {
	const appIdSet = await getSectionAppIds(sectionId)
	const appIds = [...appIdSet]
	if (appIds.length === 0) return []

	const apps = await db
		.select({ id: monitoredApplications.id, name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(inArray(monitoredApplications.id, appIds))
	const appNameMap = new Map(apps.map((a) => [a.id, a.name]))

	const instanceLinks = await db
		.select()
		.from(applicationOracleInstances)
		.where(
			and(inArray(applicationOracleInstances.applicationId, appIds), isNull(applicationOracleInstances.archivedAt)),
		)

	const assessments = await db
		.select()
		.from(oracleRoleAssessments)
		.where(and(inArray(oracleRoleAssessments.applicationId, appIds), isNull(oracleRoleAssessments.archivedAt)))

	// Build map: "instanceId:roleName" → { applications, criticality }
	const roleMap = new Map<
		string,
		{
			instanceId: string
			roleName: string
			applications: Map<string, { applicationId: string; applicationName: string }>
			criticality: GroupCriticality
			assessedBy: string
			assessedAt: Date
			latestUpdatedAt: Date
		}
	>()

	// Pre-index assessments by (applicationId:instanceId) for O(1) lookup
	const assessmentsByAppAndInstance = new Map<string, typeof assessments>()
	for (const assessment of assessments) {
		if (!groupCriticalityEnum.includes(assessment.criticality as GroupCriticality)) continue
		const assessmentKey = `${assessment.applicationId}:${assessment.instanceId}`
		const existing = assessmentsByAppAndInstance.get(assessmentKey)
		if (existing) {
			existing.push(assessment)
		} else {
			assessmentsByAppAndInstance.set(assessmentKey, [assessment])
		}
	}

	for (const link of instanceLinks) {
		const appName = appNameMap.get(link.applicationId) ?? "Ukjent"
		const appAssessments = assessmentsByAppAndInstance.get(`${link.applicationId}:${link.instanceId}`) ?? []

		for (const assessment of appAssessments) {
			const key = `${assessment.instanceId}:${assessment.roleName}`
			const entry = roleMap.get(key)

			if (!entry) {
				roleMap.set(key, {
					instanceId: assessment.instanceId,
					roleName: assessment.roleName,
					applications: new Map([
						[link.applicationId, { applicationId: link.applicationId, applicationName: appName }],
					]),
					criticality: assessment.criticality as GroupCriticality,
					assessedBy: assessment.assessedBy,
					assessedAt: assessment.assessedAt,
					latestUpdatedAt: assessment.updatedAt,
				})
				continue
			}

			entry.applications.set(link.applicationId, {
				applicationId: link.applicationId,
				applicationName: appName,
			})

			// Use updatedAt for recency comparison, but return assessedBy/assessedAt
			if (assessment.updatedAt > entry.latestUpdatedAt) {
				entry.criticality = assessment.criticality as GroupCriticality
				entry.assessedBy = assessment.assessedBy
				entry.assessedAt = assessment.assessedAt
				entry.latestUpdatedAt = assessment.updatedAt
			}
		}
	}

	return [...roleMap.values()]
		.map((d) => ({
			instanceId: d.instanceId,
			roleName: d.roleName,
			applications: [...d.applications.values()],
			criticality: d.criticality,
			assessedBy: d.assessedBy,
			assessedAt: d.assessedAt,
		}))
		.sort((a, b) => a.instanceId.localeCompare(b.instanceId) || a.roleName.localeCompare(b.roleName))
}
