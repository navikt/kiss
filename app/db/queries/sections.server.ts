import { and, count, eq, isNull, sql } from "drizzle-orm"
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

/** Get compliance assessment counts for a single application. */
async function getAppComplianceStats(appId: string) {
	const [implRow] = await db
		.select({ count: count() })
		.from(complianceAssessments)
		.where(sql`${complianceAssessments.applicationId} = ${appId} AND ${complianceAssessments.status} = 'implemented'`)
	const [partialRow] = await db
		.select({ count: count() })
		.from(complianceAssessments)
		.where(
			sql`${complianceAssessments.applicationId} = ${appId} AND ${complianceAssessments.status} = 'partially_implemented'`,
		)
	const [notImplRow] = await db
		.select({ count: count() })
		.from(complianceAssessments)
		.where(
			sql`${complianceAssessments.applicationId} = ${appId} AND ${complianceAssessments.status} = 'not_implemented'`,
		)
	const [notRelRow] = await db
		.select({ count: count() })
		.from(complianceAssessments)
		.where(sql`${complianceAssessments.applicationId} = ${appId} AND ${complianceAssessments.status} = 'not_relevant'`)
	return {
		implemented: implRow?.count ?? 0,
		partial: partialRow?.count ?? 0,
		notImplemented: notImplRow?.count ?? 0,
		notRelevant: notRelRow?.count ?? 0,
	}
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

	// Collect all app IDs assigned to any dev team (for unassigned calculation)
	const allAssignedAppIds = new Set<string>()

	const teamStats = []
	for (const team of teams) {
		const { allIds } = await getTeamAppIds(team.id, section.id)

		let implemented = 0
		let partial = 0
		let notImplemented = 0
		let notRelevant = 0

		for (const appId of allIds) {
			allAssignedAppIds.add(appId)
			const stats = await getAppComplianceStats(appId)
			implemented += stats.implemented
			partial += stats.partial
			notImplemented += stats.notImplemented
			notRelevant += stats.notRelevant
		}

		teamStats.push({
			slug: team.slug,
			name: team.name,
			apps: allIds.size,
			implemented,
			partial,
			notImplemented,
			notRelevant,
			total: totalControls * allIds.size,
		})
	}

	// Get compliance stats for unassigned apps (from Nais teams, not assigned to any dev team, not ignored, primary only)
	const sectionNaisTeamRows = await db.select().from(naisTeams).where(eq(naisTeams.sectionId, section.id))
	const naisTeamIds = sectionNaisTeamRows.map((t) => t.id)

	let unassignedStats = {
		apps: 0,
		implemented: 0,
		partial: 0,
		notImplemented: 0,
		notRelevant: 0,
		total: 0,
	}

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

		const unassignedAppIds = naisAppRows
			.map((r) => r.appId)
			.filter((id) => !allAssignedAppIds.has(id) && !ignoredAppIds.has(id))

		let uImpl = 0
		let uPartial = 0
		let uNotImpl = 0
		let uNotRel = 0

		for (const appId of unassignedAppIds) {
			const stats = await getAppComplianceStats(appId)
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

		// Add unassigned app IDs to the full set
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

	const apps = []
	for (const appId of allIds) {
		const [app] = await db.select().from(monitoredApplications).where(eq(monitoredApplications.id, appId))
		if (!app) continue

		const stats = await getAppComplianceStats(appId)
		apps.push({
			appId: app.id,
			appName: app.name,
			implemented: stats.implemented,
			partial: stats.partial,
			notImplemented: stats.notImplemented,
			total: totalControls,
			source: directIds.has(appId) ? ("direct" as const) : ("nais-team" as const),
		})
	}

	apps.sort((a, b) => a.appName.localeCompare(b.appName, "nb"))

	return { team, apps }
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
