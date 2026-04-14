import { and, count, eq, inArray, isNull, sql } from "drizzle-orm"
import { db } from "../connection.server"
import {
	applicationEnvironments,
	applicationTeamMappings,
	devTeamNaisTeamMappings,
	monitoredApplications,
	naisTeams,
	sectionIgnoredApplications,
} from "../schema/applications"
import { complianceAssessments } from "../schema/compliance"
import { frameworkControls } from "../schema/framework"
import { devTeams, sections } from "../schema/organization"
import { writeAuditLog } from "./audit.server"

/** Get all sections. */
export async function getSections() {
	return db.select().from(sections).orderBy(sections.name)
}

/** Get a section by slug (lightweight lookup). */
export async function getSectionBySlug(slug: string) {
	const [section] = await db.select().from(sections).where(eq(sections.slug, slug)).limit(1)
	return section ?? null
}

type ComplianceStats = { implemented: number; partial: number; notImplemented: number; notRelevant: number }

/** Get compliance assessment counts for multiple applications in a single query. */
async function getBatchComplianceStats(appIds: string[]): Promise<Map<string, ComplianceStats>> {
	const result = new Map<string, ComplianceStats>()
	if (appIds.length === 0) return result

	for (const id of appIds) {
		result.set(id, { implemented: 0, partial: 0, notImplemented: 0, notRelevant: 0 })
	}

	const rows = await db
		.select({
			applicationId: complianceAssessments.applicationId,
			status: complianceAssessments.status,
			count: count(),
		})
		.from(complianceAssessments)
		.where(inArray(complianceAssessments.applicationId, appIds))
		.groupBy(complianceAssessments.applicationId, complianceAssessments.status)

	for (const row of rows) {
		const stats = result.get(row.applicationId)
		if (!stats) continue
		switch (row.status) {
			case "implemented":
				stats.implemented = row.count
				break
			case "partially_implemented":
				stats.partial = row.count
				break
			case "not_implemented":
				stats.notImplemented = row.count
				break
			case "not_relevant":
				stats.notRelevant = row.count
				break
		}
	}

	return result
}

/** Get all unique primary app IDs for a dev team (direct + via linked Nais teams, excluding ignored). */
async function getTeamAppIds(teamId: string, sectionId: string) {
	// Direct mappings
	const directRows = await db
		.select({ appId: applicationTeamMappings.applicationId })
		.from(applicationTeamMappings)
		.innerJoin(monitoredApplications, eq(applicationTeamMappings.applicationId, monitoredApplications.id))
		.where(
			sql`${applicationTeamMappings.devTeamId} = ${teamId} AND ${monitoredApplications.primaryApplicationId} IS NULL`,
		)
	const directIds = new Set(directRows.map((r) => r.appId))

	// Apps from linked Nais teams
	const linkedNaisTeamIds = (
		await db
			.select({ naisTeamId: devTeamNaisTeamMappings.naisTeamId })
			.from(devTeamNaisTeamMappings)
			.where(eq(devTeamNaisTeamMappings.devTeamId, teamId))
	).map((r) => r.naisTeamId)

	const naisAppIds = new Set<string>()
	if (linkedNaisTeamIds.length > 0) {
		const ignoredAppIds = new Set(
			(
				await db
					.select({ appId: sectionIgnoredApplications.applicationId })
					.from(sectionIgnoredApplications)
					.where(eq(sectionIgnoredApplications.sectionId, sectionId))
			).map((r) => r.appId),
		)

		const naisAppRows = await db
			.selectDistinct({ appId: applicationEnvironments.applicationId })
			.from(applicationEnvironments)
			.innerJoin(monitoredApplications, eq(applicationEnvironments.applicationId, monitoredApplications.id))
			.where(
				and(
					sql`${applicationEnvironments.naisTeamId} IN (${sql.join(linkedNaisTeamIds, sql`, `)})`,
					isNull(monitoredApplications.primaryApplicationId),
				),
			)
		for (const row of naisAppRows) {
			if (!ignoredAppIds.has(row.appId)) {
				naisAppIds.add(row.appId)
			}
		}
	}

	// Merge: direct + nais (deduplicated)
	const allIds = new Set([...directIds, ...naisAppIds])
	return { allIds, directIds, naisAppIds }
}

/** Get section detail with team compliance stats. */
export async function getSectionDetail(seksjonSlug: string) {
	const [section] = await db.select().from(sections).where(eq(sections.slug, seksjonSlug)).limit(1)
	if (!section) return null

	const teams = await db.select().from(devTeams).where(eq(devTeams.sectionId, section.id)).orderBy(devTeams.name)

	const [totalControlsRow] = await db
		.select({ count: count() })
		.from(frameworkControls)
		.where(isNull(frameworkControls.archivedAt))
	const totalControls = totalControlsRow?.count ?? 0

	// Phase 1: Collect all app IDs per team
	const teamAppMaps: { team: (typeof teams)[0]; allIds: Set<string> }[] = []
	const allAssignedAppIds = new Set<string>()

	for (const team of teams) {
		const { allIds } = await getTeamAppIds(team.id, section.id)
		teamAppMaps.push({ team, allIds })
		for (const id of allIds) {
			allAssignedAppIds.add(id)
		}
	}

	// Phase 2: Collect unassigned app IDs
	const sectionNaisTeamRows = await db.select().from(naisTeams).where(eq(naisTeams.sectionId, section.id))
	const naisTeamIds = sectionNaisTeamRows.map((t) => t.id)

	let unassignedAppIds: string[] = []

	if (naisTeamIds.length > 0) {
		const naisAppRows = await db
			.selectDistinct({ appId: applicationEnvironments.applicationId })
			.from(applicationEnvironments)
			.innerJoin(monitoredApplications, eq(applicationEnvironments.applicationId, monitoredApplications.id))
			.where(
				and(
					sql`${applicationEnvironments.naisTeamId} IN (${sql.join(naisTeamIds, sql`, `)})`,
					isNull(monitoredApplications.primaryApplicationId),
				),
			)

		const ignoredAppIds = new Set(
			(
				await db
					.select({ appId: sectionIgnoredApplications.applicationId })
					.from(sectionIgnoredApplications)
					.where(eq(sectionIgnoredApplications.sectionId, section.id))
			).map((r) => r.appId),
		)

		unassignedAppIds = naisAppRows
			.map((r) => r.appId)
			.filter((id) => !allAssignedAppIds.has(id) && !ignoredAppIds.has(id))
	}

	// Phase 3: Batch-fetch compliance stats for ALL apps in one query
	const allAppIds = [...allAssignedAppIds, ...unassignedAppIds.filter((id) => !allAssignedAppIds.has(id))]
	const statsMap = await getBatchComplianceStats(allAppIds)

	// Phase 4: Build team stats from the pre-fetched map
	const teamStats = teamAppMaps.map(({ team, allIds }) => {
		let implemented = 0
		let partial = 0
		let notImplemented = 0
		let notRelevant = 0

		for (const appId of allIds) {
			const stats = statsMap.get(appId) ?? { implemented: 0, partial: 0, notImplemented: 0, notRelevant: 0 }
			implemented += stats.implemented
			partial += stats.partial
			notImplemented += stats.notImplemented
			notRelevant += stats.notRelevant
		}

		return {
			slug: team.slug,
			name: team.name,
			apps: allIds.size,
			implemented,
			partial,
			notImplemented,
			notRelevant,
			total: totalControls * allIds.size,
		}
	})

	// Phase 5: Build unassigned stats
	let unassignedStats = {
		apps: 0,
		implemented: 0,
		partial: 0,
		notImplemented: 0,
		notRelevant: 0,
		total: 0,
	}

	if (unassignedAppIds.length > 0) {
		let uImpl = 0
		let uPartial = 0
		let uNotImpl = 0
		let uNotRel = 0

		for (const appId of unassignedAppIds) {
			const stats = statsMap.get(appId) ?? { implemented: 0, partial: 0, notImplemented: 0, notRelevant: 0 }
			uImpl += stats.implemented
			uPartial += stats.partial
			uNotImpl += stats.notImplemented
			uNotRel += stats.notRelevant
		}

		unassignedStats = {
			apps: unassignedAppIds.length,
			implemented: uImpl,
			partial: uPartial,
			notImplemented: uNotImpl,
			notRelevant: uNotRel,
			total: totalControls * unassignedAppIds.length,
		}

		for (const id of unassignedAppIds) {
			allAssignedAppIds.add(id)
		}
	}

	return { section, teams: teamStats, unassignedStats, allAppIds: [...allAssignedAppIds] }
}

/** Generate a URL-friendly slug from a name. */
function generateSlug(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9\s-æøå]/g, "")
		.replace(/[æ]/g, "ae")
		.replace(/[ø]/g, "o")
		.replace(/[å]/g, "a")
		.replace(/[\s]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
}

/** Create a new section. */
export async function createSection(name: string, description: string | null, createdBy: string) {
	const slug = generateSlug(name)
	const [section] = await db
		.insert(sections)
		.values({ name, slug, description, createdBy, updatedBy: createdBy })
		.returning()
	await writeAuditLog({
		action: "section_created",
		entityType: "section",
		entityId: section.id,
		newValue: name,
		metadata: { slug, description },
		performedBy: createdBy,
	})
	return section
}

/** Update an existing section. */
export async function updateSection(id: string, name: string, description: string | null, updatedBy: string) {
	const [prev] = await db.select().from(sections).where(eq(sections.id, id)).limit(1)
	const slug = generateSlug(name)
	const [section] = await db
		.update(sections)
		.set({ name, slug, description, updatedBy, updatedAt: new Date() })
		.where(eq(sections.id, id))
		.returning()
	await writeAuditLog({
		action: "section_updated",
		entityType: "section",
		entityId: id,
		previousValue: prev?.name ?? null,
		newValue: name,
		metadata: { slug, description, previousDescription: prev?.description },
		performedBy: updatedBy,
	})
	return section
}

/** Delete a section and all its teams. */
export async function deleteSection(id: string, performedBy: string) {
	const [prev] = await db.select().from(sections).where(eq(sections.id, id)).limit(1)
	const teams = await db.select().from(devTeams).where(eq(devTeams.sectionId, id))
	await db.delete(devTeams).where(eq(devTeams.sectionId, id))
	await db.delete(sections).where(eq(sections.id, id))
	await writeAuditLog({
		action: "section_deleted",
		entityType: "section",
		entityId: id,
		previousValue: prev?.name ?? null,
		metadata: { deletedTeams: teams.map((t) => t.name) },
		performedBy,
	})
}

/** Create a new dev team in a section. */
export async function createTeam(sectionId: string, name: string, description: string | null, createdBy: string) {
	const slug = generateSlug(name)
	const [team] = await db
		.insert(devTeams)
		.values({ sectionId, name, slug, description, createdBy, updatedBy: createdBy })
		.returning()
	await writeAuditLog({
		action: "team_created",
		entityType: "team",
		entityId: team.id,
		newValue: name,
		metadata: { sectionId, slug, description },
		performedBy: createdBy,
	})
	return team
}

/** Update an existing dev team. */
export async function updateTeam(id: string, name: string, description: string | null, updatedBy: string) {
	const [prev] = await db.select().from(devTeams).where(eq(devTeams.id, id)).limit(1)
	const slug = generateSlug(name)
	const [team] = await db
		.update(devTeams)
		.set({ name, slug, description, updatedBy, updatedAt: new Date() })
		.where(eq(devTeams.id, id))
		.returning()
	await writeAuditLog({
		action: "team_updated",
		entityType: "team",
		entityId: id,
		previousValue: prev?.name ?? null,
		newValue: name,
		metadata: { slug, description, previousDescription: prev?.description },
		performedBy: updatedBy,
	})
	return team
}

/** Delete a dev team. */
export async function deleteTeam(id: string, performedBy: string) {
	const [prev] = await db.select().from(devTeams).where(eq(devTeams.id, id)).limit(1)
	await db.delete(devTeams).where(eq(devTeams.id, id))
	await writeAuditLog({
		action: "team_deleted",
		entityType: "team",
		entityId: id,
		previousValue: prev?.name ?? null,
		metadata: { sectionId: prev?.sectionId },
		performedBy,
	})
}

/** Get all teams for a section, ordered by name. */
/** Get all teams for a section with linked Nais team counts. */
export async function getTeamsForSection(sectionId: string) {
	const teams = await db.select().from(devTeams).where(eq(devTeams.sectionId, sectionId)).orderBy(devTeams.name)
	const teamsWithNais = await Promise.all(
		teams.map(async (team) => {
			const naisLinks = await db
				.select({ slug: naisTeams.slug })
				.from(devTeamNaisTeamMappings)
				.innerJoin(naisTeams, eq(devTeamNaisTeamMappings.naisTeamId, naisTeams.id))
				.where(eq(devTeamNaisTeamMappings.devTeamId, team.id))
			return { ...team, linkedNaisTeams: naisLinks.map((n) => n.slug) }
		}),
	)
	return teamsWithNais
}

/** Get a dev team by slug (lightweight lookup). */
export async function getTeamBySlug(slug: string) {
	const [team] = await db.select().from(devTeams).where(eq(devTeams.slug, slug)).limit(1)
	return team ?? null
}

/** Get apps for a specific dev team. */
export async function getTeamApps(teamSlug: string) {
	const [team] = await db.select().from(devTeams).where(eq(devTeams.slug, teamSlug)).limit(1)
	if (!team) return null

	const [totalControlsRow] = await db
		.select({ count: count() })
		.from(frameworkControls)
		.where(isNull(frameworkControls.archivedAt))
	const totalControls = totalControlsRow?.count ?? 0

	const { allIds, directIds } = await getTeamAppIds(team.id, team.sectionId)

	const appIdList = [...allIds]
	const [appRows, statsMap] = await Promise.all([
		appIdList.length > 0
			? db.select().from(monitoredApplications).where(inArray(monitoredApplications.id, appIdList))
			: Promise.resolve([]),
		getBatchComplianceStats(appIdList),
	])

	const appById = new Map(appRows.map((a) => [a.id, a]))

	const apps = appIdList
		.map((appId) => {
			const app = appById.get(appId)
			if (!app) return null
			const stats = statsMap.get(appId) ?? { implemented: 0, partial: 0, notImplemented: 0, notRelevant: 0 }
			return {
				appId: app.id,
				appName: app.name,
				implemented: stats.implemented,
				partial: stats.partial,
				notImplemented: stats.notImplemented,
				total: totalControls,
				source: directIds.has(appId) ? ("direct" as const) : ("nais-team" as const),
			}
		})
		.filter((a): a is NonNullable<typeof a> => a !== null)

	apps.sort((a, b) => a.appName.localeCompare(b.appName, "nb"))

	return { team, apps }
}

/** Get aggregated apps across multiple dev teams (by IDs). */
export async function getAppsForMultipleTeams(teamIds: string[]) {
	if (teamIds.length === 0) return { teams: [], apps: [] }

	const teamRows = await db
		.select({
			id: devTeams.id,
			name: devTeams.name,
			slug: devTeams.slug,
			sectionId: devTeams.sectionId,
			sectionName: sections.name,
			sectionSlug: sections.slug,
		})
		.from(devTeams)
		.innerJoin(sections, eq(devTeams.sectionId, sections.id))
		.where(inArray(devTeams.id, teamIds))

	const [totalControlsRow] = await db
		.select({ count: count() })
		.from(frameworkControls)
		.where(isNull(frameworkControls.archivedAt))
	const totalControls = totalControlsRow?.count ?? 0

	// Collect app IDs from all teams, tracking which team each belongs to
	const appToTeams = new Map<string, Set<string>>()
	const appSources = new Map<string, "direct" | "nais-team">()

	for (const team of teamRows) {
		const { allIds, directIds } = await getTeamAppIds(team.id, team.sectionId)
		for (const appId of allIds) {
			if (!appToTeams.has(appId)) appToTeams.set(appId, new Set())
			appToTeams.get(appId)?.add(team.id)
			if (directIds.has(appId)) appSources.set(appId, "direct")
			else if (!appSources.has(appId)) appSources.set(appId, "nais-team")
		}
	}

	const allAppIds = [...appToTeams.keys()]
	const [appRows, statsMap] = await Promise.all([
		allAppIds.length > 0
			? db.select().from(monitoredApplications).where(inArray(monitoredApplications.id, allAppIds))
			: Promise.resolve([]),
		getBatchComplianceStats(allAppIds),
	])

	const appById = new Map(appRows.map((a) => [a.id, a]))

	const apps = allAppIds
		.map((appId) => {
			const app = appById.get(appId)
			if (!app) return null
			const stats = statsMap.get(appId) ?? { implemented: 0, partial: 0, notImplemented: 0, notRelevant: 0 }
			return {
				appId: app.id,
				appName: app.name,
				implemented: stats.implemented,
				partial: stats.partial,
				notImplemented: stats.notImplemented,
				total: totalControls,
				source: appSources.get(appId) ?? ("nais-team" as const),
				teamIds: [...(appToTeams.get(appId) ?? [])],
			}
		})
		.filter((a): a is NonNullable<typeof a> => a !== null)

	apps.sort((a, b) => a.appName.localeCompare(b.appName, "nb"))

	return { teams: teamRows, apps }
}

/** Link a Nais team to a dev team (by Nais team slug). */
export async function linkNaisTeamToDevTeam(naisTeamSlug: string, devTeamId: string, performedBy: string) {
	const [naisTeam] = await db.select().from(naisTeams).where(eq(naisTeams.slug, naisTeamSlug)).limit(1)
	if (!naisTeam) throw new Error(`Nais-team not found: ${naisTeamSlug}`)

	const [existing] = await db
		.select()
		.from(devTeamNaisTeamMappings)
		.where(and(eq(devTeamNaisTeamMappings.naisTeamId, naisTeam.id), eq(devTeamNaisTeamMappings.devTeamId, devTeamId)))
		.limit(1)
	if (existing) return existing

	const [mapping] = await db
		.insert(devTeamNaisTeamMappings)
		.values({ naisTeamId: naisTeam.id, devTeamId, createdBy: performedBy })
		.returning()

	const [team] = await db.select({ name: devTeams.name }).from(devTeams).where(eq(devTeams.id, devTeamId)).limit(1)

	await writeAuditLog({
		action: "dev_team_nais_team_linked",
		entityType: "dev_team_nais_team_mapping",
		entityId: mapping.id,
		newValue: `${team?.name ?? devTeamId} ↔ ${naisTeamSlug}`,
		metadata: { devTeamId, naisTeamSlug },
		performedBy,
	})

	return mapping
}

/** Unlink a Nais team from a dev team (by Nais team slug). */
export async function unlinkNaisTeamFromDevTeam(naisTeamSlug: string, devTeamId: string, performedBy: string) {
	const [naisTeam] = await db.select().from(naisTeams).where(eq(naisTeams.slug, naisTeamSlug)).limit(1)
	if (!naisTeam) throw new Error(`Nais-team not found: ${naisTeamSlug}`)

	const [team] = await db.select({ name: devTeams.name }).from(devTeams).where(eq(devTeams.id, devTeamId)).limit(1)

	await db
		.delete(devTeamNaisTeamMappings)
		.where(and(eq(devTeamNaisTeamMappings.naisTeamId, naisTeam.id), eq(devTeamNaisTeamMappings.devTeamId, devTeamId)))

	await writeAuditLog({
		action: "dev_team_nais_team_unlinked",
		entityType: "dev_team_nais_team_mapping",
		entityId: `${devTeamId}-${naisTeamSlug}`,
		previousValue: `${team?.name ?? devTeamId} ↔ ${naisTeamSlug}`,
		metadata: { devTeamId, naisTeamSlug },
		performedBy,
	})
}

/** Get Nais teams linked to a dev team. */
export async function getNaisTeamsForDevTeam(devTeamId: string) {
	return db
		.select({
			id: naisTeams.id,
			slug: naisTeams.slug,
			displayName: naisTeams.displayName,
			appCount: naisTeams.appCount,
		})
		.from(devTeamNaisTeamMappings)
		.innerJoin(naisTeams, eq(devTeamNaisTeamMappings.naisTeamId, naisTeams.id))
		.where(eq(devTeamNaisTeamMappings.devTeamId, devTeamId))
		.orderBy(naisTeams.slug)
}
