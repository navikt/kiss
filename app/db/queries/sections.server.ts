import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import { db } from "../connection.server"
import { isUniqueViolation } from "../pg-errors.server"
import { applicationControls } from "../schema/application-controls"
import {
	applicationEnvironments,
	applicationTeamMappings,
	devTeamNaisTeamMappings,
	monitoredApplications,
	naisTeams,
	sectionIgnoredApplications,
} from "../schema/applications"
import { devTeams, sectionEnvironments, sections } from "../schema/organization"
import { routineReviews, routines } from "../schema/routines"
import { getComplianceSummaries, getRoutineComplianceSummaries } from "./application-controls.server"
import { writeAuditLog } from "./audit.server"
import { getEconomyClassifications } from "./economy-classification.server"
import { getRoutineDeadlinesWithControls } from "./routine-deadlines.server"
import { assignRole } from "./users.server"

/** Get sections. By default only active (non-archived) sections are returned. */
export async function getSections(options: { includeArchived?: boolean } = {}) {
	const query = db.select().from(sections)
	if (!options.includeArchived) {
		return query.where(isNull(sections.archivedAt)).orderBy(sections.name)
	}
	return query.orderBy(sections.name)
}

/** Get a section by slug (lightweight lookup). */
export async function getSectionBySlug(slug: string) {
	const [section] = await db.select().from(sections).where(eq(sections.slug, slug)).limit(1)
	return section ?? null
}

async function getTeamAppIds(
	teamId: string,
	sectionId: string,
	excludedEnvs?: Set<string>,
	preloadedIgnoredAppIds?: Set<string>,
) {
	// Direct mappings
	const directRows = await db
		.select({ appId: applicationTeamMappings.applicationId })
		.from(applicationTeamMappings)
		.innerJoin(monitoredApplications, eq(applicationTeamMappings.applicationId, monitoredApplications.id))
		.where(
			sql`${applicationTeamMappings.devTeamId} = ${teamId} AND ${applicationTeamMappings.archivedAt} IS NULL AND ${monitoredApplications.primaryApplicationId} IS NULL`,
		)
	const directIds = new Set(directRows.map((r) => r.appId))

	// Apps from linked Nais teams
	const linkedNaisTeamIds = (
		await db
			.select({ naisTeamId: devTeamNaisTeamMappings.naisTeamId })
			.from(devTeamNaisTeamMappings)
			.where(and(eq(devTeamNaisTeamMappings.devTeamId, teamId), isNull(devTeamNaisTeamMappings.archivedAt)))
	).map((r) => r.naisTeamId)

	const naisAppIds = new Set<string>()
	if (linkedNaisTeamIds.length > 0) {
		// Reuse preloaded ignored apps if available, otherwise query
		const ignoredAppIds =
			preloadedIgnoredAppIds ??
			new Set(
				(
					await db
						.select({ appId: sectionIgnoredApplications.applicationId })
						.from(sectionIgnoredApplications)
						.where(
							and(eq(sectionIgnoredApplications.sectionId, sectionId), isNull(sectionIgnoredApplications.archivedAt)),
						)
				).map((r) => r.appId),
			)

		const envConditions = [
			sql`${applicationEnvironments.naisTeamId} IN (${sql.join(linkedNaisTeamIds, sql`, `)})`,
			isNull(monitoredApplications.primaryApplicationId),
		]
		if (excludedEnvs && excludedEnvs.size > 0) {
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
			if (!ignoredAppIds.has(row.appId)) {
				naisAppIds.add(row.appId)
			}
		}
	}

	// Merge: direct + nais (deduplicated)
	const merged = new Set([...directIds, ...naisAppIds])

	// Filter out apps whose ONLY environments are in excluded clusters
	if (excludedEnvs && excludedEnvs.size > 0 && merged.size > 0) {
		const appEnvRows = await db
			.select({
				appId: applicationEnvironments.applicationId,
				cluster: applicationEnvironments.cluster,
			})
			.from(applicationEnvironments)
			.where(inArray(applicationEnvironments.applicationId, [...merged]))
		const appEnvMap = new Map<string, Set<string>>()
		for (const row of appEnvRows) {
			if (!appEnvMap.has(row.appId)) appEnvMap.set(row.appId, new Set())
			appEnvMap.get(row.appId)?.add(row.cluster)
		}
		for (const appId of merged) {
			const clusters = appEnvMap.get(appId)
			if (clusters && clusters.size > 0 && [...clusters].every((c) => excludedEnvs.has(c))) {
				merged.delete(appId)
			}
		}
	}

	const allIds = merged
	return { allIds, directIds, naisAppIds }
}

/** Get section detail with team compliance stats. */
export async function getSectionDetail(seksjonSlug: string) {
	const [section] = await db.select().from(sections).where(eq(sections.slug, seksjonSlug)).limit(1)
	if (!section) return null

	const teams = await db
		.select()
		.from(devTeams)
		.where(and(eq(devTeams.sectionId, section.id), isNull(devTeams.archivedAt)))
		.orderBy(devTeams.name)

	const teamIds = teams.map((t) => t.id)

	// Bulk fetch shared data in parallel — queries that don't depend on teamIds are always needed
	const sharedQueries = [
		db
			.select({ cluster: sectionEnvironments.cluster })
			.from(sectionEnvironments)
			.where(and(eq(sectionEnvironments.sectionId, section.id), eq(sectionEnvironments.included, false))),
		db
			.select({ appId: sectionIgnoredApplications.applicationId })
			.from(sectionIgnoredApplications)
			.where(and(eq(sectionIgnoredApplications.sectionId, section.id), isNull(sectionIgnoredApplications.archivedAt))),
		db.select().from(naisTeams).where(eq(naisTeams.sectionId, section.id)),
	] as const

	// Team-specific queries only when there are teams
	const teamQueries =
		teamIds.length > 0
			? ([
					db
						.select({
							devTeamId: applicationTeamMappings.devTeamId,
							appId: applicationTeamMappings.applicationId,
						})
						.from(applicationTeamMappings)
						.innerJoin(monitoredApplications, eq(applicationTeamMappings.applicationId, monitoredApplications.id))
						.where(
							and(
								inArray(applicationTeamMappings.devTeamId, teamIds),
								isNull(applicationTeamMappings.archivedAt),
								isNull(monitoredApplications.primaryApplicationId),
							),
						),
					db
						.select({
							devTeamId: devTeamNaisTeamMappings.devTeamId,
							naisTeamId: devTeamNaisTeamMappings.naisTeamId,
						})
						.from(devTeamNaisTeamMappings)
						.where(
							and(inArray(devTeamNaisTeamMappings.devTeamId, teamIds), isNull(devTeamNaisTeamMappings.archivedAt)),
						),
				] as const)
			: null

	const [excludedEnvRows, ignoredAppRows, sectionNaisTeamRows, ...teamResults] = await Promise.all([
		...sharedQueries,
		...(teamQueries ?? []),
	])

	const directMappingRows = teamQueries ? (teamResults[0] as Awaited<(typeof teamQueries)[0]>) : []
	const naisTeamMappingRows = teamQueries ? (teamResults[1] as Awaited<(typeof teamQueries)[1]>) : []

	const excludedEnvs = new Set(excludedEnvRows.map((r) => r.cluster))
	const ignoredAppIds = new Set(ignoredAppRows.map((r) => r.appId))

	// Group direct mappings by team
	const directByTeam = new Map<string, Set<string>>()
	for (const row of directMappingRows) {
		let set = directByTeam.get(row.devTeamId)
		if (!set) {
			set = new Set()
			directByTeam.set(row.devTeamId, set)
		}
		set.add(row.appId)
	}

	// Group nais-team links by dev team
	const naisTeamsByDevTeam = new Map<string, string[]>()
	const allLinkedNaisTeamIds = new Set<string>()
	for (const row of naisTeamMappingRows) {
		let arr = naisTeamsByDevTeam.get(row.devTeamId)
		if (!arr) {
			arr = []
			naisTeamsByDevTeam.set(row.devTeamId, arr)
		}
		arr.push(row.naisTeamId)
		allLinkedNaisTeamIds.add(row.naisTeamId)
	}

	// Bulk fetch nais apps for all linked nais teams
	const naisAppsByNaisTeam = new Map<string, Set<string>>()
	if (allLinkedNaisTeamIds.size > 0) {
		const envConditions = [
			inArray(applicationEnvironments.naisTeamId, [...allLinkedNaisTeamIds]),
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
			.selectDistinct({
				naisTeamId: applicationEnvironments.naisTeamId,
				appId: applicationEnvironments.applicationId,
			})
			.from(applicationEnvironments)
			.innerJoin(monitoredApplications, eq(applicationEnvironments.applicationId, monitoredApplications.id))
			.where(and(...envConditions))

		for (const row of naisAppRows) {
			if (ignoredAppIds.has(row.appId) || !row.naisTeamId) continue
			let set = naisAppsByNaisTeam.get(row.naisTeamId)
			if (!set) {
				set = new Set()
				naisAppsByNaisTeam.set(row.naisTeamId, set)
			}
			set.add(row.appId)
		}
	}

	// Build per-team app sets
	const allCandidateAppIds = new Set<string>()
	const teamAppSets = new Map<string, Set<string>>()

	for (const team of teams) {
		const merged = new Set<string>()
		const directs = directByTeam.get(team.id)
		if (directs) for (const id of directs) merged.add(id)

		const linkedNaisTeams = naisTeamsByDevTeam.get(team.id)
		if (linkedNaisTeams) {
			for (const ntId of linkedNaisTeams) {
				const apps = naisAppsByNaisTeam.get(ntId)
				if (apps) for (const id of apps) merged.add(id)
			}
		}

		teamAppSets.set(team.id, merged)
		for (const id of merged) allCandidateAppIds.add(id)
	}

	// Bulk env-filter: remove apps whose ONLY environments are excluded
	if (excludedEnvs.size > 0 && allCandidateAppIds.size > 0) {
		const appEnvRows = await db
			.select({ appId: applicationEnvironments.applicationId, cluster: applicationEnvironments.cluster })
			.from(applicationEnvironments)
			.where(inArray(applicationEnvironments.applicationId, [...allCandidateAppIds]))

		const appEnvMap = new Map<string, Set<string>>()
		for (const row of appEnvRows) {
			let set = appEnvMap.get(row.appId)
			if (!set) {
				set = new Set()
				appEnvMap.set(row.appId, set)
			}
			set.add(row.cluster)
		}

		const appsToRemove = new Set<string>()
		for (const appId of allCandidateAppIds) {
			const clusters = appEnvMap.get(appId)
			if (clusters && clusters.size > 0 && [...clusters].every((c) => excludedEnvs.has(c))) {
				appsToRemove.add(appId)
			}
		}

		if (appsToRemove.size > 0) {
			for (const [, appSet] of teamAppSets) {
				for (const appId of appSet) {
					if (appsToRemove.has(appId)) appSet.delete(appId)
				}
			}
			for (const id of appsToRemove) allCandidateAppIds.delete(id)
		}
	}

	// Build final team results
	const teamAppMaps: { team: (typeof teams)[0]; allIds: Set<string> }[] = []
	const allAssignedAppIds = new Set<string>()
	for (const team of teams) {
		const allIds = teamAppSets.get(team.id) ?? new Set()
		teamAppMaps.push({ team, allIds })
		for (const id of allIds) allAssignedAppIds.add(id)
	}

	// Collect unassigned app IDs (from section nais teams, not assigned to any dev team)
	const sectionNaisTeamIds = sectionNaisTeamRows.map((t) => t.id)
	let unassignedAppIds: string[] = []

	if (sectionNaisTeamIds.length > 0) {
		const envConditions = [
			sql`${applicationEnvironments.naisTeamId} IN (${sql.join(sectionNaisTeamIds, sql`, `)})`,
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

		unassignedAppIds = naisAppRows
			.map((r) => r.appId)
			.filter((id) => !allAssignedAppIds.has(id) && !ignoredAppIds.has(id))
	}

	// Batch-fetch compliance summaries for ALL apps in a single SQL query
	const allAppIds = [...allAssignedAppIds, ...unassignedAppIds.filter((id) => !allAssignedAppIds.has(id))]
	const summaryMap = await getComplianceSummaries(allAppIds)

	// Build team stats from the pre-fetched map
	const teamStats = teamAppMaps.map(({ team, allIds }) => {
		let implemented = 0
		let partial = 0
		let notImplemented = 0
		let notRelevant = 0
		let total = 0

		for (const appId of allIds) {
			const s = summaryMap.get(appId) ?? { implemented: 0, partial: 0, notImplemented: 0, notRelevant: 0, total: 0 }
			implemented += s.implemented
			partial += s.partial
			notImplemented += s.notImplemented
			notRelevant += s.notRelevant
			total += s.total
		}

		return {
			slug: team.slug,
			name: team.name,
			apps: allIds.size,
			implemented,
			partial,
			notImplemented,
			notRelevant,
			total,
		}
	})

	// Build unassigned stats
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
		let uTotal = 0

		for (const appId of unassignedAppIds) {
			const s = summaryMap.get(appId) ?? { implemented: 0, partial: 0, notImplemented: 0, notRelevant: 0, total: 0 }
			uImpl += s.implemented
			uPartial += s.partial
			uNotImpl += s.notImplemented
			uNotRel += s.notRelevant
			uTotal += s.total
		}

		unassignedStats = {
			apps: unassignedAppIds.length,
			implemented: uImpl,
			partial: uPartial,
			notImplemented: uNotImpl,
			notRelevant: uNotRel,
			total: uTotal,
		}

		for (const id of unassignedAppIds) {
			allAssignedAppIds.add(id)
		}
	}

	// Compute deduplicated section-level totals (apps shared across teams counted once)
	let sectionImplemented = 0
	let sectionPartial = 0
	let sectionNotImplemented = 0
	let sectionNotRelevant = 0
	let sectionTotal = 0
	for (const appId of allAppIds) {
		const s = summaryMap.get(appId) ?? { implemented: 0, partial: 0, notImplemented: 0, notRelevant: 0, total: 0 }
		sectionImplemented += s.implemented
		sectionPartial += s.partial
		sectionNotImplemented += s.notImplemented
		sectionNotRelevant += s.notRelevant
		sectionTotal += s.total
	}

	const sectionTotals = {
		apps: allAppIds.length,
		implemented: sectionImplemented,
		partial: sectionPartial,
		notImplemented: sectionNotImplemented,
		notRelevant: sectionNotRelevant,
		total: sectionTotal,
	}

	return { section, teams: teamStats, unassignedStats, allAppIds, sectionTotals }
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

export interface PersonRef {
	navIdent: string
	displayName: string
}

export type CreateSectionResult =
	| { conflict: false; section: typeof sections.$inferSelect }
	| { conflict: true; field: "slug" }

/**
 * Oppretter en seksjon med seksjonsleder og teknologileder i én atomisk
 * transaksjon. Graph API-oppslag skal gjøres FØR kallet — navIdent og
 * displayName sendes inn ferdig resolved.
 *
 * Slug-kollisjon (postgres unique violation 23505) fanges og returneres som
 * { conflict: true, field: "slug" } slik at action kan gi brukervennlig
 * feilmelding uten at transaksjonen bobler opp som en ukategorisert 500-feil.
 */
export async function createSection(params: {
	name: string
	description: string | null
	sectionLeader: PersonRef
	techLead: PersonRef
	createdBy: string
}): Promise<CreateSectionResult> {
	const { name, description, sectionLeader, techLead, createdBy } = params
	const slug = generateSlug(name)

	try {
		const section = await db.transaction(async (tx) => {
			const [section] = await tx
				.insert(sections)
				.values({ name, slug, description, createdBy, updatedBy: createdBy })
				.returning()

			await writeAuditLog(
				{
					action: "section_created",
					entityType: "section",
					entityId: section.id,
					newValue: name,
					metadata: { slug, description },
					performedBy: createdBy,
				},
				tx,
			)

			await assignRole(
				sectionLeader.navIdent,
				sectionLeader.displayName,
				"section_manager",
				createdBy,
				section.id,
				undefined,
				tx,
			)
			await assignRole(techLead.navIdent, techLead.displayName, "tech_manager", createdBy, section.id, undefined, tx)

			return section
		})

		return { conflict: false, section }
	} catch (err) {
		// Postgres unique_violation on sections.slug
		if (isUniqueViolation(err)) {
			return { conflict: true, field: "slug" }
		}
		throw err
	}
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

/**
 * Arkiverer en seksjon (soft-delete). Seksjonen blir skjult fra brukervendte
 * lister, men beholder all data og historikk. FK-er til seksjonen forblir
 * gyldige (alle FK-er er nå ON DELETE RESTRICT, så hard delete er umulig).
 *
 * UPDATE er guarded mot `archived_at IS NULL` og audit-loggen skrives kun
 * dersom UPDATE faktisk endret en rad. Dette gjør operasjonen idempotent og
 * trygg under samtidige kall (TOCTOU-sikker uten å trenge SELECT FOR UPDATE).
 * UPDATE og audit-skriving kjører i samme transaksjon (AGENTS.md regel 6).
 */
export async function archiveSection(id: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [section] = await tx
			.update(sections)
			.set({ archivedAt: new Date(), archivedBy: performedBy, updatedBy: performedBy, updatedAt: new Date() })
			.where(and(eq(sections.id, id), isNull(sections.archivedAt)))
			.returning()
		if (!section) {
			const [existing] = await tx.select().from(sections).where(eq(sections.id, id)).limit(1)
			if (!existing) throw new Error(`Seksjon med id ${id} finnes ikke`)
			return existing
		}
		await writeAuditLog(
			{
				action: "section_archived",
				entityType: "section",
				entityId: id,
				previousValue: section.name,
				newValue: section.name,
				metadata: { slug: section.slug },
				performedBy,
			},
			tx,
		)
		return section
	})
}

/**
 * Reaktiverer en arkivert seksjon. Guarded UPDATE + atomisk audit-skriving,
 * samme TOCTOU-sikre mønster som archiveSection.
 */
export async function unarchiveSection(id: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [section] = await tx
			.update(sections)
			.set({ archivedAt: null, archivedBy: null, updatedBy: performedBy, updatedAt: new Date() })
			.where(and(eq(sections.id, id), isNotNull(sections.archivedAt)))
			.returning()
		if (!section) {
			const [existing] = await tx.select().from(sections).where(eq(sections.id, id)).limit(1)
			if (!existing) throw new Error(`Seksjon med id ${id} finnes ikke`)
			return existing
		}
		await writeAuditLog(
			{
				action: "section_unarchived",
				entityType: "section",
				entityId: id,
				previousValue: section.name,
				newValue: section.name,
				metadata: { slug: section.slug },
				performedBy,
			},
			tx,
		)
		return section
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
	if (!prev) throw new Error(`Team ikke funnet: ${id}`)
	if (prev.archivedAt) throw new Error("Kan ikke oppdatere arkivert team. Reaktiver teamet først.")
	const slug = generateSlug(name)
	const [team] = await db
		.update(devTeams)
		.set({ name, slug, description, updatedBy, updatedAt: new Date() })
		.where(and(eq(devTeams.id, id), isNull(devTeams.archivedAt)))
		.returning()
	if (!team) throw new Error("Kan ikke oppdatere arkivert team. Reaktiver teamet først.")
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

/**
 * Arkiverer et dev-team (soft-delete). Teamet skjules fra brukervendte
 * lister, men beholder all data og historikk. FK-er fra naisTeams,
 * applicationTeamMappings, userRoles og devTeamNaisTeamMappings forblir
 * gyldige (alle FK-er er ON DELETE RESTRICT, så hard delete er umulig).
 *
 * UPDATE er guarded mot `archived_at IS NULL` og audit-loggen skrives kun
 * dersom UPDATE faktisk endret en rad. Idempotent og TOCTOU-sikker uten
 * å trenge SELECT FOR UPDATE. UPDATE og audit-skriving kjører i samme
 * transaksjon (AGENTS.md regel 6).
 */
export async function archiveTeam(id: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [team] = await tx
			.update(devTeams)
			.set({ archivedAt: new Date(), archivedBy: performedBy, updatedBy: performedBy, updatedAt: new Date() })
			.where(and(eq(devTeams.id, id), isNull(devTeams.archivedAt)))
			.returning()
		if (!team) {
			const [existing] = await tx.select().from(devTeams).where(eq(devTeams.id, id)).limit(1)
			if (!existing) throw new Error(`Dev-team med id ${id} finnes ikke`)
			return existing
		}
		await writeAuditLog(
			{
				action: "team_archived",
				entityType: "team",
				entityId: id,
				previousValue: team.name,
				newValue: team.name,
				metadata: { sectionId: team.sectionId, slug: team.slug },
				performedBy,
			},
			tx,
		)
		return team
	})
}

/**
 * Reaktiverer et arkivert dev-team. Guarded UPDATE + atomisk audit-skriving,
 * samme TOCTOU-sikre mønster som archiveTeam.
 */
export async function unarchiveTeam(id: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [team] = await tx
			.update(devTeams)
			.set({ archivedAt: null, archivedBy: null, updatedBy: performedBy, updatedAt: new Date() })
			.where(and(eq(devTeams.id, id), isNotNull(devTeams.archivedAt)))
			.returning()
		if (!team) {
			const [existing] = await tx.select().from(devTeams).where(eq(devTeams.id, id)).limit(1)
			if (!existing) throw new Error(`Dev-team med id ${id} finnes ikke`)
			return existing
		}
		await writeAuditLog(
			{
				action: "team_unarchived",
				entityType: "team",
				entityId: id,
				previousValue: team.name,
				newValue: team.name,
				metadata: { sectionId: team.sectionId, slug: team.slug },
				performedBy,
			},
			tx,
		)
		return team
	})
}

/** Get all teams for a section, ordered by name. */
/** Get all teams for a section with linked Nais team counts. */
export async function getTeamsForSection(sectionId: string, options: { includeArchived?: boolean } = {}) {
	const baseCondition = options.includeArchived
		? eq(devTeams.sectionId, sectionId)
		: and(eq(devTeams.sectionId, sectionId), isNull(devTeams.archivedAt))
	const teams = await db.select().from(devTeams).where(baseCondition).orderBy(devTeams.name)

	if (teams.length === 0) return []

	const teamIds = teams.map((t) => t.id)
	const allNaisLinks = await db
		.select({
			devTeamId: devTeamNaisTeamMappings.devTeamId,
			slug: naisTeams.slug,
		})
		.from(devTeamNaisTeamMappings)
		.innerJoin(naisTeams, eq(devTeamNaisTeamMappings.naisTeamId, naisTeams.id))
		.where(and(inArray(devTeamNaisTeamMappings.devTeamId, teamIds), isNull(devTeamNaisTeamMappings.archivedAt)))

	const naisLinksByTeam = new Map<string, (typeof allNaisLinks)[number][]>()
	for (const l of allNaisLinks) {
		const arr = naisLinksByTeam.get(l.devTeamId) ?? []
		arr.push(l)
		naisLinksByTeam.set(l.devTeamId, arr)
	}

	return teams.map((team) => ({
		...team,
		linkedNaisTeams: (naisLinksByTeam.get(team.id) ?? []).map((n) => n.slug),
	}))
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

	const excludedEnvRows = await db
		.select({ cluster: sectionEnvironments.cluster })
		.from(sectionEnvironments)
		.where(and(eq(sectionEnvironments.sectionId, team.sectionId), eq(sectionEnvironments.included, false)))
	const excludedEnvs = new Set(excludedEnvRows.map((r) => r.cluster))

	const { allIds, directIds } = await getTeamAppIds(team.id, team.sectionId, excludedEnvs)

	const appIdList = [...allIds]
	const appRows =
		appIdList.length > 0
			? await db
					.select()
					.from(monitoredApplications)
					.where(and(inArray(monitoredApplications.id, appIdList), isNull(monitoredApplications.archivedAt)))
			: []
	const appById = new Map(appRows.map((a) => [a.id, a]))
	const activeAppIds = appRows.map((a) => a.id)
	const [summaryMap, routineMap, economyMap] = await Promise.all([
		getComplianceSummaries(activeAppIds),
		getRoutineComplianceSummaries(activeAppIds),
		getEconomyClassifications(activeAppIds),
	])

	const apps = appIdList
		.map((appId) => {
			const app = appById.get(appId)
			if (!app) return null
			const s = summaryMap.get(appId) ?? { implemented: 0, partial: 0, notImplemented: 0, notRelevant: 0, total: 0 }
			const r = routineMap.get(appId) ?? {
				routinesGjennomfort: 0,
				routinesIkkeGjennomfort: 0,
				routinesMaaFolgesOpp: 0,
				routinesTotal: 0,
			}
			return {
				appId: app.id,
				appName: app.name,
				implemented: s.implemented,
				partial: s.partial,
				notImplemented: s.notImplemented,
				notRelevant: s.notRelevant,
				total: s.total,
				source: directIds.has(appId) ? ("direct" as const) : ("nais-team" as const),
				routineCompliance: r,
				isEconomySystem: economyMap.get(appId)?.isEconomySystem ?? null,
				economySystemType: economyMap.get(appId)?.economySystemType ?? null,
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

	// Load excluded environments per section (teams may belong to different sections)
	const sectionIds = [...new Set(teamRows.map((t) => t.sectionId))]
	const excludedEnvsBySection = new Map<string, Set<string>>()
	if (sectionIds.length > 0) {
		const rows = await db
			.select({ sectionId: sectionEnvironments.sectionId, cluster: sectionEnvironments.cluster })
			.from(sectionEnvironments)
			.where(and(inArray(sectionEnvironments.sectionId, sectionIds), eq(sectionEnvironments.included, false)))
		for (const row of rows) {
			if (!excludedEnvsBySection.has(row.sectionId)) excludedEnvsBySection.set(row.sectionId, new Set())
			excludedEnvsBySection.get(row.sectionId)?.add(row.cluster)
		}
	}

	// Collect app IDs from all teams, tracking which team each belongs to
	const appToTeams = new Map<string, Set<string>>()
	const appSources = new Map<string, "direct" | "nais-team">()

	for (const team of teamRows) {
		const excludedEnvs = excludedEnvsBySection.get(team.sectionId)
		const { allIds, directIds } = await getTeamAppIds(team.id, team.sectionId, excludedEnvs)
		for (const appId of allIds) {
			if (!appToTeams.has(appId)) appToTeams.set(appId, new Set())
			appToTeams.get(appId)?.add(team.id)
			if (directIds.has(appId)) appSources.set(appId, "direct")
			else if (!appSources.has(appId)) appSources.set(appId, "nais-team")
		}
	}

	const allAppIds = [...appToTeams.keys()]
	const appRows =
		allAppIds.length > 0
			? await db
					.select()
					.from(monitoredApplications)
					.where(and(inArray(monitoredApplications.id, allAppIds), isNull(monitoredApplications.archivedAt)))
			: []

	const appById = new Map(appRows.map((a) => [a.id, a]))
	const activeAppIds = appRows.map((a) => a.id)
	const summaryMap = await getComplianceSummaries(activeAppIds)

	const apps = allAppIds
		.map((appId) => {
			const app = appById.get(appId)
			if (!app) return null
			const s = summaryMap.get(appId) ?? { implemented: 0, partial: 0, notImplemented: 0, notRelevant: 0, total: 0 }
			return {
				appId: app.id,
				appName: app.name,
				implemented: s.implemented,
				partial: s.partial,
				notImplemented: s.notImplemented,
				notRelevant: s.notRelevant,
				total: s.total,
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
	return db.transaction(async (tx) => {
		const [team] = await tx
			.select({ id: devTeams.id, name: devTeams.name, archivedAt: devTeams.archivedAt })
			.from(devTeams)
			.where(eq(devTeams.id, devTeamId))
			.limit(1)
			.for("share")
		if (!team) throw new Error(`Dev-team med id ${devTeamId} finnes ikke`)
		if (team.archivedAt) throw new Error(`Dev-team med id ${devTeamId} er arkivert`)

		const [naisTeam] = await tx.select().from(naisTeams).where(eq(naisTeams.slug, naisTeamSlug)).limit(1)
		if (!naisTeam) throw new Error(`Nais-team not found: ${naisTeamSlug}`)

		const inserted = await tx
			.insert(devTeamNaisTeamMappings)
			.values({ naisTeamId: naisTeam.id, devTeamId, createdBy: performedBy })
			.onConflictDoNothing({
				target: [devTeamNaisTeamMappings.devTeamId, devTeamNaisTeamMappings.naisTeamId],
				where: isNull(devTeamNaisTeamMappings.archivedAt),
			})
			.returning()
		if (inserted.length === 0) {
			// Eksisterende aktiv link — idempotent no-op, ingen audit. Hvis en
			// samtidig unlink arkiverer raden mellom INSERT og SELECT, fall
			// tilbake til concurrency-feil i stedet for stille suksess.
			const [existing] = await tx
				.select()
				.from(devTeamNaisTeamMappings)
				.where(
					and(
						eq(devTeamNaisTeamMappings.naisTeamId, naisTeam.id),
						eq(devTeamNaisTeamMappings.devTeamId, devTeamId),
						isNull(devTeamNaisTeamMappings.archivedAt),
					),
				)
				.limit(1)
			if (!existing) {
				throw new Error("Kunne ikke koble Nais-team til utviklingsteam pga. samtidig endring. Prøv igjen.")
			}
			return existing
		}
		const [mapping] = inserted

		await writeAuditLog(
			{
				action: "dev_team_nais_team_linked",
				entityType: "dev_team_nais_team_mapping",
				entityId: mapping.id,
				newValue: `${team.name} ↔ ${naisTeamSlug}`,
				metadata: { devTeamId, naisTeamSlug },
				performedBy,
			},
			tx,
		)

		return mapping
	})
}

/**
 * Unlink a Nais team from a dev team (soft-delete). Transaksjonell og
 * idempotent: audit skrives kun når en aktiv rad faktisk ble arkivert.
 */
export async function unlinkNaisTeamFromDevTeam(naisTeamSlug: string, devTeamId: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [naisTeam] = await tx.select().from(naisTeams).where(eq(naisTeams.slug, naisTeamSlug)).limit(1)
		if (!naisTeam) throw new Error(`Nais-team not found: ${naisTeamSlug}`)

		const [archived] = await tx
			.update(devTeamNaisTeamMappings)
			.set({ archivedAt: new Date(), archivedBy: performedBy })
			.where(
				and(
					eq(devTeamNaisTeamMappings.naisTeamId, naisTeam.id),
					eq(devTeamNaisTeamMappings.devTeamId, devTeamId),
					isNull(devTeamNaisTeamMappings.archivedAt),
				),
			)
			.returning({ id: devTeamNaisTeamMappings.id })

		if (!archived) return

		const [team] = await tx.select({ name: devTeams.name }).from(devTeams).where(eq(devTeams.id, devTeamId)).limit(1)

		await writeAuditLog(
			{
				action: "dev_team_nais_team_unlinked",
				entityType: "dev_team_nais_team_mapping",
				entityId: archived.id,
				previousValue: `${team?.name ?? devTeamId} ↔ ${naisTeamSlug}`,
				metadata: { devTeamId, naisTeamSlug },
				performedBy,
			},
			tx,
		)
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
		.where(and(eq(devTeamNaisTeamMappings.devTeamId, devTeamId), isNull(devTeamNaisTeamMappings.archivedAt)))
		.orderBy(naisTeams.slug)
}

/** Get all applications in a section with per-app compliance stats and team names. */
export async function getSectionApps(seksjonSlug: string) {
	const [section] = await db.select().from(sections).where(eq(sections.slug, seksjonSlug)).limit(1)
	if (!section) return null

	const teams = await db
		.select()
		.from(devTeams)
		.where(and(eq(devTeams.sectionId, section.id), isNull(devTeams.archivedAt)))
		.orderBy(devTeams.name)

	const excludedEnvRows = await db
		.select({ cluster: sectionEnvironments.cluster })
		.from(sectionEnvironments)
		.where(and(eq(sectionEnvironments.sectionId, section.id), eq(sectionEnvironments.included, false)))
	const excludedEnvs = new Set(excludedEnvRows.map((r) => r.cluster))

	// Collect app IDs per team
	const appToTeams = new Map<string, Set<string>>()
	const teamById = new Map(teams.map((t) => [t.id, t]))

	for (const team of teams) {
		const { allIds } = await getTeamAppIds(team.id, section.id, excludedEnvs)
		for (const appId of allIds) {
			if (!appToTeams.has(appId)) appToTeams.set(appId, new Set())
			appToTeams.get(appId)?.add(team.id)
		}
	}

	// Collect unassigned apps
	const allAssignedAppIds = new Set(appToTeams.keys())
	const sectionNaisTeamRows = await db.select().from(naisTeams).where(eq(naisTeams.sectionId, section.id))
	const naisTeamIds = sectionNaisTeamRows.map((t) => t.id)

	if (naisTeamIds.length > 0) {
		const envConditions = [
			sql`${applicationEnvironments.naisTeamId} IN (${sql.join(naisTeamIds, sql`, `)})`,
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

		const ignoredAppIds = new Set(
			(
				await db
					.select({ appId: sectionIgnoredApplications.applicationId })
					.from(sectionIgnoredApplications)
					.where(
						and(eq(sectionIgnoredApplications.sectionId, section.id), isNull(sectionIgnoredApplications.archivedAt)),
					)
			).map((r) => r.appId),
		)

		for (const row of naisAppRows) {
			if (!allAssignedAppIds.has(row.appId) && !ignoredAppIds.has(row.appId)) {
				if (!appToTeams.has(row.appId)) appToTeams.set(row.appId, new Set())
			}
		}
	}

	const allAppIds = [...appToTeams.keys()]
	const appRows =
		allAppIds.length > 0
			? await db
					.select()
					.from(monitoredApplications)
					.where(and(inArray(monitoredApplications.id, allAppIds), isNull(monitoredApplications.archivedAt)))
			: []

	const appById = new Map(appRows.map((a) => [a.id, a]))
	const activeAppIds = appRows.map((a) => a.id)
	const summaryMap = await getComplianceSummaries(activeAppIds)

	const apps = allAppIds
		.map((appId) => {
			const app = appById.get(appId)
			if (!app) return null
			const s = summaryMap.get(appId) ?? { implemented: 0, partial: 0, notImplemented: 0, notRelevant: 0, total: 0 }
			const teamIds = [...(appToTeams.get(appId) ?? [])]
			const teamNames = teamIds.map((id) => teamById.get(id)?.name ?? "Ukjent").sort((a, b) => a.localeCompare(b, "nb"))
			return {
				appId: app.id,
				appName: app.name,
				implemented: s.implemented,
				partial: s.partial,
				notImplemented: s.notImplemented,
				notRelevant: s.notRelevant,
				total: s.total,
				teamNames,
			}
		})
		.filter((a): a is NonNullable<typeof a> => a !== null)

	apps.sort((a, b) => a.appName.localeCompare(b.appName, "nb"))

	return { section, apps }
}

/**
 * Returns all effective app IDs in a section, applying the same filters as section UI:
 * - Excludes child apps (primaryApplicationId IS NOT NULL)
 * - Excludes section-ignored apps
 * - Excludes apps whose only environments are in excluded clusters
 * Uses getTeamAppIds for team-assigned apps + direct NAIS teams for unassigned apps.
 */
export async function getEffectiveAppIdsInSection(sectionId: string): Promise<string[]> {
	const excludedEnvRows = await db
		.select({ cluster: sectionEnvironments.cluster })
		.from(sectionEnvironments)
		.where(and(eq(sectionEnvironments.sectionId, sectionId), eq(sectionEnvironments.included, false)))
	const excludedEnvs = new Set(excludedEnvRows.map((r) => r.cluster))

	const teams = await db
		.select({ id: devTeams.id })
		.from(devTeams)
		.where(and(eq(devTeams.sectionId, sectionId), isNull(devTeams.archivedAt)))

	const allAppIds = new Set<string>()

	// Load ignored apps upfront so we can filter all resolution paths
	const ignoredAppIds = new Set(
		(
			await db
				.select({ appId: sectionIgnoredApplications.applicationId })
				.from(sectionIgnoredApplications)
				.where(and(eq(sectionIgnoredApplications.sectionId, sectionId), isNull(sectionIgnoredApplications.archivedAt)))
		).map((r) => r.appId),
	)

	// Team-assigned apps (direct + via NAIS teams, with proper filtering)
	for (const team of teams) {
		const { allIds } = await getTeamAppIds(team.id, sectionId, excludedEnvs, ignoredAppIds)
		for (const id of allIds) {
			if (!ignoredAppIds.has(id)) allAppIds.add(id)
		}
	}

	// Direct NAIS teams assigned to section (unassigned apps)
	const sectionNaisTeamRows = await db
		.select({ id: naisTeams.id })
		.from(naisTeams)
		.where(eq(naisTeams.sectionId, sectionId))
	const naisTeamIds = sectionNaisTeamRows.map((t) => t.id)

	if (naisTeamIds.length > 0) {
		const envConditions = [
			sql`${applicationEnvironments.naisTeamId} IN (${sql.join(naisTeamIds, sql`, `)})`,
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
			if (!ignoredAppIds.has(row.appId)) {
				allAppIds.add(row.appId)
			}
		}
	}

	// Filter out archived applications
	if (allAppIds.size > 0) {
		const archivedRows = await db
			.select({ id: monitoredApplications.id })
			.from(monitoredApplications)
			.where(and(inArray(monitoredApplications.id, [...allAppIds]), isNotNull(monitoredApplications.archivedAt)))
		for (const row of archivedRows) {
			allAppIds.delete(row.id)
		}
	}

	return [...allAppIds]
}

/**
 * Targeted membership check: returns true if `appId` is an effective member
 * of the given section (same filters as getEffectiveAppIdsInSection).
 * More efficient than loading the full app list when you only need to verify
 * a single app's membership.
 */
export async function isAppEffectiveInSection(appId: string, sectionId: string): Promise<boolean> {
	// Quick checks: archived or child app?
	const [app] = await db
		.select({
			id: monitoredApplications.id,
			archivedAt: monitoredApplications.archivedAt,
			primaryApplicationId: monitoredApplications.primaryApplicationId,
		})
		.from(monitoredApplications)
		.where(eq(monitoredApplications.id, appId))
		.limit(1)
	if (!app || app.archivedAt || app.primaryApplicationId) return false

	// Is app ignored in this section?
	const [ignored] = await db
		.select({ appId: sectionIgnoredApplications.applicationId })
		.from(sectionIgnoredApplications)
		.where(
			and(
				eq(sectionIgnoredApplications.sectionId, sectionId),
				eq(sectionIgnoredApplications.applicationId, appId),
				isNull(sectionIgnoredApplications.archivedAt),
			),
		)
		.limit(1)
	if (ignored) return false

	// Load excluded environments for this section
	const excludedEnvRows = await db
		.select({ cluster: sectionEnvironments.cluster })
		.from(sectionEnvironments)
		.where(and(eq(sectionEnvironments.sectionId, sectionId), eq(sectionEnvironments.included, false)))
	const excludedEnvs = new Set(excludedEnvRows.map((r) => r.cluster))

	// Check via team-assigned apps (dev_teams → application_team_mappings)
	const teamRows = await db
		.select({ teamId: devTeams.id })
		.from(devTeams)
		.where(and(eq(devTeams.sectionId, sectionId), isNull(devTeams.archivedAt)))

	for (const team of teamRows) {
		const { allIds } = await getTeamAppIds(team.teamId, sectionId, excludedEnvs)
		if (allIds.has(appId)) return true
	}

	// Check via direct NAIS teams assigned to section
	const sectionNaisTeamRows = await db
		.select({ id: naisTeams.id })
		.from(naisTeams)
		.where(eq(naisTeams.sectionId, sectionId))
	const naisTeamIds = sectionNaisTeamRows.map((t) => t.id)

	if (naisTeamIds.length > 0) {
		const envConditions = [
			sql`${applicationEnvironments.naisTeamId} IN (${sql.join(naisTeamIds, sql`, `)})`,
			eq(applicationEnvironments.applicationId, appId),
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
		const [found] = await db
			.select({ appId: applicationEnvironments.applicationId })
			.from(applicationEnvironments)
			.where(and(...envConditions))
			.limit(1)
		if (found) return true
	}

	return false
}

/**
 * Get all incomplete (ikke-gjennomførte) routine deadlines across all apps in a team.
 * A routine is incomplete if it is periodic (frequency !== null) and either overdue or never reviewed.
 * Runs getRoutineDeadlinesWithControls in bounded parallel batches (4 at a time).
 */
export async function getTeamIncompleteRoutines(teamSlug: string) {
	const [team] = await db.select().from(devTeams).where(eq(devTeams.slug, teamSlug)).limit(1)
	if (!team) return null

	const excludedEnvRows = await db
		.select({ cluster: sectionEnvironments.cluster })
		.from(sectionEnvironments)
		.where(and(eq(sectionEnvironments.sectionId, team.sectionId), eq(sectionEnvironments.included, false)))
	const excludedEnvs = new Set(excludedEnvRows.map((r) => r.cluster))

	const { allIds } = await getTeamAppIds(team.id, team.sectionId, excludedEnvs)

	const activeAppIds =
		allIds.size === 0
			? []
			: (
					await db
						.select({ id: monitoredApplications.id })
						.from(monitoredApplications)
						.where(and(inArray(monitoredApplications.id, [...allIds]), isNull(monitoredApplications.archivedAt)))
				).map((r) => r.id)

	const BATCH_SIZE = 4
	const allDeadlines: Awaited<ReturnType<typeof getRoutineDeadlinesWithControls>> = []

	for (let i = 0; i < activeAppIds.length; i += BATCH_SIZE) {
		const batch = activeAppIds.slice(i, i + BATCH_SIZE)
		const results = await Promise.all(batch.map((appId) => getRoutineDeadlinesWithControls(appId)))
		for (const deadlines of results) {
			for (const d of deadlines) {
				if (d.routine != null && d.routine.frequency !== null && (d.overdue || d.lastReviewDate === null)) {
					allDeadlines.push(d)
				}
			}
		}
	}

	return { team, deadlines: allDeadlines }
}

export interface SectionIncompleteRoutineRow {
	routineId: string
	routineName: string | null
	priority: number
	applicationId: string
	applicationName: string
	frequency: string | null
	eventFrequency: string | null
	isSectionRoutine: boolean
	lastReviewDate: Date | null
	deadline: Date | null
	overdue: boolean
	needsFollowUp: boolean
	draftReviewId: string | null
}

/**
 * Get all incomplete (ikke-gjennomførte) routine deadlines across all apps in a section.
 * Uses the application_controls compliance cache to fetch all (app, routine) pairs in bulk —
 * this runs ~3 SQL queries regardless of section size, versus the old per-app approach
 * that ran ~48 queries × number of apps.
 *
 * Trade-off: source_routine_id replacement chains are not traversed — review dates are
 * looked up directly on the current routine without following predecessor chains. This is
 * an acceptable approximation for the overview/reporting use-case of this page.
 */
export async function getSectionIncompleteRoutines(sectionId: string): Promise<SectionIncompleteRoutineRow[]> {
	const appIds = await getEffectiveAppIdsInSection(sectionId)
	if (appIds.length === 0) return []

	const appIdsIn = sql.join(
		appIds.map((id) => sql`${id}::uuid`),
		sql`, `,
	)

	type RawRow = {
		application_id: string
		application_name: string
		routine_id: string
		routine_name: string | null
		priority: number
		frequency: string | null
		event_frequency: string | null
		is_section_routine: number
		last_review_date: Date | null
		deadline: Date | null
		draft_review_id: string | null
		needs_follow_up: boolean
	}

	const result = await db.execute<RawRow>(sql`
		WITH app_routines AS (
			SELECT DISTINCT
				ac.application_id,
				ma.name AS application_name,
				t.routine_id
			FROM ${applicationControls} ac
			CROSS JOIN UNNEST(ac.matching_routine_ids) AS t(routine_id)
			JOIN ${monitoredApplications} ma
				ON ma.id = ac.application_id
				AND ma.archived_at IS NULL
			WHERE ac.application_id IN (${appIdsIn})
				AND ac.is_active = true
		),
		routine_details AS (
			SELECT
				r.id,
				r.name,
				COALESCE(r.priority, 3) AS priority,
				r.frequency,
				r.event_frequency,
				r.is_section_routine,
				COALESCE(r.approved_at, r.created_at) AS base_date
			FROM ${routines} r
			WHERE r.id IN (SELECT DISTINCT routine_id FROM app_routines)
				AND r.frequency IS NOT NULL
				AND r.archived_at IS NULL
		),
		app_last_review AS (
			SELECT DISTINCT ON (rr.application_id, rr.routine_id)
				rr.application_id,
				rr.routine_id,
				rr.reviewed_at
			FROM ${routineReviews} rr
			WHERE rr.application_id IN (${appIdsIn})
				AND rr.status IN ('completed', 'needs_follow_up')
			ORDER BY rr.application_id, rr.routine_id, rr.reviewed_at DESC NULLS LAST
		),
		section_last_review AS (
			SELECT DISTINCT ON (rr.routine_id)
				rr.routine_id,
				rr.reviewed_at
			FROM ${routineReviews} rr
			WHERE rr.application_id IS NULL
				AND rr.status IN ('completed', 'needs_follow_up')
			ORDER BY rr.routine_id, rr.reviewed_at DESC NULLS LAST
		),
		draft_reviews AS (
			SELECT DISTINCT ON (rr.routine_id, rr.application_id)
				rr.routine_id,
				rr.application_id,
				rr.id AS draft_id
			FROM ${routineReviews} rr
			WHERE rr.status = 'draft'
				AND (rr.application_id IN (${appIdsIn}) OR rr.application_id IS NULL)
			ORDER BY rr.routine_id, rr.application_id, rr.created_at DESC
		),
		follow_up_reviews AS (
			SELECT DISTINCT
				rr.routine_id,
				rr.application_id
			FROM ${routineReviews} rr
			WHERE rr.status = 'needs_follow_up'
				AND (rr.application_id IN (${appIdsIn}) OR rr.application_id IS NULL)
		),
		enriched AS (
			SELECT
				ar.application_id,
				ar.application_name,
				rd.id AS routine_id,
				rd.name AS routine_name,
				rd.priority,
				rd.frequency,
				rd.event_frequency,
				rd.is_section_routine,
				CASE
					WHEN rd.is_section_routine = 1 THEN slr.reviewed_at
					ELSE alr.reviewed_at
				END AS last_review_date,
				COALESCE(
					CASE
						WHEN rd.is_section_routine = 1 THEN slr.reviewed_at
						ELSE alr.reviewed_at
					END,
					rd.base_date
				) + CASE rd.frequency
					WHEN 'weekly'        THEN INTERVAL '7 days'
					WHEN 'monthly'       THEN INTERVAL '30 days'
					WHEN 'quarterly'     THEN INTERVAL '91 days'
					WHEN 'tertially'     THEN INTERVAL '122 days'
					WHEN 'semi_annually' THEN INTERVAL '182 days'
					WHEN 'annually'      THEN INTERVAL '365 days'
					ELSE NULL
				END AS deadline,
				CASE
					WHEN rd.is_section_routine = 1 THEN (SELECT dr.draft_id FROM draft_reviews dr WHERE dr.routine_id = rd.id AND dr.application_id IS NULL LIMIT 1)
					ELSE (SELECT dr.draft_id FROM draft_reviews dr WHERE dr.routine_id = rd.id AND dr.application_id = ar.application_id LIMIT 1)
				END AS draft_review_id,
				CASE
					WHEN rd.is_section_routine = 1 THEN EXISTS (SELECT 1 FROM follow_up_reviews fur WHERE fur.routine_id = rd.id AND fur.application_id IS NULL)
					ELSE EXISTS (SELECT 1 FROM follow_up_reviews fur WHERE fur.routine_id = rd.id AND fur.application_id = ar.application_id)
				END AS needs_follow_up
			FROM app_routines ar
			JOIN routine_details rd ON rd.id = ar.routine_id
			LEFT JOIN app_last_review alr
				ON alr.application_id = ar.application_id
				AND alr.routine_id = ar.routine_id
				AND rd.is_section_routine = 0
			LEFT JOIN section_last_review slr
				ON slr.routine_id = ar.routine_id
				AND rd.is_section_routine = 1
		)
		SELECT *
		FROM enriched
		WHERE last_review_date IS NULL OR deadline IS NULL OR deadline < NOW()
	`)

	return result.rows.map((row) => ({
		routineId: row.routine_id,
		routineName: row.routine_name,
		priority: Number(row.priority),
		applicationId: row.application_id,
		applicationName: row.application_name,
		frequency: row.frequency,
		eventFrequency: row.event_frequency,
		isSectionRoutine: row.is_section_routine === 1,
		lastReviewDate: row.last_review_date ? new Date(row.last_review_date) : null,
		deadline: row.deadline ? new Date(row.deadline) : null,
		overdue: row.deadline != null && new Date(row.deadline) < new Date(),
		needsFollowUp: Boolean(row.needs_follow_up),
		draftReviewId: row.draft_review_id ?? null,
	}))
}

/**
 * Counts distinct section routines (is_section_routine = 1) that are not completed
 * within their frequency period, given a list of application IDs in the section.
 * Section routines are reviewed once per section (application_id IS NULL),
 * not per-app — so this returns a distinct routine count, not a per-app count.
 *
 * Accepts appIds to avoid redundant DB queries (callers typically pass
 * getSectionDetail().allAppIds directly). Archived apps are filtered out
 * inside the query via a join on monitored_applications.archived_at IS NULL.
 */
export async function countSectionRoutinesIncomplete(appIds: string[]): Promise<number> {
	if (appIds.length === 0) return 0

	const appIdsIn = sql.join(
		appIds.map((id) => sql`${id}::uuid`),
		sql`, `,
	)

	const result = await db.execute<{ count: number }>(sql`
		WITH section_routines AS (
			SELECT DISTINCT t.routine_id
			FROM ${applicationControls} ac
			JOIN ${monitoredApplications} ma
				ON ma.id = ac.application_id
				AND ma.archived_at IS NULL
			CROSS JOIN UNNEST(ac.matching_routine_ids) AS t(routine_id)
			JOIN ${routines} r
				ON r.id = t.routine_id
				AND r.is_section_routine = 1
				AND r.frequency IS NOT NULL
				AND r.archived_at IS NULL
			WHERE ac.application_id IN (${appIdsIn})
				AND ac.is_active = true
		),
		last_review AS (
			SELECT DISTINCT ON (rr.routine_id)
				rr.routine_id,
				rr.reviewed_at
			FROM ${routineReviews} rr
			WHERE rr.application_id IS NULL
				AND rr.status IN ('completed', 'needs_follow_up')
			ORDER BY rr.routine_id, rr.reviewed_at DESC NULLS LAST
		),
		routine_status AS (
			SELECT
				sr.routine_id,
				lr.reviewed_at AS last_review_date,
				COALESCE(lr.reviewed_at, COALESCE(r.approved_at, r.created_at)) + CASE r.frequency
					WHEN 'weekly'        THEN INTERVAL '7 days'
					WHEN 'monthly'       THEN INTERVAL '30 days'
					WHEN 'quarterly'     THEN INTERVAL '91 days'
					WHEN 'tertially'     THEN INTERVAL '122 days'
					WHEN 'semi_annually' THEN INTERVAL '182 days'
					WHEN 'annually'      THEN INTERVAL '365 days'
					ELSE NULL
				END AS deadline
			FROM section_routines sr
			JOIN ${routines} r ON r.id = sr.routine_id
			LEFT JOIN last_review lr ON lr.routine_id = sr.routine_id
		)
		SELECT COUNT(*)::int AS count
		FROM routine_status
		WHERE last_review_date IS NULL OR deadline IS NULL OR deadline < NOW()
	`)

	return result.rows[0]?.count ?? 0
}

/**
 * in the given section that are responsible for each app. Covers all three mapping paths:
 * 1. Direct applicationTeamMappings (appId → devTeamId)
 * 2. Via devTeamNaisTeamMappings join table (appId → naisTeamId → devTeamId)
 * 3. Via naisTeams.devTeamId direct FK (appId → naisTeamId → devTeams)
 */
export async function getTeamNamesForApps(appIds: string[], sectionId: string): Promise<Map<string, string[]>> {
	if (appIds.length === 0) return new Map()

	const [directRows, naisMappingRows, naisDirectRows] = await Promise.all([
		// Path 1: application → applicationTeamMappings → devTeam (filtered to section)
		db
			.selectDistinct({ appId: applicationTeamMappings.applicationId, teamName: devTeams.name })
			.from(applicationTeamMappings)
			.innerJoin(devTeams, eq(applicationTeamMappings.devTeamId, devTeams.id))
			.where(
				and(
					inArray(applicationTeamMappings.applicationId, appIds),
					eq(devTeams.sectionId, sectionId),
					isNull(applicationTeamMappings.archivedAt),
					isNull(devTeams.archivedAt),
				),
			),
		// Path 2: application → applicationEnvironments → devTeamNaisTeamMappings join table → devTeam
		db
			.selectDistinct({ appId: applicationEnvironments.applicationId, teamName: devTeams.name })
			.from(applicationEnvironments)
			.innerJoin(devTeamNaisTeamMappings, eq(applicationEnvironments.naisTeamId, devTeamNaisTeamMappings.naisTeamId))
			.innerJoin(devTeams, eq(devTeamNaisTeamMappings.devTeamId, devTeams.id))
			.where(
				and(
					inArray(applicationEnvironments.applicationId, appIds),
					eq(devTeams.sectionId, sectionId),
					isNull(devTeamNaisTeamMappings.archivedAt),
					isNull(devTeams.archivedAt),
				),
			),
		// Path 3: application → applicationEnvironments → naisTeams.devTeamId direct FK → devTeam
		db
			.selectDistinct({ appId: applicationEnvironments.applicationId, teamName: devTeams.name })
			.from(applicationEnvironments)
			.innerJoin(naisTeams, eq(applicationEnvironments.naisTeamId, naisTeams.id))
			.innerJoin(devTeams, eq(naisTeams.devTeamId, devTeams.id))
			.where(
				and(
					inArray(applicationEnvironments.applicationId, appIds),
					eq(devTeams.sectionId, sectionId),
					isNull(devTeams.archivedAt),
				),
			),
	])

	const result = new Map<string, Set<string>>()
	for (const appId of appIds) result.set(appId, new Set())

	for (const row of [...directRows, ...naisMappingRows, ...naisDirectRows]) {
		result.get(row.appId)?.add(row.teamName)
	}

	return new Map([...result.entries()].map(([k, v]) => [k, [...v].sort((a, b) => a.localeCompare(b, "nb"))]))
}
