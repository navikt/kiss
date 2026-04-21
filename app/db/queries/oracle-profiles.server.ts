import { and, eq, inArray, isNull } from "drizzle-orm"
import { db } from "../connection.server"
import {
	applicationEnvironments,
	applicationTeamMappings,
	type GroupCriticality,
	monitoredApplications,
	naisTeams,
} from "../schema/applications"
import { applicationOracleInstances, oracleProfileAssessments } from "../schema/audit-evidence"
import { devTeams, sectionEnvironments } from "../schema/organization"
import { writeAuditLog } from "./audit.server"

// ─── Oracle Profile Criticality CRUD ─────────────────────────────────────

export async function upsertOracleProfileCriticality(
	applicationId: string,
	instanceId: string,
	profileName: string,
	criticality: GroupCriticality,
	performedBy: string,
) {
	const canonical = profileName.toUpperCase().trim()

	const existing = await db
		.select()
		.from(oracleProfileAssessments)
		.where(
			and(
				eq(oracleProfileAssessments.applicationId, applicationId),
				eq(oracleProfileAssessments.instanceId, instanceId),
				eq(oracleProfileAssessments.profileName, canonical),
			),
		)
		.then((rows) => rows[0] ?? null)

	if (existing) {
		const [updated] = await db
			.update(oracleProfileAssessments)
			.set({ criticality, updatedBy: performedBy, updatedAt: new Date() })
			.where(eq(oracleProfileAssessments.id, existing.id))
			.returning()

		await writeAuditLog({
			action: "oracle_profile_criticality_updated",
			entityType: "application",
			entityId: applicationId,
			previousValue: JSON.stringify({ instanceId, profileName: canonical, criticality: existing.criticality }),
			newValue: JSON.stringify({ instanceId, profileName: canonical, criticality }),
			performedBy,
		})

		return updated
	}

	const [inserted] = await db
		.insert(oracleProfileAssessments)
		.values({
			applicationId,
			instanceId,
			profileName: canonical,
			criticality,
			assessedBy: performedBy,
			updatedBy: performedBy,
		})
		.returning()

	await writeAuditLog({
		action: "oracle_profile_criticality_updated",
		entityType: "application",
		entityId: applicationId,
		newValue: JSON.stringify({ instanceId, profileName: canonical, criticality }),
		performedBy,
	})

	return inserted
}

/** Get all profile assessments for an application, keyed by "instanceId:profileName". */
export async function getOracleProfileAssessments(
	applicationId: string,
): Promise<Record<string, { criticality: string; updatedBy: string; updatedAt: string }>> {
	const rows = await db
		.select()
		.from(oracleProfileAssessments)
		.where(eq(oracleProfileAssessments.applicationId, applicationId))

	const result: Record<string, { criticality: string; updatedBy: string; updatedAt: string }> = {}
	for (const row of rows) {
		const key = `${row.instanceId}:${row.profileName}`
		result[key] = {
			criticality: row.criticality,
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

// ─── Section-level Oracle Profile Overview ───────────────────────────────

export interface SectionOracleProfileRow {
	instanceId: string
	profileName: string
	applications: Array<{
		applicationId: string
		applicationName: string
	}>
	criticality: GroupCriticality | null
	assessedBy: string | null
	assessedAt: Date | null
}

/** Get all Oracle profiles with assessments across all applications in a section. */
export async function getSectionOracleProfiles(sectionId: string): Promise<SectionOracleProfileRow[]> {
	const sectionTeamRows = await db.select({ id: devTeams.id }).from(devTeams).where(eq(devTeams.sectionId, sectionId))
	const teamIds = sectionTeamRows.map((t) => t.id)

	// Load excluded environments
	const excludedRows = await db
		.select({ cluster: sectionEnvironments.cluster })
		.from(sectionEnvironments)
		.where(and(eq(sectionEnvironments.sectionId, sectionId), eq(sectionEnvironments.included, false)))
	const excludedEnvs = new Set(excludedRows.map((r) => r.cluster))

	const appIdSet = new Set<string>()

	if (teamIds.length > 0) {
		const appMappings = await db
			.select({ applicationId: applicationTeamMappings.applicationId })
			.from(applicationTeamMappings)
			.where(inArray(applicationTeamMappings.devTeamId, teamIds))
		for (const m of appMappings) appIdSet.add(m.applicationId)
	}

	// Include apps linked via nais teams
	const sectionNaisTeams = await db
		.select({ id: naisTeams.id })
		.from(naisTeams)
		.where(eq(naisTeams.sectionId, sectionId))
	const naisTeamIds = sectionNaisTeams.map((t) => t.id)

	if (naisTeamIds.length > 0) {
		const naisAppRows = await db
			.selectDistinct({ appId: applicationEnvironments.applicationId })
			.from(applicationEnvironments)
			.innerJoin(monitoredApplications, eq(applicationEnvironments.applicationId, monitoredApplications.id))
			.where(
				and(
					inArray(applicationEnvironments.naisTeamId, naisTeamIds),
					isNull(monitoredApplications.primaryApplicationId),
				),
			)
		for (const row of naisAppRows) appIdSet.add(row.appId)
	}

	// Filter apps whose ONLY environments are excluded
	if (excludedEnvs.size > 0 && appIdSet.size > 0) {
		const appEnvRows = await db
			.select({ appId: applicationEnvironments.applicationId, cluster: applicationEnvironments.cluster })
			.from(applicationEnvironments)
			.where(inArray(applicationEnvironments.applicationId, [...appIdSet]))
		const appEnvMap = new Map<string, Set<string>>()
		for (const row of appEnvRows) {
			if (!appEnvMap.has(row.appId)) appEnvMap.set(row.appId, new Set())
			appEnvMap.get(row.appId)?.add(row.cluster)
		}
		for (const appId of appIdSet) {
			const clusters = appEnvMap.get(appId)
			if (clusters && clusters.size > 0 && [...clusters].every((c) => excludedEnvs.has(c))) {
				appIdSet.delete(appId)
			}
		}
	}

	const appIds = [...appIdSet]
	if (appIds.length === 0) return []

	// Get app names
	const apps = await db
		.select({ id: monitoredApplications.id, name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(inArray(monitoredApplications.id, appIds))
	const appNameMap = new Map(apps.map((a) => [a.id, a.name]))

	// Get Oracle instances linked to these apps
	const instanceLinks = await db
		.select()
		.from(applicationOracleInstances)
		.where(inArray(applicationOracleInstances.applicationId, appIds))

	// Get all profile assessments
	const assessments = await db
		.select()
		.from(oracleProfileAssessments)
		.where(inArray(oracleProfileAssessments.applicationId, appIds))

	// Build map: "instanceId:profileName" → { applications, criticality }
	const profileMap = new Map<
		string,
		{
			instanceId: string
			profileName: string
			applications: Map<string, { applicationId: string; applicationName: string }>
			criticality: GroupCriticality | null
			assessedBy: string | null
			assessedAt: Date | null
		}
	>()

	// Pre-index assessments by (applicationId:instanceId) for O(1) lookup
	const assessmentsByAppAndInstance = new Map<string, typeof assessments>()
	for (const assessment of assessments) {
		const assessmentKey = `${assessment.applicationId}:${assessment.instanceId}`
		const existing = assessmentsByAppAndInstance.get(assessmentKey)
		if (existing) {
			existing.push(assessment)
		} else {
			assessmentsByAppAndInstance.set(assessmentKey, [assessment])
		}
	}

	// Add applications that have Oracle instances
	for (const link of instanceLinks) {
		const appName = appNameMap.get(link.applicationId) ?? "Ukjent"
		const appAssessments = assessmentsByAppAndInstance.get(`${link.applicationId}:${link.instanceId}`) ?? []

		for (const assessment of appAssessments) {
			const key = `${assessment.instanceId}:${assessment.profileName}`
			if (!profileMap.has(key)) {
				profileMap.set(key, {
					instanceId: assessment.instanceId,
					profileName: assessment.profileName,
					applications: new Map(),
					criticality: null,
					assessedBy: null,
					assessedAt: null,
				})
			}
			const entry = profileMap.get(key)
			if (!entry) continue

			entry.applications.set(link.applicationId, {
				applicationId: link.applicationId,
				applicationName: appName,
			})

			// Use the most recently updated assessment
			if (!entry.assessedAt || assessment.updatedAt > entry.assessedAt) {
				entry.criticality = assessment.criticality as GroupCriticality
				entry.assessedBy = assessment.assessedBy
				entry.assessedAt = assessment.updatedAt
			}
		}
	}

	return [...profileMap.values()]
		.map((d) => ({
			instanceId: d.instanceId,
			profileName: d.profileName,
			applications: [...d.applications.values()],
			criticality: d.criticality,
			assessedBy: d.assessedBy,
			assessedAt: d.assessedAt,
		}))
		.sort((a, b) => a.instanceId.localeCompare(b.instanceId) || a.profileName.localeCompare(b.profileName))
}
