import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import { db } from "../connection.server"
import { applicationControls } from "../schema/application-controls"
import {
	applicationEnvironments,
	applicationTeamMappings,
	devTeamNaisTeamMappings,
	monitoredApplications,
	naisTeams,
	sectionIgnoredApplications,
} from "../schema/applications"
import { applicationTechnologyElements, controlTechnologyElements, frameworkControls } from "../schema/framework"
import { devTeams, sectionEnvironments, sections } from "../schema/organization"
import { writeAuditLog } from "./audit.server"

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

type ComplianceStats = { implemented: number; partial: number; notImplemented: number; notRelevant: number }

/**
 * Get compliance stats per app from the materialized application_controls table.
 * Reads from application_controls (populated by syncApplicationControls).
 * Falls back gracefully to zeros if no data has been synced yet.
 */
async function getBatchComplianceStats(appIds: string[]): Promise<Map<string, ComplianceStats>> {
	const result = new Map<string, ComplianceStats>()
	if (appIds.length === 0) return result

	for (const id of appIds) {
		result.set(id, { implemented: 0, partial: 0, notImplemented: 0, notRelevant: 0 })
	}

	const rows = await db
		.select({
			applicationId: applicationControls.applicationId,
			status: applicationControls.status,
			cnt: sql<number>`count(*)::int`,
		})
		.from(applicationControls)
		.where(and(inArray(applicationControls.applicationId, appIds), eq(applicationControls.isActive, true)))
		.groupBy(applicationControls.applicationId, applicationControls.status)

	for (const row of rows) {
		const stats = result.get(row.applicationId)
		if (!stats) continue
		switch (row.status) {
			case "implemented":
				stats.implemented += row.cnt
				break
			case "partially_implemented":
				stats.partial += row.cnt
				break
			case "not_implemented":
				stats.notImplemented += row.cnt
				break
			case "not_relevant":
				stats.notRelevant += row.cnt
				break
		}
	}

	return result
}

/**
 * Compute the expected total number of assessment items per app.
 * Counts all active controls (screening does not reduce the total — unscreened controls are "ikke vurdert").
 * For each control, count matching (control-element ∩ app-element) pairs.
 * Controls with no element mappings count as 1.
 */
async function getBatchExpectedTotals(appIds: string[]): Promise<Map<string, number>> {
	const result = new Map<string, number>()
	if (appIds.length === 0) return result
	for (const id of appIds) result.set(id, 0)

	// Active controls
	const controls = await db
		.select({ id: frameworkControls.id })
		.from(frameworkControls)
		.where(isNull(frameworkControls.archivedAt))

	// Control → element mappings
	const ctrlElRows = await db
		.select({ controlId: controlTechnologyElements.controlId, elementId: controlTechnologyElements.elementId })
		.from(controlTechnologyElements)
		.where(isNull(controlTechnologyElements.archivedAt))
	const elementsByControl = new Map<string, Set<string>>()
	for (const ce of ctrlElRows) {
		let s = elementsByControl.get(ce.controlId)
		if (!s) {
			s = new Set()
			elementsByControl.set(ce.controlId, s)
		}
		s.add(ce.elementId)
	}

	// App → confirmed element IDs
	const appElRows = await db
		.select({
			applicationId: applicationTechnologyElements.applicationId,
			elementId: applicationTechnologyElements.elementId,
		})
		.from(applicationTechnologyElements)
		.where(
			and(
				inArray(applicationTechnologyElements.applicationId, appIds),
				isNull(applicationTechnologyElements.archivedAt),
				isNotNull(applicationTechnologyElements.confirmedAt),
				isNull(applicationTechnologyElements.rejectedAt),
			),
		)
	const elementsByApp = new Map<string, Set<string>>()
	for (const ae of appElRows) {
		let s = elementsByApp.get(ae.applicationId)
		if (!s) {
			s = new Set()
			elementsByApp.set(ae.applicationId, s)
		}
		s.add(ae.elementId)
	}

	for (const appId of appIds) {
		const appElements = elementsByApp.get(appId) ?? new Set<string>()
		const applicableControls = controls

		let total = 0
		for (const ctrl of applicableControls) {
			const ctrlElements = elementsByControl.get(ctrl.id)
			if (!ctrlElements || ctrlElements.size === 0) {
				total += 1
			} else if (appElements.size === 0) {
				// App has no confirmed elements — count all controls as 1
				total += 1
			} else {
				let matches = 0
				for (const eid of ctrlElements) {
					if (appElements.has(eid)) matches++
				}
				total += matches
			}
		}
		result.set(appId, total)
	}

	return result
}

async function getTeamAppIds(teamId: string, sectionId: string, excludedEnvs?: Set<string>) {
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
		const ignoredAppIds = new Set(
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

	// Load excluded environments for this section
	const excludedEnvRows = await db
		.select({ cluster: sectionEnvironments.cluster })
		.from(sectionEnvironments)
		.where(and(eq(sectionEnvironments.sectionId, section.id), eq(sectionEnvironments.included, false)))
	const excludedEnvs = new Set(excludedEnvRows.map((r) => r.cluster))

	// Phase 1: Collect all app IDs per team
	const teamAppMaps: { team: (typeof teams)[0]; allIds: Set<string> }[] = []
	const allAssignedAppIds = new Set<string>()

	for (const team of teams) {
		const { allIds } = await getTeamAppIds(team.id, section.id, excludedEnvs)
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

		unassignedAppIds = naisAppRows
			.map((r) => r.appId)
			.filter((id) => !allAssignedAppIds.has(id) && !ignoredAppIds.has(id))
	}

	// Phase 3: Batch-fetch compliance stats and expected totals for ALL apps (sequential to limit connections)
	const allAppIds = [...allAssignedAppIds, ...unassignedAppIds.filter((id) => !allAssignedAppIds.has(id))]
	const statsMap = await getBatchComplianceStats(allAppIds)
	const totalsMap = await getBatchExpectedTotals(allAppIds)

	// Phase 4: Build team stats from the pre-fetched map
	const teamStats = teamAppMaps.map(({ team, allIds }) => {
		let implemented = 0
		let partial = 0
		let notImplemented = 0
		let notRelevant = 0
		let total = 0

		for (const appId of allIds) {
			const stats = statsMap.get(appId) ?? { implemented: 0, partial: 0, notImplemented: 0, notRelevant: 0 }
			implemented += stats.implemented
			partial += stats.partial
			notImplemented += stats.notImplemented
			notRelevant += stats.notRelevant
			total += totalsMap.get(appId) ?? 0
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
		let uTotal = 0

		for (const appId of unassignedAppIds) {
			const stats = statsMap.get(appId) ?? { implemented: 0, partial: 0, notImplemented: 0, notRelevant: 0 }
			uImpl += stats.implemented
			uPartial += stats.partial
			uNotImpl += stats.notImplemented
			uNotRel += stats.notRelevant
			uTotal += totalsMap.get(appId) ?? 0
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

	// Phase 6: Compute deduplicated section-level totals (apps shared across teams counted once)
	let sectionImplemented = 0
	let sectionPartial = 0
	let sectionNotImplemented = 0
	let sectionNotRelevant = 0
	let sectionTotal = 0
	for (const appId of allAppIds) {
		const stats = statsMap.get(appId) ?? { implemented: 0, partial: 0, notImplemented: 0, notRelevant: 0 }
		sectionImplemented += stats.implemented
		sectionPartial += stats.partial
		sectionNotImplemented += stats.notImplemented
		sectionNotRelevant += stats.notRelevant
		sectionTotal += totalsMap.get(appId) ?? 0
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
	const teamsWithNais = await Promise.all(
		teams.map(async (team) => {
			const naisLinks = await db
				.select({ slug: naisTeams.slug })
				.from(devTeamNaisTeamMappings)
				.innerJoin(naisTeams, eq(devTeamNaisTeamMappings.naisTeamId, naisTeams.id))
				.where(and(eq(devTeamNaisTeamMappings.devTeamId, team.id), isNull(devTeamNaisTeamMappings.archivedAt)))
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
	const statsMap = await getBatchComplianceStats(activeAppIds)
	const totalsMap = await getBatchExpectedTotals(activeAppIds)

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
				notRelevant: stats.notRelevant,
				total: totalsMap.get(appId) ?? 0,
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
	const statsMap = await getBatchComplianceStats(activeAppIds)
	const totalsMap = await getBatchExpectedTotals(activeAppIds)

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
				notRelevant: stats.notRelevant,
				total: totalsMap.get(appId) ?? 0,
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
	const statsMap = await getBatchComplianceStats(activeAppIds)
	const totalsMap = await getBatchExpectedTotals(activeAppIds)

	const apps = allAppIds
		.map((appId) => {
			const app = appById.get(appId)
			if (!app) return null
			const stats = statsMap.get(appId) ?? { implemented: 0, partial: 0, notImplemented: 0, notRelevant: 0 }
			const teamIds = [...(appToTeams.get(appId) ?? [])]
			const teamNames = teamIds.map((id) => teamById.get(id)?.name ?? "Ukjent").sort((a, b) => a.localeCompare(b, "nb"))
			return {
				appId: app.id,
				appName: app.name,
				implemented: stats.implemented,
				partial: stats.partial,
				notImplemented: stats.notImplemented,
				notRelevant: stats.notRelevant,
				total: totalsMap.get(appId) ?? 0,
				teamNames,
			}
		})
		.filter((a): a is NonNullable<typeof a> => a !== null)

	apps.sort((a, b) => a.appName.localeCompare(b.appName, "nb"))

	return { section, apps }
}
