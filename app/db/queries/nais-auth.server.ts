import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import { db } from "../connection.server"
import {
	type AuthIntegrationType,
	applicationAuthIntegrations,
	applicationEnvironments,
	applicationGroupAssessments,
	applicationManualGroups,
	applicationTeamMappings,
	entraGroupClassifications,
	type GroupAccessClassification,
	type GroupCriticality,
	monitoredApplications,
	naisTeams,
} from "../schema/applications"
import { devTeams, sectionEnvironments } from "../schema/organization"
import { writeAuditLog } from "./audit.server"

/** Upsert an auth integration for an application. */
export async function upsertAppAuthIntegration(
	applicationId: string,
	type: AuthIntegrationType,
	opts?: {
		allowAllUsers?: boolean | null
		claimsExtra?: string[] | null
		groups?: string[] | null
		sidecarEnabled?: boolean | null
		inboundRules?: Array<{ application: string; namespace?: string; cluster?: string }> | null
	},
): Promise<boolean> {
	const [existing] = await db
		.select()
		.from(applicationAuthIntegrations)
		.where(
			and(eq(applicationAuthIntegrations.applicationId, applicationId), eq(applicationAuthIntegrations.type, type)),
		)
		.limit(1)

	const claimsExtraStr = opts?.claimsExtra?.length ? JSON.stringify(opts.claimsExtra) : null
	const groupsStr = opts?.groups?.length ? JSON.stringify(opts.groups) : null
	const inboundRulesStr = opts?.inboundRules?.length ? JSON.stringify(opts.inboundRules) : null

	if (existing) {
		await db
			.update(applicationAuthIntegrations)
			.set({
				enabled: true,
				allowAllUsers: opts?.allowAllUsers ?? existing.allowAllUsers,
				claimsExtra: claimsExtraStr ?? existing.claimsExtra,
				groups: groupsStr ?? existing.groups,
				sidecarEnabled: opts?.sidecarEnabled ?? existing.sidecarEnabled,
				inboundRules: inboundRulesStr ?? existing.inboundRules,
				updatedAt: new Date(),
			})
			.where(eq(applicationAuthIntegrations.id, existing.id))
		return false
	}

	await db.insert(applicationAuthIntegrations).values({
		applicationId,
		type,
		allowAllUsers: opts?.allowAllUsers ?? null,
		claimsExtra: claimsExtraStr,
		groups: groupsStr,
		sidecarEnabled: opts?.sidecarEnabled ?? null,
		inboundRules: inboundRulesStr,
	})
	return true
}

/** Get auth integrations for an application. */
export async function getAppAuthIntegrations(applicationId: string) {
	return db
		.select()
		.from(applicationAuthIntegrations)
		.where(eq(applicationAuthIntegrations.applicationId, applicationId))
		.orderBy(applicationAuthIntegrations.type)
}

// ─── Manual Groups ───────────────────────────────────────────────────────

/** Get manually added groups for an application. */
export async function getManualGroupsForApp(applicationId: string) {
	return db
		.select()
		.from(applicationManualGroups)
		.where(eq(applicationManualGroups.applicationId, applicationId))
		.orderBy(applicationManualGroups.createdAt)
}

/** Add a manual group to an application. */
export async function addManualGroup(
	applicationId: string,
	groupId: string,
	groupName: string | null,
	performedBy: string,
) {
	const [inserted] = await db
		.insert(applicationManualGroups)
		.values({ applicationId, groupId, groupName, createdBy: performedBy })
		.onConflictDoNothing()
		.returning()

	if (inserted) {
		await writeAuditLog({
			action: "manual_group_added",
			entityType: "application",
			entityId: applicationId,
			newValue: JSON.stringify({ groupId, groupName }),
			performedBy,
		})
	}

	return inserted ?? null
}

/** Remove a manual group from an application. */
export async function removeManualGroup(id: string, applicationId: string, performedBy: string) {
	const [deleted] = await db
		.delete(applicationManualGroups)
		.where(and(eq(applicationManualGroups.id, id), eq(applicationManualGroups.applicationId, applicationId)))
		.returning()

	if (deleted) {
		await writeAuditLog({
			action: "manual_group_removed",
			entityType: "application",
			entityId: applicationId,
			previousValue: JSON.stringify({ groupId: deleted.groupId, groupName: deleted.groupName }),
			performedBy,
		})
	}

	return deleted ?? null
}

// ─── Group Criticality Assessments ───────────────────────────────────────

/** Get all group criticality assessments for an application. */
export async function getGroupAssessmentsForApp(applicationId: string) {
	return db
		.select()
		.from(applicationGroupAssessments)
		.where(eq(applicationGroupAssessments.applicationId, applicationId))
}

/** Set or update the criticality assessment for a group. */
export async function upsertGroupCriticality(
	applicationId: string,
	groupId: string,
	criticality: GroupCriticality,
	performedBy: string,
) {
	const existing = await db
		.select()
		.from(applicationGroupAssessments)
		.where(
			and(
				eq(applicationGroupAssessments.applicationId, applicationId),
				eq(applicationGroupAssessments.groupId, groupId),
			),
		)
		.then((rows) => rows[0] ?? null)

	if (existing) {
		const [updated] = await db
			.update(applicationGroupAssessments)
			.set({ criticality, updatedBy: performedBy, updatedAt: new Date() })
			.where(eq(applicationGroupAssessments.id, existing.id))
			.returning()

		await writeAuditLog({
			action: "group_criticality_updated",
			entityType: "application",
			entityId: applicationId,
			previousValue: JSON.stringify({ groupId, criticality: existing.criticality }),
			newValue: JSON.stringify({ groupId, criticality }),
			performedBy,
		})

		return updated
	}

	const [inserted] = await db
		.insert(applicationGroupAssessments)
		.values({
			applicationId,
			groupId,
			criticality,
			assessedBy: performedBy,
			updatedBy: performedBy,
		})
		.returning()

	await writeAuditLog({
		action: "group_criticality_updated",
		entityType: "application",
		entityId: applicationId,
		newValue: JSON.stringify({ groupId, criticality }),
		performedBy,
	})

	return inserted
}

// ─── Section-level Group Aggregation ─────────────────────────────────────

export interface SectionGroupRow {
	groupId: string
	applications: Array<{
		applicationId: string
		applicationName: string
		source: "nais" | "manual"
	}>
	criticality: GroupCriticality | null
	assessedBy: string | null
	assessedAt: Date | null
	classification: GroupAccessClassification | null
}

/** Get all Entra ID groups across all applications in a section. */
export async function getSectionGroups(sectionId: string): Promise<SectionGroupRow[]> {
	const sectionTeamRows = await db.select({ id: devTeams.id }).from(devTeams).where(eq(devTeams.sectionId, sectionId))
	const teamIds = sectionTeamRows.map((t) => t.id)

	// Load excluded environments for this section
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
		for (const m of appMappings) {
			appIdSet.add(m.applicationId)
		}
	}

	// Also include apps linked via nais teams
	const sectionNaisTeams = await db
		.select({ id: naisTeams.id })
		.from(naisTeams)
		.where(eq(naisTeams.sectionId, sectionId))
	const naisTeamIds = sectionNaisTeams.map((t) => t.id)

	if (naisTeamIds.length > 0) {
		const envConditions = [
			inArray(applicationEnvironments.naisTeamId, naisTeamIds),
			isNull(monitoredApplications.primaryApplicationId),
		]
		if (excludedEnvs.size > 0) {
			const excludedArray = [...excludedEnvs]
			envConditions.push(
				sql`${applicationEnvironments.cluster} NOT IN (${sql.join(
					excludedArray.map((e) => sql`${e}`),
					sql`, `,
				)})`,
			)
		}
		const naisAppRows = await db
			.selectDistinct({ appId: applicationEnvironments.applicationId })
			.from(applicationEnvironments)
			.innerJoin(monitoredApplications, eq(applicationEnvironments.applicationId, monitoredApplications.id))
			.where(and(...envConditions))
		for (const row of naisAppRows) {
			appIdSet.add(row.appId)
		}
	}

	// Filter out apps whose ONLY environments are in excluded clusters
	if (excludedEnvs.size > 0 && appIdSet.size > 0) {
		const appEnvRows = await db
			.select({
				appId: applicationEnvironments.applicationId,
				cluster: applicationEnvironments.cluster,
			})
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

	// Get all app names
	const apps = await db
		.select({ id: monitoredApplications.id, name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(inArray(monitoredApplications.id, appIds))
	const appNameMap = new Map(apps.map((a) => [a.id, a.name]))

	// Get groups from auth integrations (Nais)
	const authIntegrations = await db
		.select({
			applicationId: applicationAuthIntegrations.applicationId,
			groups: applicationAuthIntegrations.groups,
		})
		.from(applicationAuthIntegrations)
		.where(inArray(applicationAuthIntegrations.applicationId, appIds))

	// Get manual groups
	const manualGroupRows = await db
		.select()
		.from(applicationManualGroups)
		.where(inArray(applicationManualGroups.applicationId, appIds))

	// Get all assessments
	const assessments = await db
		.select()
		.from(applicationGroupAssessments)
		.where(inArray(applicationGroupAssessments.applicationId, appIds))

	// Build unified group map: groupId → { applications, assessment, classification }
	const groupMap = new Map<
		string,
		{
			applications: Map<string, { applicationId: string; applicationName: string; source: "nais" | "manual" }>
			criticality: GroupCriticality | null
			assessedBy: string | null
			assessedAt: Date | null
			classification: GroupAccessClassification | null
		}
	>()

	const ensureGroup = (groupId: string) => {
		if (!groupMap.has(groupId)) {
			groupMap.set(groupId, {
				applications: new Map(),
				criticality: null,
				assessedBy: null,
				assessedAt: null,
				classification: null,
			})
		}
		// biome-ignore lint/style/noNonNullAssertion: guaranteed by set above
		return groupMap.get(groupId)!
	}

	for (const ai of authIntegrations) {
		if (!ai.groups) continue
		try {
			const groupIds = JSON.parse(ai.groups) as string[]
			for (const gid of groupIds) {
				const g = ensureGroup(gid)
				if (!g.applications.has(ai.applicationId)) {
					g.applications.set(ai.applicationId, {
						applicationId: ai.applicationId,
						applicationName: appNameMap.get(ai.applicationId) ?? "Ukjent",
						source: "nais",
					})
				}
			}
		} catch {
			// Invalid JSON — skip
		}
	}

	for (const mg of manualGroupRows) {
		const g = ensureGroup(mg.groupId)
		if (!g.applications.has(mg.applicationId)) {
			g.applications.set(mg.applicationId, {
				applicationId: mg.applicationId,
				applicationName: appNameMap.get(mg.applicationId) ?? "Ukjent",
				source: "manual",
			})
		}
	}

	for (const a of assessments) {
		const g = groupMap.get(a.groupId)
		if (!g) continue
		if (!g.assessedAt || a.updatedAt > g.assessedAt) {
			g.criticality = a.criticality as GroupCriticality
			g.assessedBy = a.assessedBy
			g.assessedAt = a.assessedAt
		}
	}

	// Load global group classifications
	const allGroupIds = [...groupMap.keys()]
	if (allGroupIds.length > 0) {
		const classifications = await db
			.select()
			.from(entraGroupClassifications)
			.where(inArray(entraGroupClassifications.groupId, allGroupIds))
		for (const c of classifications) {
			const g = groupMap.get(c.groupId)
			if (g) g.classification = c.classification as GroupAccessClassification
		}
	}

	return [...groupMap.entries()]
		.map(([groupId, d]) => ({
			groupId,
			applications: [...d.applications.values()],
			criticality: d.criticality,
			assessedBy: d.assessedBy,
			assessedAt: d.assessedAt,
			classification: d.classification,
		}))
		.sort((a, b) => a.groupId.localeCompare(b.groupId))
}

// ─── Entra Group Access Classification ───────────────────────────────────

/** Set or update the access classification for a group. */
export async function upsertGroupClassification(
	groupId: string,
	classification: GroupAccessClassification,
	performedBy: string,
) {
	const existing = await db
		.select()
		.from(entraGroupClassifications)
		.where(eq(entraGroupClassifications.groupId, groupId))
		.then((rows) => rows[0] ?? null)

	if (existing) {
		const [updated] = await db
			.update(entraGroupClassifications)
			.set({ classification, updatedBy: performedBy, updatedAt: new Date() })
			.where(eq(entraGroupClassifications.id, existing.id))
			.returning()

		await writeAuditLog({
			action: "group_classification_updated",
			entityType: "entra_group",
			entityId: groupId,
			previousValue: JSON.stringify({ classification: existing.classification }),
			newValue: JSON.stringify({ classification }),
			performedBy,
		})

		return updated
	}

	const [inserted] = await db
		.insert(entraGroupClassifications)
		.values({
			groupId,
			classification,
			createdBy: performedBy,
			updatedBy: performedBy,
		})
		.returning()

	await writeAuditLog({
		action: "group_classification_updated",
		entityType: "entra_group",
		entityId: groupId,
		newValue: JSON.stringify({ classification }),
		performedBy,
	})

	return inserted
}

export async function deleteGroupClassification(groupId: string, performedBy: string) {
	const existing = await db
		.select()
		.from(entraGroupClassifications)
		.where(eq(entraGroupClassifications.groupId, groupId))
		.then((rows) => rows[0] ?? null)

	if (!existing) return null

	await db.delete(entraGroupClassifications).where(eq(entraGroupClassifications.id, existing.id))

	await writeAuditLog({
		action: "group_classification_updated",
		entityType: "entra_group",
		entityId: groupId,
		previousValue: JSON.stringify({ classification: existing.classification }),
		newValue: JSON.stringify({ classification: null }),
		performedBy,
	})

	return existing
}
