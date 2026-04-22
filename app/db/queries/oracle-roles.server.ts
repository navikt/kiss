import { and, eq, inArray } from "drizzle-orm"
import { db } from "../connection.server"
import { type GroupCriticality, groupCriticalityEnum, monitoredApplications } from "../schema/applications"
import { applicationOracleInstances, oracleRoleAssessments } from "../schema/audit-evidence"
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

	// Capture previous value for audit log
	const existing = await db
		.select({ criticality: oracleRoleAssessments.criticality })
		.from(oracleRoleAssessments)
		.where(
			and(
				eq(oracleRoleAssessments.applicationId, applicationId),
				eq(oracleRoleAssessments.instanceId, instanceId),
				eq(oracleRoleAssessments.roleName, canonical),
			),
		)
		.then((rows) => rows[0] ?? null)

	const [result] = await db
		.insert(oracleRoleAssessments)
		.values({
			applicationId,
			instanceId,
			roleName: canonical,
			criticality,
			assessedBy: performedBy,
			updatedBy: performedBy,
		})
		.onConflictDoUpdate({
			target: [oracleRoleAssessments.applicationId, oracleRoleAssessments.instanceId, oracleRoleAssessments.roleName],
			set: { criticality, updatedBy: performedBy, updatedAt: new Date() },
		})
		.returning()

	await writeAuditLog({
		action: "oracle_role_criticality_updated",
		entityType: "application",
		entityId: applicationId,
		previousValue: existing
			? JSON.stringify({ instanceId, roleName: canonical, criticality: existing.criticality })
			: undefined,
		newValue: JSON.stringify({ instanceId, roleName: canonical, criticality }),
		performedBy,
	})

	return result
}

/** Get all role assessments for an application, keyed by "instanceId:roleName". */
export async function getOracleRoleAssessments(
	applicationId: string,
): Promise<Record<string, { criticality: GroupCriticality; updatedBy: string; updatedAt: string }>> {
	const rows = await db
		.select()
		.from(oracleRoleAssessments)
		.where(eq(oracleRoleAssessments.applicationId, applicationId))

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
			),
		)
		.then((rows) => rows[0] ?? null)
	return row !== null
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
		.where(inArray(applicationOracleInstances.applicationId, appIds))

	const assessments = await db
		.select()
		.from(oracleRoleAssessments)
		.where(inArray(oracleRoleAssessments.applicationId, appIds))

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
