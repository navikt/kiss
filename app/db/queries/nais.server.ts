import { and, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm"
import { logger } from "~/lib/logger.server"
import { db } from "../connection.server"
import {
	type AuthIntegrationType,
	accessPolicyAcknowledgments,
	applicationAccessPolicyRules,
	applicationAuthIntegrations,
	applicationEnvironments,
	applicationGroupAssessments,
	applicationManualGroups,
	applicationPersistence,
	applicationTeamMappings,
	type DataClassification,
	devTeamNaisTeamMappings,
	entraGroupClassifications,
	type GroupAccessClassification,
	type GroupCriticality,
	type LinkSuggestionMatchType,
	type LinkSuggestionStatus,
	linkSuggestions,
	monitoredApplications,
	naisDiscoveredApps,
	naisTeams,
	type PersistenceType,
	sectionIgnoredApplications,
} from "../schema/applications"
import { auditLog } from "../schema/audit"
import { devTeams, sectionEnvironments, sections } from "../schema/organization"
import { writeAuditLog } from "./audit.server"

const SYNC_PERFORMER = "nais-sync"

/** Get all Nais teams. */
export async function getNaisTeams() {
	return db.select().from(naisTeams).orderBy(naisTeams.slug)
}

/** Get a single Nais team by slug with its apps, environments, and persistence. */
export async function getNaisTeamDetail(slug: string) {
	const [team] = await db.select().from(naisTeams).where(eq(naisTeams.slug, slug)).limit(1)
	if (!team) return null

	// Get section info if linked
	let sectionName: string | null = null
	let sectionSlug: string | null = null
	if (team.sectionId) {
		const [section] = await db.select().from(sections).where(eq(sections.id, team.sectionId)).limit(1)
		sectionName = section?.name ?? null
		sectionSlug = section?.slug ?? null
	}

	// Get apps for this team via applicationEnvironments (excludes linked/child apps)
	const envRows = await db
		.select({
			appId: applicationEnvironments.applicationId,
			appName: monitoredApplications.name,
			cluster: applicationEnvironments.cluster,
			namespace: applicationEnvironments.namespace,
			discoveredAt: applicationEnvironments.discoveredAt,
		})
		.from(applicationEnvironments)
		.innerJoin(monitoredApplications, eq(applicationEnvironments.applicationId, monitoredApplications.id))
		.where(and(eq(applicationEnvironments.naisTeamId, team.id), isNull(monitoredApplications.primaryApplicationId)))
		.orderBy(monitoredApplications.name, applicationEnvironments.cluster)

	// Group by app, collect environments
	const appMap = new Map<
		string,
		{ appId: string; appName: string; environments: Array<{ cluster: string; namespace: string }> }
	>()
	for (const row of envRows) {
		const existing = appMap.get(row.appId)
		if (existing) {
			existing.environments.push({ cluster: row.cluster, namespace: row.namespace })
		} else {
			appMap.set(row.appId, {
				appId: row.appId,
				appName: row.appName,
				environments: [{ cluster: row.cluster, namespace: row.namespace }],
			})
		}
	}

	const appIds = [...appMap.keys()]
	const persistenceMap = await getAppsPersistence(appIds)

	const apps = [...appMap.values()].map((app) => ({
		...app,
		persistence: (persistenceMap.get(app.appId) ?? []).map((p) => ({
			type: p.type,
			name: p.name,
			version: p.version,
		})),
	}))

	return { team, sectionName, sectionSlug, apps }
}

/** Get app count per Nais team (excludes linked/child apps). */
export async function getNaisTeamAppCounts(): Promise<Map<string, number>> {
	const rows = await db
		.select({
			naisTeamId: applicationEnvironments.naisTeamId,
			count: sql<number>`count(DISTINCT ${applicationEnvironments.applicationId})`,
		})
		.from(applicationEnvironments)
		.innerJoin(monitoredApplications, eq(applicationEnvironments.applicationId, monitoredApplications.id))
		.where(isNull(monitoredApplications.primaryApplicationId))
		.groupBy(applicationEnvironments.naisTeamId)

	const map = new Map<string, number>()
	for (const row of rows) {
		if (row.naisTeamId) map.set(row.naisTeamId, Number(row.count))
	}
	return map
}

/** Update a Nais team status. */
export async function updateNaisTeamStatus(slug: string, status: "monitored" | "ignored", reviewedBy: string) {
	await db.update(naisTeams).set({ status, reviewedBy, reviewedAt: new Date() }).where(eq(naisTeams.slug, slug))
	await writeAuditLog({
		action: "nais_team_status_updated",
		entityType: "nais_team",
		entityId: slug,
		newValue: status,
		performedBy: reviewedBy,
	})
}

/** Upsert a Nais team — insert if new, skip if already exists. Returns true if new. */
export async function upsertNaisTeam(slug: string, displayName?: string | null, appCount?: number): Promise<boolean> {
	const [existing] = await db.select().from(naisTeams).where(eq(naisTeams.slug, slug)).limit(1)
	if (existing) {
		const updates: Record<string, unknown> = {}
		if (displayName && displayName !== existing.displayName) updates.displayName = displayName
		if (appCount !== undefined && appCount !== existing.appCount) updates.appCount = appCount
		if (Object.keys(updates).length > 0) {
			await db.update(naisTeams).set(updates).where(eq(naisTeams.slug, slug))
		}
		return false
	}
	await db.insert(naisTeams).values({ slug, displayName, appCount: appCount ?? 0 })
	return true
}

/**
 * Sync discovered app names for a Nais team.
 *
 * Bruker logisk arkivering (soft-delete) i stedet for hard sletting:
 *   - Apper som finnes i `appNames` men er arkivert: gjenoppliv (un-archive).
 *   - Apper som finnes i `appNames` men ikke i DB: insert som ny aktiv rad.
 *   - Apper som er aktive i DB men ikke i `appNames`: arkiver med audit.
 *   - Identiske aktive rader: ingen endring (idempotent, ingen audit).
 *
 * Alt skjer i én transaksjon sammen med audit-skriving for atomisitet.
 */
export async function syncDiscoveredApps(teamSlug: string, appNames: string[]): Promise<void> {
	const [team] = await db.select({ id: naisTeams.id }).from(naisTeams).where(eq(naisTeams.slug, teamSlug)).limit(1)
	if (!team) return

	const unique = [...new Set(appNames)]

	await db.transaction(async (tx) => {
		const existing = await tx
			.select({
				id: naisDiscoveredApps.id,
				name: naisDiscoveredApps.name,
				archivedAt: naisDiscoveredApps.archivedAt,
			})
			.from(naisDiscoveredApps)
			.where(eq(naisDiscoveredApps.naisTeamId, team.id))

		const activeRows = existing.filter((r) => r.archivedAt === null)
		const archivedRows = existing.filter((r) => r.archivedAt !== null)
		const activeByName = new Map(activeRows.map((row) => [row.name, row]))
		const archivedByName = new Map<string, (typeof archivedRows)[number]>()
		for (const row of archivedRows) {
			// Hvis flere arkiverte rader deler navn, behold den nyeste (siste id).
			const prev = archivedByName.get(row.name)
			if (!prev || row.id > prev.id) archivedByName.set(row.name, row)
		}
		const incoming = new Set(unique)

		// Arkiver aktive apper som ikke lenger rapporteres av Nais.
		for (const row of activeRows) {
			if (!incoming.has(row.name)) {
				await tx
					.update(naisDiscoveredApps)
					.set({ archivedAt: sql`NOW()`, archivedBy: SYNC_PERFORMER, updatedAt: sql`NOW()` })
					.where(eq(naisDiscoveredApps.id, row.id))
				await writeAuditLog(
					{
						action: "nais_discovered_app_archived",
						entityType: "nais_team",
						entityId: teamSlug,
						previousValue: JSON.stringify({ name: row.name }),
						performedBy: SYNC_PERFORMER,
					},
					tx,
				)
			}
		}

		// Insert nye / gjenoppliv arkiverte apper som er rapportert nå.
		for (const name of unique) {
			if (activeByName.has(name)) continue
			const archived = archivedByName.get(name)
			if (archived) {
				await tx
					.update(naisDiscoveredApps)
					.set({ archivedAt: null, archivedBy: null, updatedAt: sql`NOW()` })
					.where(eq(naisDiscoveredApps.id, archived.id))
				await writeAuditLog(
					{
						action: "nais_discovered_app_added",
						entityType: "nais_team",
						entityId: teamSlug,
						newValue: JSON.stringify({ name, revived: true }),
						performedBy: SYNC_PERFORMER,
					},
					tx,
				)
			} else {
				await tx.insert(naisDiscoveredApps).values({ name, naisTeamId: team.id })
				await writeAuditLog(
					{
						action: "nais_discovered_app_added",
						entityType: "nais_team",
						entityId: teamSlug,
						newValue: JSON.stringify({ name }),
						performedBy: SYNC_PERFORMER,
					},
					tx,
				)
			}
		}
	})
}

/** Upsert a monitored application — insert if new, skip if exists. Returns the app. */
export async function upsertMonitoredApp(name: string, createdBy: string): Promise<{ id: string; isNew: boolean }> {
	const [existing] = await db.select().from(monitoredApplications).where(eq(monitoredApplications.name, name)).limit(1)
	if (existing) return { id: existing.id, isNew: false }

	const [app] = await db.insert(monitoredApplications).values({ name, createdBy, updatedBy: createdBy }).returning()
	return { id: app.id, isNew: true }
}

/** Upsert an application environment mapping. Returns true if new. */
export async function upsertAppEnvironment(
	applicationId: string,
	cluster: string,
	namespace: string,
	naisTeamId: string | null,
	imageName?: string | null,
	gitRepository?: string | null,
): Promise<boolean> {
	const [existing] = await db
		.select()
		.from(applicationEnvironments)
		.where(
			sql`${applicationEnvironments.applicationId} = ${applicationId}
				AND ${applicationEnvironments.cluster} = ${cluster}
				AND ${applicationEnvironments.namespace} = ${namespace}`,
		)
		.limit(1)
	if (existing) {
		const updates: Record<string, string> = {}
		if (imageName && imageName !== existing.imageName) updates.imageName = imageName
		if (gitRepository && gitRepository !== existing.gitRepository) updates.gitRepository = gitRepository
		if (Object.keys(updates).length > 0) {
			await db.update(applicationEnvironments).set(updates).where(eq(applicationEnvironments.id, existing.id))
		}
		return false
	}

	await db
		.insert(applicationEnvironments)
		.values({ applicationId, cluster, namespace, naisTeamId, imageName, gitRepository })

	// Auto-register new cluster in section_environments via subquery (ON CONFLICT DO NOTHING preserves manual toggles)
	if (naisTeamId) {
		await db.execute(
			sql`INSERT INTO section_environments (section_id, cluster, included, added_by, updated_by)
				SELECT section_id, ${cluster}, true, 'nais-sync', 'nais-sync'
				FROM nais_teams WHERE id = ${naisTeamId} AND section_id IS NOT NULL
				ON CONFLICT DO NOTHING`,
		)
	}
	return true
}

/** Get the last sync timestamp from audit log. */
export async function getLastSyncTimestamp(): Promise<Date | null> {
	const [row] = await db
		.select({ performedAt: auditLog.performedAt })
		.from(auditLog)
		.where(eq(auditLog.action, "nais_sync_completed"))
		.orderBy(desc(auditLog.performedAt))
		.limit(1)
	return row?.performedAt ?? null
}

/**
 * Link a Nais team to a section. Avviser arkiverte og ikke-eksisterende seksjoner.
 * Hele operasjonen kjører i én transaksjon: seksjonen låses (`SELECT ... FOR SHARE`)
 * slik at en samtidig `archiveSection` ikke kan committe mellom guard-sjekken og
 * UPDATE. Audit-loggen skrives på samme transaksjon (AGENTS.md regel 6).
 */
export async function linkNaisTeamToSection(naisTeamSlug: string, sectionId: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [section] = await tx.select().from(sections).where(eq(sections.id, sectionId)).limit(1).for("share")
		if (!section) throw new Error(`Seksjon med id ${sectionId} finnes ikke`)
		if (section.archivedAt) throw new Error(`Kan ikke koble til arkivert seksjon «${section.name}»`)
		const updated = await tx
			.update(naisTeams)
			.set({ sectionId })
			.where(eq(naisTeams.slug, naisTeamSlug))
			.returning({ slug: naisTeams.slug })
		if (updated.length === 0) {
			throw new Error(`Nais-team med slug «${naisTeamSlug}» finnes ikke`)
		}
		await writeAuditLog(
			{
				action: "nais_team_section_linked",
				entityType: "nais_team",
				entityId: naisTeamSlug,
				newValue: section.name,
				performedBy,
			},
			tx,
		)
	})
}

/** Unlink a Nais team from a section. */
export async function unlinkNaisTeamFromSection(naisTeamSlug: string, performedBy: string) {
	const [team] = await db.select().from(naisTeams).where(eq(naisTeams.slug, naisTeamSlug)).limit(1)
	const [prevSection] = team?.sectionId
		? await db.select().from(sections).where(eq(sections.id, team.sectionId)).limit(1)
		: [null]
	await db.update(naisTeams).set({ sectionId: null }).where(eq(naisTeams.slug, naisTeamSlug))
	await writeAuditLog({
		action: "nais_team_section_unlinked",
		entityType: "nais_team",
		entityId: naisTeamSlug,
		previousValue: prevSection?.name ?? null,
		performedBy,
	})
}

/** Get Nais teams linked to a section. */
export async function getNaisTeamsForSection(sectionId: string) {
	return db.select().from(naisTeams).where(eq(naisTeams.sectionId, sectionId)).orderBy(naisTeams.slug)
}

/** Get unlinked Nais teams (no sectionId, status=monitored). */
export async function getUnlinkedNaisTeams() {
	return db
		.select()
		.from(naisTeams)
		.where(and(isNull(naisTeams.sectionId), eq(naisTeams.status, "monitored")))
		.orderBy(naisTeams.slug)
}

/**
 * Get apps belonging to Nais teams linked to a section that are
 * NOT yet linked to any dev team and NOT ignored.
 */
export async function getUnassignedAppsForSection(sectionId: string) {
	// Get nais teams linked to this section
	const sectionNaisTeams = await db.select().from(naisTeams).where(eq(naisTeams.sectionId, sectionId))
	if (sectionNaisTeams.length === 0) return []

	const naisTeamIds = sectionNaisTeams.map((t) => t.id)

	// Load excluded environments
	const excludedRows = await db
		.select({ cluster: sectionEnvironments.cluster })
		.from(sectionEnvironments)
		.where(and(eq(sectionEnvironments.sectionId, sectionId), eq(sectionEnvironments.included, false)))
	const excludedEnvs = new Set(excludedRows.map((r) => r.cluster))

	// Get all apps from those nais teams' environments (excludes linked/child apps)
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

	const envApps = await db
		.select({
			appId: applicationEnvironments.applicationId,
			appName: monitoredApplications.name,
			cluster: applicationEnvironments.cluster,
			namespace: applicationEnvironments.namespace,
			naisTeamSlug: naisTeams.slug,
		})
		.from(applicationEnvironments)
		.innerJoin(monitoredApplications, eq(applicationEnvironments.applicationId, monitoredApplications.id))
		.innerJoin(naisTeams, eq(applicationEnvironments.naisTeamId, naisTeams.id))
		.where(and(...envConditions))

	// Get apps that already have a dev team mapping (direct or via nais team link)
	const [directLinkedRows, naisTeamLinkedRows] = await Promise.all([
		db
			.select({ appId: applicationTeamMappings.applicationId })
			.from(applicationTeamMappings)
			.where(isNull(applicationTeamMappings.archivedAt)),
		db
			.selectDistinct({ appId: applicationEnvironments.applicationId })
			.from(devTeamNaisTeamMappings)
			.innerJoin(applicationEnvironments, eq(applicationEnvironments.naisTeamId, devTeamNaisTeamMappings.naisTeamId))
			.innerJoin(monitoredApplications, eq(applicationEnvironments.applicationId, monitoredApplications.id))
			.where(and(isNull(monitoredApplications.primaryApplicationId), isNull(devTeamNaisTeamMappings.archivedAt))),
	])
	const linkedAppIds = new Set([...directLinkedRows.map((r) => r.appId), ...naisTeamLinkedRows.map((r) => r.appId)])

	// Get apps ignored for this section
	const ignoredAppIds = new Set(
		(
			await db
				.select({ appId: sectionIgnoredApplications.applicationId })
				.from(sectionIgnoredApplications)
				.where(and(eq(sectionIgnoredApplications.sectionId, sectionId), isNull(sectionIgnoredApplications.archivedAt)))
		).map((r) => r.appId),
	)

	// Deduplicate by appId and filter out already-linked and ignored apps
	const seen = new Set<string>()
	const unassigned: Array<{ appId: string; appName: string; naisTeamSlug: string; environments: string[] }> = []

	for (const row of envApps) {
		if (linkedAppIds.has(row.appId)) continue
		if (ignoredAppIds.has(row.appId)) continue
		if (seen.has(row.appId)) {
			const existing = unassigned.find((a) => a.appId === row.appId)
			if (existing && !existing.environments.includes(row.cluster)) {
				existing.environments.push(row.cluster)
			}
			continue
		}
		seen.add(row.appId)
		unassigned.push({
			appId: row.appId,
			appName: row.appName,
			naisTeamSlug: row.naisTeamSlug,
			environments: [row.cluster],
		})
	}

	return unassigned.sort((a, b) => a.appName.localeCompare(b.appName))
}

/** Get ignored apps for a section. */
export async function getIgnoredAppsForSection(sectionId: string) {
	return db
		.select({
			id: sectionIgnoredApplications.id,
			appId: sectionIgnoredApplications.applicationId,
			appName: monitoredApplications.name,
			reason: sectionIgnoredApplications.reason,
			ignoredAt: sectionIgnoredApplications.ignoredAt,
			ignoredBy: sectionIgnoredApplications.ignoredBy,
		})
		.from(sectionIgnoredApplications)
		.innerJoin(monitoredApplications, eq(sectionIgnoredApplications.applicationId, monitoredApplications.id))
		.where(and(eq(sectionIgnoredApplications.sectionId, sectionId), isNull(sectionIgnoredApplications.archivedAt)))
		.orderBy(monitoredApplications.name)
}

/** Get all environments for a section with included status. */
export async function getSectionEnvironments(sectionId: string): Promise<{ cluster: string; included: boolean }[]> {
	const rows = await db
		.select({ cluster: sectionEnvironments.cluster, included: sectionEnvironments.included })
		.from(sectionEnvironments)
		.where(eq(sectionEnvironments.sectionId, sectionId))
		.orderBy(sectionEnvironments.cluster)
	return rows
}

/** Get excluded environments for a section (clusters with included=false). */
export async function getExcludedEnvironments(sectionId: string): Promise<Set<string>> {
	const rows = await db
		.select({ cluster: sectionEnvironments.cluster })
		.from(sectionEnvironments)
		.where(and(eq(sectionEnvironments.sectionId, sectionId), eq(sectionEnvironments.included, false)))
	return new Set(rows.map((r) => r.cluster))
}

/** Exclude a cluster for a section (idempotent). */
export async function excludeEnvironment(sectionId: string, cluster: string, performedBy: string) {
	await db
		.update(sectionEnvironments)
		.set({ included: false, updatedBy: performedBy, updatedAt: new Date() })
		.where(and(eq(sectionEnvironments.sectionId, sectionId), eq(sectionEnvironments.cluster, cluster)))
	await writeAuditLog({
		action: "section_environment_excluded",
		entityType: "section",
		entityId: sectionId,
		newValue: JSON.stringify({ cluster }),
		performedBy,
	})
}

/** Include (re-enable) a cluster for a section (idempotent). */
export async function includeEnvironment(sectionId: string, cluster: string, performedBy: string) {
	await db
		.update(sectionEnvironments)
		.set({ included: true, updatedBy: performedBy, updatedAt: new Date() })
		.where(and(eq(sectionEnvironments.sectionId, sectionId), eq(sectionEnvironments.cluster, cluster)))
	await writeAuditLog({
		action: "section_environment_included",
		entityType: "section",
		entityId: sectionId,
		previousValue: JSON.stringify({ cluster }),
		performedBy,
	})
}

/** Ignore an app for a section.
 *
 * Wrappet i transaksjon med audit som del av samme tx for atomisitet. Hvis
 * det allerede finnes en aktiv ignorering er dette en idempotent no-op (ingen
 * audit). Race-håndtering: hvis raden ble arkivert mellom INSERT og SELECT
 * kastes concurrency-feil i stedet for stille `null`.
 */
export async function ignoreAppForSection(
	sectionId: string,
	applicationId: string,
	ignoredBy: string,
	reason?: string,
) {
	return db.transaction(async (tx) => {
		// Normaliser reason én gang: trim whitespace, tom streng → null. Brukes
		// både i DB-raden og audit-loggen så de er konsistente.
		const normalizedReason = reason?.trim() ? reason.trim() : null
		const [inserted] = await tx
			.insert(sectionIgnoredApplications)
			.values({
				sectionId,
				applicationId,
				reason: normalizedReason,
				ignoredBy,
			})
			.onConflictDoNothing({
				target: [sectionIgnoredApplications.sectionId, sectionIgnoredApplications.applicationId],
				where: isNull(sectionIgnoredApplications.archivedAt),
			})
			.returning()

		if (inserted) {
			await writeAuditLog(
				{
					action: "section_app_ignored",
					entityType: "section_ignored_application",
					entityId: applicationId,
					newValue: JSON.stringify({ sectionId, applicationId, reason: normalizedReason }),
					metadata: { sectionId },
					performedBy: ignoredBy,
				},
				tx,
			)
			return inserted
		}

		// Konflikt: enten finnes det en eksisterende aktiv rad (idempotent
		// no-op), eller raden ble arkivert i et race. Sjekk eksplisitt.
		const [existing] = await tx
			.select()
			.from(sectionIgnoredApplications)
			.where(
				and(
					eq(sectionIgnoredApplications.sectionId, sectionId),
					eq(sectionIgnoredApplications.applicationId, applicationId),
					isNull(sectionIgnoredApplications.archivedAt),
				),
			)
			.limit(1)

		if (!existing) {
			throw new Error("Kunne ikke ignorere applikasjon pga. samtidig endring. Prøv igjen.")
		}

		return existing
	})
}

/** Unignore (arkiver) an app for a section.
 *
 * Tidligere ble raden hard-slettet. Nå arkiverer vi den slik at vi bevarer
 * sporbarhet på hvilke applikasjoner seksjonen har ignorert. Wrappet i
 * transaksjon med audit som del av samme tx — hvis audit-skriving feiler
 * rulles arkiveringen tilbake. Idempotent: returnerer `null` hvis det ikke
 * finnes noen aktiv rad å arkivere.
 */
export async function unignoreAppForSection(sectionId: string, applicationId: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [archived] = await tx
			.update(sectionIgnoredApplications)
			.set({ archivedAt: new Date(), archivedBy: performedBy })
			.where(
				and(
					eq(sectionIgnoredApplications.sectionId, sectionId),
					eq(sectionIgnoredApplications.applicationId, applicationId),
					isNull(sectionIgnoredApplications.archivedAt),
				),
			)
			.returning()

		if (!archived) return null

		await writeAuditLog(
			{
				action: "section_app_unignored",
				entityType: "section_ignored_application",
				entityId: applicationId,
				previousValue: JSON.stringify({ sectionId, applicationId }),
				metadata: { sectionId },
				performedBy,
			},
			tx,
		)

		return archived
	})
}

/**
 * Upsert a persistence resource for an application. Hvis raden allerede
 * eksisterer og er arkivert (f.eks. tidligere arkivert manuelt), reaktiveres
 * den automatisk fordi Nais-sync er kilden for sannhet på faktisk
 * tilstedeværelse i klyngen. Reaktivering audit-logges som
 * `persistence_unarchived` med `performedBy: "nais-sync"`.
 *
 * Audit (AGENTS.md regel 6):
 * - INSERT (ny rad oppdaget i Nais): `persistence_added`
 * - UPDATE-på-eksisterende-aktiv-rad: `persistence_updated` KUN hvis minst
 *   ett av de oppdaterte feltene faktisk endret seg (no-op-resyncs spammer
 *   ellers audit-loggen hvert 5. minutt og skjuler reelle endringer).
 * - UPDATE-på-arkivert-rad: `persistence_unarchived` (eksisterende oppførsel).
 *
 * NB: Merge-semantikken for `opts?.x ?? existing.x` betyr at felter som
 * Nais ikke rapporterer (undefined) beholder eksisterende verdi. Dette er
 * bevisst behold for å ikke nullstille felter ved partielle resyncs, men
 * betyr også at `null`-verdier fra Nais ikke kan nullstille felter — det
 * krever en separat clearing-mekanisme (utenfor scope for K3-fiksen).
 */
export async function upsertAppPersistence(
	applicationId: string,
	type: PersistenceType,
	name: string,
	opts?: {
		version?: string | null
		tier?: string | null
		highAvailability?: boolean | null
		auditLogging?: boolean | null
		auditLogUrl?: string | null
	},
): Promise<boolean> {
	return db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(applicationPersistence)
			.where(
				and(
					eq(applicationPersistence.applicationId, applicationId),
					eq(applicationPersistence.type, type),
					eq(applicationPersistence.name, name),
				),
			)
			.orderBy(sql`${applicationPersistence.archivedAt} NULLS FIRST`, applicationPersistence.discoveredAt)
			.for("update")
			.limit(1)

		if (existing) {
			const wasArchived = existing.archivedAt !== null
			const previousArchivedAt = existing.archivedAt
			const nextState = {
				version: opts?.version ?? existing.version,
				tier: opts?.tier ?? existing.tier,
				highAvailability: opts?.highAvailability ?? existing.highAvailability,
				auditLogging: opts?.auditLogging ?? existing.auditLogging,
				auditLogUrl: opts?.auditLogUrl ?? existing.auditLogUrl,
			}
			const previousFields = {
				version: existing.version,
				tier: existing.tier,
				highAvailability: existing.highAvailability,
				auditLogging: existing.auditLogging,
				auditLogUrl: existing.auditLogUrl,
			}
			const fieldsChanged =
				nextState.version !== previousFields.version ||
				nextState.tier !== previousFields.tier ||
				nextState.highAvailability !== previousFields.highAvailability ||
				nextState.auditLogging !== previousFields.auditLogging ||
				nextState.auditLogUrl !== previousFields.auditLogUrl

			// Hopp over UPDATE helt når det ikke er noe å endre (verken
			// reaktivering eller feltendring). Ellers ville `updatedAt` blitt
			// mutert ved hver Nais-resync uten tilsvarende audit-logg, som
			// strider mot AGENTS.md regel 6 om audit på alle DB-mutasjoner.
			if (wasArchived || fieldsChanged) {
				await tx
					.update(applicationPersistence)
					.set({
						...nextState,
						updatedAt: new Date(),
						archivedAt: null,
						archivedBy: null,
					})
					.where(eq(applicationPersistence.id, existing.id))
			}

			if (wasArchived) {
				await writeAuditLog(
					{
						action: "persistence_unarchived",
						entityType: "application_persistence",
						entityId: existing.id,
						previousValue: JSON.stringify({
							type: existing.type,
							name: existing.name,
							archivedAt: previousArchivedAt,
						}),
						newValue: JSON.stringify({ type: existing.type, name: existing.name }),
						metadata: { applicationId, reason: "nais_resync" },
						performedBy: "nais-sync",
					},
					tx,
				)
			}
			// NB: vi logger persistence_updated ALLTID ved feltendring, også når
			// raden samtidig reaktiveres. Ellers ville feltendringer som skjer
			// i samme operasjon som unarchive blitt usynlige i audit-loggen.
			if (fieldsChanged) {
				await writeAuditLog(
					{
						action: "persistence_updated",
						entityType: "application_persistence",
						entityId: existing.id,
						previousValue: JSON.stringify(previousFields),
						newValue: JSON.stringify(nextState),
						metadata: { applicationId, type: existing.type, name: existing.name, source: "nais-sync" },
						performedBy: "nais-sync",
					},
					tx,
				)
			}
			return false
		}

		const [inserted] = await tx
			.insert(applicationPersistence)
			.values({
				applicationId,
				type,
				name,
				version: opts?.version ?? null,
				tier: opts?.tier ?? null,
				highAvailability: opts?.highAvailability ?? null,
				auditLogging: opts?.auditLogging ?? null,
				auditLogUrl: opts?.auditLogUrl ?? null,
			})
			.returning()

		await writeAuditLog(
			{
				action: "persistence_added",
				entityType: "application_persistence",
				entityId: inserted.id,
				newValue: JSON.stringify({
					type,
					name,
					version: inserted.version,
					tier: inserted.tier,
					highAvailability: inserted.highAvailability,
					auditLogging: inserted.auditLogging,
					auditLogUrl: inserted.auditLogUrl,
				}),
				metadata: { applicationId, source: "nais-sync" },
				performedBy: "nais-sync",
			},
			tx,
		)
		return true
	})
}

// Kanonisk JSON-serialisering for arrays/objekter slik at sammenligning
// (og lagret representasjon) ikke flagger reordrede elementer som endring.
function canonicalizeStringArray(arr: string[] | null | undefined): string | null {
	if (!arr?.length) return null
	return JSON.stringify([...arr].sort())
}

function canonicalizeInboundRules(
	rules: Array<{ application: string; namespace?: string; cluster?: string }> | null | undefined,
): string | null {
	if (!rules?.length) return null
	const sorted = [...rules]
		.map((r) => ({ application: r.application, namespace: r.namespace ?? null, cluster: r.cluster ?? null }))
		.sort((a, b) => {
			const aKey = `${a.application}|${a.namespace ?? ""}|${a.cluster ?? ""}`
			const bKey = `${b.application}|${b.namespace ?? ""}|${b.cluster ?? ""}`
			return aKey < bKey ? -1 : aKey > bKey ? 1 : 0
		})
	return JSON.stringify(sorted)
}

// Re-kanoniserer en allerede lagret JSON-streng (string-array) slik at
// sammenligning av incoming vs. existing er på samme normaliserte form.
// Robust mot eldre rader skrevet før kanonisering ble innført.
function recanonicalizeStoredStringArray(stored: string | null): string | null {
	if (!stored) return null
	try {
		const parsed = JSON.parse(stored)
		if (!Array.isArray(parsed)) return stored
		return canonicalizeStringArray(parsed as string[])
	} catch {
		return stored
	}
}

function recanonicalizeStoredInboundRules(stored: string | null): string | null {
	if (!stored) return null
	try {
		const parsed = JSON.parse(stored)
		if (!Array.isArray(parsed)) return stored
		return canonicalizeInboundRules(parsed as Array<{ application: string; namespace?: string; cluster?: string }>)
	} catch {
		return stored
	}
}

/**
 * Upsert an auth integration for an application.
 *
 * Audit (AGENTS.md regel 6):
 * - INSERT: `auth_integration_added` med all initial state.
 * - UPDATE: `auth_integration_updated` KUN hvis minst ett felt faktisk endret
 *   seg etter `?? existing`-merge. Inkluderer `enabled`-feltet siden en
 *   transisjon `false → true` er semantisk en reaktivering. Arrays
 *   (`groups`, `claimsExtra`, `inboundRules`) sorteres deterministisk før
 *   sammenligning og lagring slik at Nais-resyncs i ulik rekkefølge ikke
 *   gir falske endringer. Eksisterende lagrede arrays re-kanoniseres ved
 *   sammenligning slik at rader skrevet før kanonisering ble innført ikke
 *   gir falske `auth_integration_updated` ved første resync etter deploy.
 *
 * Hele operasjonen kjører i en transaksjon. For TOCTOU-trygghet (advisory
 * locks i `nais-sync.server.ts` er per team-scope og beskytter ikke mot
 * samtidige fulle syncs som rører samme app) tas en `SELECT ... FOR UPDATE`
 * på parent `monitored_applications`-raden FØR vi sjekker eksisterende
 * integrasjon. Det serialiserer alle upsert-kall for samme application,
 * så to samtidige INSERT-er ikke kan begge se «ingen rad» og lage duplikater.
 *
 * NB: `application_auth_integrations` mangler fortsatt en DB-håndhevd
 * unique-constraint på `(application_id, type)`. Egen oppfølgings-PR vil
 * legge til constraint + dedup-migrasjon. Inntil da er parent-row-låsen
 * forsvarslaget.
 */
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
	const claimsExtraStr = canonicalizeStringArray(opts?.claimsExtra)
	const groupsStr = canonicalizeStringArray(opts?.groups)
	const inboundRulesStr = canonicalizeInboundRules(opts?.inboundRules)

	return db.transaction(async (tx) => {
		// Lås parent-app-raden for å serialisere samtidige upserts mot samme app.
		// Beskytter mot duplikat-INSERT-race siden auth_integrations ikke har
		// (application_id, type) unique constraint ennå.
		await tx
			.select({ id: monitoredApplications.id })
			.from(monitoredApplications)
			.where(eq(monitoredApplications.id, applicationId))
			.for("update")
			.limit(1)

		const [existing] = await tx
			.select()
			.from(applicationAuthIntegrations)
			.where(
				and(eq(applicationAuthIntegrations.applicationId, applicationId), eq(applicationAuthIntegrations.type, type)),
			)
			.for("update")
			.limit(1)

		if (existing) {
			// Re-kanoniser lagrede arrays før sammenligning slik at eldre rader
			// (skrevet før kanonisering ble innført) ikke gir false positives.
			const existingClaimsExtra = recanonicalizeStoredStringArray(existing.claimsExtra)
			const existingGroups = recanonicalizeStoredStringArray(existing.groups)
			const existingInboundRules = recanonicalizeStoredInboundRules(existing.inboundRules)

			const nextState = {
				enabled: true,
				allowAllUsers: opts?.allowAllUsers ?? existing.allowAllUsers,
				claimsExtra: claimsExtraStr ?? existingClaimsExtra,
				groups: groupsStr ?? existingGroups,
				sidecarEnabled: opts?.sidecarEnabled ?? existing.sidecarEnabled,
				inboundRules: inboundRulesStr ?? existingInboundRules,
			}
			const previousFields = {
				enabled: existing.enabled,
				allowAllUsers: existing.allowAllUsers,
				claimsExtra: existingClaimsExtra,
				groups: existingGroups,
				sidecarEnabled: existing.sidecarEnabled,
				inboundRules: existingInboundRules,
			}
			const fieldsChanged =
				nextState.enabled !== previousFields.enabled ||
				nextState.allowAllUsers !== previousFields.allowAllUsers ||
				nextState.claimsExtra !== previousFields.claimsExtra ||
				nextState.groups !== previousFields.groups ||
				nextState.sidecarEnabled !== previousFields.sidecarEnabled ||
				nextState.inboundRules !== previousFields.inboundRules

			// Skip UPDATE entirely when nothing changed — ellers muteres
			// `updatedAt` (og evt. re-kanonisert tekst) uten audit-logg.
			if (fieldsChanged) {
				await tx
					.update(applicationAuthIntegrations)
					.set({ ...nextState, updatedAt: new Date() })
					.where(eq(applicationAuthIntegrations.id, existing.id))
			}

			if (fieldsChanged) {
				await writeAuditLog(
					{
						action: "auth_integration_updated",
						entityType: "application_auth_integration",
						entityId: existing.id,
						previousValue: JSON.stringify(previousFields),
						newValue: JSON.stringify(nextState),
						metadata: { applicationId, type, source: "nais-sync" },
						performedBy: "nais-sync",
					},
					tx,
				)
			}
			return false
		}

		const [inserted] = await tx
			.insert(applicationAuthIntegrations)
			.values({
				applicationId,
				type,
				allowAllUsers: opts?.allowAllUsers ?? null,
				claimsExtra: claimsExtraStr,
				groups: groupsStr,
				sidecarEnabled: opts?.sidecarEnabled ?? null,
				inboundRules: inboundRulesStr,
			})
			.returning()

		await writeAuditLog(
			{
				action: "auth_integration_added",
				entityType: "application_auth_integration",
				entityId: inserted.id,
				newValue: JSON.stringify({
					type,
					enabled: inserted.enabled,
					allowAllUsers: inserted.allowAllUsers,
					claimsExtra: inserted.claimsExtra,
					groups: inserted.groups,
					sidecarEnabled: inserted.sidecarEnabled,
					inboundRules: inserted.inboundRules,
				}),
				metadata: { applicationId, source: "nais-sync" },
				performedBy: "nais-sync",
			},
			tx,
		)
		return true
	})
}

/** Get auth integrations for an application. */
export async function getAppAuthIntegrations(applicationId: string) {
	return db
		.select()
		.from(applicationAuthIntegrations)
		.where(eq(applicationAuthIntegrations.applicationId, applicationId))
		.orderBy(applicationAuthIntegrations.type)
}
/**
 * Henter persistens-ressurser for en applikasjon. Filtrerer bort arkiverte
 * rader. Sett `includeArchived: true` for admin-/historikk-visninger.
 */
export async function getAppPersistence(applicationId: string, opts?: { includeArchived?: boolean }) {
	const conditions = [eq(applicationPersistence.applicationId, applicationId)]
	if (!opts?.includeArchived) conditions.push(isNull(applicationPersistence.archivedAt))
	return db
		.select()
		.from(applicationPersistence)
		.where(and(...conditions))
		.orderBy(applicationPersistence.type, applicationPersistence.name)
}

/**
 * Get persistence resources for multiple applications (batch). Filtrerer bort
 * arkiverte rader. Sett `includeArchived: true` for admin-/historikk-visninger.
 */
export async function getAppsPersistence(applicationIds: string[], opts?: { includeArchived?: boolean }) {
	if (applicationIds.length === 0) return new Map<string, (typeof applicationPersistence.$inferSelect)[]>()

	const conditions = [inArray(applicationPersistence.applicationId, applicationIds)]
	if (!opts?.includeArchived) conditions.push(isNull(applicationPersistence.archivedAt))

	const rows = await db
		.select()
		.from(applicationPersistence)
		.where(and(...conditions))
		.orderBy(applicationPersistence.type, applicationPersistence.name)

	const map = new Map<string, (typeof applicationPersistence.$inferSelect)[]>()
	for (const row of rows) {
		const list = map.get(row.applicationId) ?? []
		list.push(row)
		map.set(row.applicationId, list)
	}
	return map
}

/**
 * Link an Oracle persistence entry to an Oracle instance ID. Avviser endring
 * av arkiverte rader.
 */
export async function linkPersistenceToOracleInstance(persistenceId: string, oracleInstanceId: string | null) {
	const [existing] = await db
		.select({ id: applicationPersistence.id, archivedAt: applicationPersistence.archivedAt })
		.from(applicationPersistence)
		.where(eq(applicationPersistence.id, persistenceId))
		.limit(1)
	if (!existing) {
		throw new Response("Persistens-oppføring ikke funnet", { status: 404 })
	}
	if (existing.archivedAt) {
		throw new Response("Kan ikke koble en arkivert database. Reaktiver oppføringen først.", { status: 403 })
	}
	await db
		.update(applicationPersistence)
		.set({ oracleInstanceId, updatedAt: new Date() })
		.where(and(eq(applicationPersistence.id, persistenceId), isNull(applicationPersistence.archivedAt)))
}

/** Get a name map for a batch of application IDs. */
export async function getApplicationNames(appIds: string[]): Promise<Map<string, string>> {
	if (appIds.length === 0) return new Map()
	const apps = await db
		.select({ id: monitoredApplications.id, name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(inArray(monitoredApplications.id, appIds))
	return new Map(apps.map((a) => [a.id, a.name]))
}

/** Get application detail with environments, persistence, and linked apps. */
export async function getApplicationDetail(applicationId: string) {
	const [app] = await db
		.select()
		.from(monitoredApplications)
		.where(eq(monitoredApplications.id, applicationId))
		.limit(1)
	if (!app) return null

	const environments = await db
		.select({
			id: applicationEnvironments.id,
			cluster: applicationEnvironments.cluster,
			namespace: applicationEnvironments.namespace,
			imageName: applicationEnvironments.imageName,
			gitRepository: applicationEnvironments.gitRepository,
			naisTeamSlug: naisTeams.slug,
			naisTeamSectionId: naisTeams.sectionId,
			discoveredAt: applicationEnvironments.discoveredAt,
		})
		.from(applicationEnvironments)
		.leftJoin(naisTeams, eq(applicationEnvironments.naisTeamId, naisTeams.id))
		.where(eq(applicationEnvironments.applicationId, applicationId))
		.orderBy(applicationEnvironments.cluster)

	// Filter out environments in clusters that are excluded (included=false) in the Nais team's section
	const sectionIds = [...new Set(environments.map((e) => e.naisTeamSectionId).filter(Boolean) as string[])]
	const excludedBySection = new Map<string, Set<string>>() // sectionId → Set<cluster>
	if (sectionIds.length > 0) {
		const exclusionRows = await db
			.select({ sectionId: sectionEnvironments.sectionId, cluster: sectionEnvironments.cluster })
			.from(sectionEnvironments)
			.where(and(inArray(sectionEnvironments.sectionId, sectionIds), eq(sectionEnvironments.included, false)))
		for (const row of exclusionRows) {
			const set = excludedBySection.get(row.sectionId) ?? new Set<string>()
			set.add(row.cluster)
			excludedBySection.set(row.sectionId, set)
		}
	}
	const environmentsWithExcluded = environments
		.map((env) => ({
			...env,
			isExcluded: env.naisTeamSectionId
				? (excludedBySection.get(env.naisTeamSectionId)?.has(env.cluster ?? "") ?? false)
				: false,
		}))
		.filter((env) => !env.isExcluded)

	const persistence = await getAppPersistence(applicationId)
	const authIntegrations = await getAppAuthIntegrations(applicationId)
	const accessPolicyRules = await getAccessPolicyRules(applicationId)

	const teamMappings = await db
		.select({ teamId: devTeams.id, teamName: devTeams.name, teamSlug: devTeams.slug })
		.from(applicationTeamMappings)
		.innerJoin(devTeams, eq(applicationTeamMappings.devTeamId, devTeams.id))
		.where(and(eq(applicationTeamMappings.applicationId, applicationId), isNull(applicationTeamMappings.archivedAt)))

	// Get primary application if this is a linked app
	let primaryApp: { id: string; name: string } | null = null
	if (app.primaryApplicationId) {
		const [primary] = await db
			.select({ id: monitoredApplications.id, name: monitoredApplications.name })
			.from(monitoredApplications)
			.where(eq(monitoredApplications.id, app.primaryApplicationId))
			.limit(1)
		primaryApp = primary ?? null
	}

	// Get linked apps if this is a primary
	const linkedApps = await db
		.select({ id: monitoredApplications.id, name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(eq(monitoredApplications.primaryApplicationId, applicationId))
		.orderBy(monitoredApplications.name)

	return {
		app,
		environments: environmentsWithExcluded,
		persistence,
		authIntegrations,
		accessPolicyRules,
		teams: teamMappings,
		primaryApp,
		linkedApps,
	}
}

/** Link an application to a primary application. */
export async function linkApplication(linkedId: string, primaryId: string, performedBy: string) {
	const [linked] = await db
		.select({ name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(eq(monitoredApplications.id, linkedId))
		.limit(1)
	const [primary] = await db
		.select({ name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(eq(monitoredApplications.id, primaryId))
		.limit(1)

	await db
		.update(monitoredApplications)
		.set({ primaryApplicationId: primaryId, updatedBy: performedBy, updatedAt: new Date() })
		.where(eq(monitoredApplications.id, linkedId))

	await writeAuditLog({
		action: "application_linked",
		entityType: "monitored_application",
		entityId: linkedId,
		newValue: JSON.stringify({ primaryId, primaryName: primary?.name, linkedName: linked?.name }),
		performedBy,
	})
}

/** Unlink an application from its primary. */
export async function unlinkApplication(applicationId: string, performedBy: string) {
	const [app] = await db
		.select({
			name: monitoredApplications.name,
			primaryApplicationId: monitoredApplications.primaryApplicationId,
		})
		.from(monitoredApplications)
		.where(eq(monitoredApplications.id, applicationId))
		.limit(1)

	await db
		.update(monitoredApplications)
		.set({ primaryApplicationId: null, updatedBy: performedBy, updatedAt: new Date() })
		.where(eq(monitoredApplications.id, applicationId))

	await writeAuditLog({
		action: "application_unlinked",
		entityType: "monitored_application",
		entityId: applicationId,
		previousValue: JSON.stringify({
			primaryId: app?.primaryApplicationId,
			appName: app?.name,
		}),
		performedBy,
	})
}

/** Rename an application. */
export async function renameApplication(appId: string, newName: string, performedBy: string) {
	const [app] = await db
		.select({ name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(eq(monitoredApplications.id, appId))
		.limit(1)

	await db
		.update(monitoredApplications)
		.set({ name: newName, updatedBy: performedBy, updatedAt: new Date() })
		.where(eq(monitoredApplications.id, appId))

	await writeAuditLog({
		action: "application_renamed",
		entityType: "monitored_application",
		entityId: appId,
		previousValue: JSON.stringify({ name: app?.name }),
		newValue: JSON.stringify({ name: newName }),
		performedBy,
	})
}

/** Promote a linked app to become the new primary in a group.
 *  - newPrimaryId becomes the primary (primaryApplicationId = null)
 *  - currentPrimaryId becomes a child of the new primary
 *  - All other children of currentPrimaryId are moved to point to newPrimaryId
 */
export async function promoteToPrimary(newPrimaryId: string, currentPrimaryId: string, performedBy: string) {
	const [newPrimary] = await db
		.select({ name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(eq(monitoredApplications.id, newPrimaryId))
		.limit(1)
	const [currentPrimary] = await db
		.select({ name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(eq(monitoredApplications.id, currentPrimaryId))
		.limit(1)

	await db.transaction(async (tx) => {
		// Promote the new primary: clear its primaryApplicationId
		await tx
			.update(monitoredApplications)
			.set({ primaryApplicationId: null, updatedBy: performedBy, updatedAt: new Date() })
			.where(eq(monitoredApplications.id, newPrimaryId))

		// Move all existing children of the old primary to point to the new primary
		await tx
			.update(monitoredApplications)
			.set({ primaryApplicationId: newPrimaryId, updatedBy: performedBy, updatedAt: new Date() })
			.where(eq(monitoredApplications.primaryApplicationId, currentPrimaryId))

		// Demote the old primary: make it a child of the new primary
		await tx
			.update(monitoredApplications)
			.set({ primaryApplicationId: newPrimaryId, updatedBy: performedBy, updatedAt: new Date() })
			.where(eq(monitoredApplications.id, currentPrimaryId))
	})

	await writeAuditLog({
		action: "application_primary_changed",
		entityType: "monitored_application",
		entityId: newPrimaryId,
		previousValue: JSON.stringify({
			primaryId: currentPrimaryId,
			primaryName: currentPrimary?.name,
		}),
		newValue: JSON.stringify({
			primaryId: newPrimaryId,
			primaryName: newPrimary?.name,
		}),
		performedBy,
	})
}

/**
 * Arkiverer en applikasjon (soft-delete). Applikasjonen blir skjult fra
 * brukervendte lister, men beholder all data, compliance-historikk og
 * relasjoner. FK-er til monitored_applications er ON DELETE RESTRICT, så
 * fysisk sletting er umulig så lenge noen referanser finnes.
 *
 * TOCTOU-sikkerhet: precondition-sjekkene (ingen lenkede applikasjoner,
 * ingen Nais-miljøer, ikke allerede arkivert) er alle uttrykt som NOT
 * EXISTS-sub-queries i UPDATE-en sin WHERE-klausul. UPDATE og NOT EXISTS
 * evalueres atomisk under samme rad-lås, så samtidige inserts av
 * environments eller child-apps kan ikke smyge forbi sjekkene. Dersom
 * UPDATE returnerer 0 rader, kjøres et oppfølgings-SELECT for å gi en
 * presis feilmelding (ikke funnet vs. har miljø vs. har lenket app).
 * UPDATE og audit-skriving kjører i samme transaksjon (AGENTS.md regel 6).
 */
export async function archiveApplication(appId: string, performedBy: string) {
	return db.transaction(async (tx) => {
		// An environment is "active" unless its cluster is excluded (included=false)
		// in the nais team's section. Apps with only excluded environments are archivable.
		const hasActiveEnvs = sql`EXISTS (
			SELECT 1 FROM ${applicationEnvironments} ae
			LEFT JOIN ${naisTeams} nt ON nt.id = ae.nais_team_id
			WHERE ae.application_id = ${appId}
			AND NOT EXISTS (
				SELECT 1 FROM ${sectionEnvironments} se
				WHERE se.section_id = nt.section_id
				AND se.cluster = ae.cluster
				AND se.included = false
			)
		)`

		const [archived] = await tx
			.update(monitoredApplications)
			.set({
				archivedAt: new Date(),
				archivedBy: performedBy,
				updatedAt: new Date(),
				updatedBy: performedBy,
			})
			.where(
				and(
					eq(monitoredApplications.id, appId),
					isNull(monitoredApplications.archivedAt),
					sql`NOT (${hasActiveEnvs})`,
					sql`NOT EXISTS (SELECT 1 FROM ${monitoredApplications} child WHERE child.primary_application_id = ${appId})`,
				),
			)
			.returning()
		if (!archived) {
			const [existing] = await tx
				.select()
				.from(monitoredApplications)
				.where(eq(monitoredApplications.id, appId))
				.limit(1)
			if (!existing) throw new Error("Applikasjon ikke funnet")
			if (existing.archivedAt) return existing
			const [linked] = await tx
				.select({ id: monitoredApplications.id })
				.from(monitoredApplications)
				.where(eq(monitoredApplications.primaryApplicationId, appId))
				.limit(1)
			if (linked) throw new Error("Kan ikke arkivere applikasjon med lenkede applikasjoner")
			throw new Error("Kan ikke arkivere applikasjon som finnes på Nais")
		}
		await writeAuditLog(
			{
				action: "application_archived",
				entityType: "monitored_application",
				entityId: appId,
				previousValue: JSON.stringify({ name: archived.name }),
				newValue: JSON.stringify({ name: archived.name, archivedAt: archived.archivedAt }),
				performedBy,
			},
			tx,
		)
		return archived
	})
}

/**
 * Reaktiverer en arkivert applikasjon. Guarded UPDATE + atomisk audit-
 * skriving. Vi SELECT-er først med FOR UPDATE for å låse raden og fange
 * den faktiske `archivedAt`-tidsstemplingen, slik at audit-loggen
 * registrerer når applikasjonen var arkivert (ikke bare at den nå er
 * gjenopprettet).
 */
export async function unarchiveApplication(appId: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(monitoredApplications)
			.where(eq(monitoredApplications.id, appId))
			.for("update")
			.limit(1)
		if (!existing) throw new Error("Applikasjon ikke funnet")
		if (!existing.archivedAt) return existing
		const previousArchivedAt = existing.archivedAt
		const [app] = await tx
			.update(monitoredApplications)
			.set({
				archivedAt: null,
				archivedBy: null,
				updatedAt: new Date(),
				updatedBy: performedBy,
			})
			.where(eq(monitoredApplications.id, appId))
			.returning()
		await writeAuditLog(
			{
				action: "application_unarchived",
				entityType: "monitored_application",
				entityId: appId,
				previousValue: JSON.stringify({ name: app.name, archivedAt: previousArchivedAt }),
				newValue: JSON.stringify({ name: app.name }),
				performedBy,
			},
			tx,
		)
		return app
	})
}
/** Extract base application name by stripping environment suffixes like -q0, -q1, -q2, -q5, -popp etc. */
export function extractBaseName(appName: string): string | null {
	const match = appName.match(/^(.+)-(?:popp|q\d+)$/)
	return match ? match[1] : null
}

export type MatchType = "image_match" | "name_pattern" | "both"

export interface LinkCandidate {
	matchType: MatchType
	confidence: number
	apps: Array<{
		id: string
		name: string
		cluster: string
		isProd: boolean
		alreadyLinked: boolean
	}>
}

/**
 * Finner kandidater for å koble sammen relaterte applikasjoner basert på
 * delte miljøer/navnemønstre. Brukes på koblingsforslag-siden.
 */
export async function findLinkCandidates(): Promise<LinkCandidate[]> {
	// Get all apps with their environments
	const allApps = await db
		.select({
			appId: monitoredApplications.id,
			appName: monitoredApplications.name,
			primaryApplicationId: monitoredApplications.primaryApplicationId,
		})
		.from(monitoredApplications)
		.where(isNull(monitoredApplications.archivedAt))

	const envs = await db
		.select({
			appId: applicationEnvironments.applicationId,
			imageName: applicationEnvironments.imageName,
			cluster: applicationEnvironments.cluster,
		})
		.from(applicationEnvironments)

	// Build app info map
	const appInfo = new Map<
		string,
		{
			name: string
			clusters: string[]
			imageNames: string[]
			primaryApplicationId: string | null
		}
	>()

	for (const app of allApps) {
		appInfo.set(app.appId, {
			name: app.appName,
			clusters: [],
			imageNames: [],
			primaryApplicationId: app.primaryApplicationId,
		})
	}

	for (const env of envs) {
		const info = appInfo.get(env.appId)
		if (!info) continue
		if (env.cluster && !info.clusters.includes(env.cluster)) info.clusters.push(env.cluster)
		if (env.imageName && !info.imageNames.includes(env.imageName)) info.imageNames.push(env.imageName)
	}

	// --- Strategy 1: Image-based matching ---
	const imageGroups = new Map<string, Set<string>>()
	for (const [appId, info] of appInfo) {
		for (const img of info.imageNames) {
			const group = imageGroups.get(img) ?? new Set()
			group.add(appId)
			imageGroups.set(img, group)
		}
	}

	// --- Strategy 2: Name-pattern matching ---
	const nameGroups = new Map<string, Set<string>>()
	for (const [appId, info] of appInfo) {
		const baseName = extractBaseName(info.name)
		if (baseName) {
			// Find the app with the base name
			for (const [otherId, otherInfo] of appInfo) {
				if (otherId === appId) continue
				if (otherInfo.name === baseName) {
					const key = baseName
					const group = nameGroups.get(key) ?? new Set()
					group.add(appId)
					group.add(otherId)
					nameGroups.set(key, group)
				}
			}
		}
	}

	// --- Merge strategies ---
	const candidateMap = new Map<string, LinkCandidate>()

	function makeAppEntry(id: string) {
		const info = appInfo.get(id)
		if (!info) return null
		return {
			id,
			name: info.name,
			cluster: info.clusters[0] ?? "unknown",
			isProd: info.clusters.some((c) => c.startsWith("prod")),
			alreadyLinked: info.primaryApplicationId !== null,
		}
	}

	function candidateKey(appIds: Set<string>) {
		return [...appIds].sort().join(",")
	}

	// Process image-based groups
	for (const [, appIds] of imageGroups) {
		if (appIds.size < 2) continue
		const key = candidateKey(appIds)
		const apps = [...appIds].map(makeAppEntry).filter((a) => a !== null)
		const unlinked = apps.filter((a) => !a.alreadyLinked)
		if (unlinked.length < 2) continue

		candidateMap.set(key, {
			matchType: "image_match",
			confidence: 0.95,
			apps: apps.sort((a, b) => (a.isProd === b.isProd ? 0 : a.isProd ? -1 : 1)),
		})
	}

	// Process name-based groups
	for (const [, appIds] of nameGroups) {
		if (appIds.size < 2) continue
		const key = candidateKey(appIds)
		const existing = candidateMap.get(key)
		if (existing) {
			// Both signals → upgrade to "both"
			existing.matchType = "both"
			existing.confidence = 0.99
		} else {
			const apps = [...appIds].map(makeAppEntry).filter((a) => a !== null)
			const unlinked = apps.filter((a) => !a.alreadyLinked)
			if (unlinked.length < 2) continue

			candidateMap.set(key, {
				matchType: "name_pattern",
				confidence: 0.8,
				apps: apps.sort((a, b) => (a.isProd === b.isProd ? 0 : a.isProd ? -1 : 1)),
			})
		}
	}

	return [...candidateMap.values()].sort((a, b) => b.confidence - a.confidence)
}

/** Get link candidates filtered to apps belonging to a section (via team mappings or Nais team environments).
 * Apps that only exist in excluded/deactivated clusters are filtered out from each candidate's app list. */
export async function getLinkCandidatesForSection(sectionId: string): Promise<LinkCandidate[]> {
	const sectionAppIds = await getSectionAppIds(sectionId)
	if (sectionAppIds.size === 0) return []

	const allCandidates = await findLinkCandidates()

	// Filter to candidates where at least one app belongs to this section
	const sectionCandidates = allCandidates.filter((c) => c.apps.some((a) => sectionAppIds.has(a.id)))
	if (sectionCandidates.length === 0) return []

	// Build set of apps that should be excluded (only exist in excluded clusters)
	const excludedClusters = await getExcludedEnvironments(sectionId)
	if (excludedClusters.size === 0) return sectionCandidates

	// Collect all unique app IDs in these candidates
	const candidateAppIds = [...new Set(sectionCandidates.flatMap((c) => c.apps.map((a) => a.id)))]

	// Find apps that have at least one environment in a NON-excluded cluster,
	// and capture the first active cluster for each app (for display purposes)
	const excludedList = [...excludedClusters]
	const activeAppRows = await db
		.select({ appId: applicationEnvironments.applicationId, cluster: applicationEnvironments.cluster })
		.from(applicationEnvironments)
		.where(
			and(
				inArray(applicationEnvironments.applicationId, candidateAppIds),
				notInArray(applicationEnvironments.cluster, excludedList),
			),
		)

	// Build map: appId → best active cluster (prefer prod-* over others)
	const activeAppIds = new Set(activeAppRows.map((r) => r.appId))
	const bestCluster = new Map<string, string>()
	for (const row of activeAppRows) {
		if (!row.cluster) continue
		const current = bestCluster.get(row.appId)
		if (!current || row.cluster.startsWith("prod")) {
			bestCluster.set(row.appId, row.cluster)
		}
	}

	// Filter each candidate: remove apps with no active environments, update displayed cluster,
	// then drop the candidate if fewer than 2 apps remain
	return sectionCandidates
		.map((c) => ({
			...c,
			apps: c.apps
				.filter((a) => activeAppIds.has(a.id))
				.map((a) => ({ ...a, cluster: bestCluster.get(a.id) ?? a.cluster })),
		}))
		.filter((c) => c.apps.length >= 2)
}

// ─── Link Suggestions ────────────────────────────────────────────────────

/** Persist link candidates as suggestions in the database. Only creates new suggestions, skips existing. */
export async function persistLinkSuggestions(candidates: LinkCandidate[]) {
	let created = 0
	for (const candidate of candidates) {
		const prodApps = candidate.apps.filter((a) => a.isProd)

		// Determine primary: prefer prod, else first app
		const primary = prodApps[0] ?? candidate.apps[0]
		const secondaries = candidate.apps.filter((a) => a.id !== primary.id)

		for (const secondary of secondaries) {
			try {
				await db
					.insert(linkSuggestions)
					.values({
						primaryAppId: primary.id,
						secondaryAppId: secondary.id,
						matchType: candidate.matchType as LinkSuggestionMatchType,
						confidence: String(candidate.confidence),
						status: "pending",
					})
					.onConflictDoNothing()
				created++
			} catch {
				// Ignore constraint violations
			}
		}
	}
	return created
}

/** Get all pending link suggestions. */
export async function getPendingLinkSuggestions() {
	return db
		.select({
			id: linkSuggestions.id,
			primaryAppId: linkSuggestions.primaryAppId,
			primaryAppName: sql<string>`pa.name`,
			secondaryAppId: linkSuggestions.secondaryAppId,
			secondaryAppName: sql<string>`sa.name`,
			matchType: linkSuggestions.matchType,
			confidence: linkSuggestions.confidence,
			status: linkSuggestions.status,
			createdAt: linkSuggestions.createdAt,
		})
		.from(linkSuggestions)
		.innerJoin(sql`monitored_applications pa`, sql`pa.id = ${linkSuggestions.primaryAppId}`)
		.innerJoin(sql`monitored_applications sa`, sql`sa.id = ${linkSuggestions.secondaryAppId}`)
		.where(eq(linkSuggestions.status, "pending"))
		.orderBy(desc(linkSuggestions.createdAt))
}

/** Get pending link suggestions scoped to a section (at least one app belongs to section). */
export async function getPendingLinkSuggestionsForSection(sectionId: string) {
	const sectionAppIds = await getSectionAppIds(sectionId)
	if (sectionAppIds.size === 0) return []

	const all = await getPendingLinkSuggestions()
	return all.filter((s) => sectionAppIds.has(s.primaryAppId) || sectionAppIds.has(s.secondaryAppId))
}

/** Get app IDs belonging to a section via dev team or Nais team mappings.
 * Apps that only exist in excluded/deactivated environments are omitted. */
export async function getSectionAppIds(sectionId: string): Promise<Set<string>> {
	const teamAppRows = await db
		.select({ appId: applicationTeamMappings.applicationId })
		.from(applicationTeamMappings)
		.innerJoin(devTeams, eq(applicationTeamMappings.devTeamId, devTeams.id))
		.where(
			and(eq(devTeams.sectionId, sectionId), isNull(devTeams.archivedAt), isNull(applicationTeamMappings.archivedAt)),
		)

	const sectionNaisTeamRows = await db.select().from(naisTeams).where(eq(naisTeams.sectionId, sectionId))
	const naisTeamIds = sectionNaisTeamRows.map((t) => t.id)

	// Fetch excluded clusters so we only include apps with at least one active environment
	const excludedClusters = await getExcludedEnvironments(sectionId)

	let naisAppRows: Array<{ appId: string }> = []
	if (naisTeamIds.length > 0) {
		const baseQuery = db
			.selectDistinct({ appId: applicationEnvironments.applicationId })
			.from(applicationEnvironments)
			.where(sql`${applicationEnvironments.naisTeamId} IN (${sql.join(naisTeamIds, sql`, `)})`)

		if (excludedClusters.size > 0) {
			const excludedList = [...excludedClusters]
			naisAppRows = await db
				.selectDistinct({ appId: applicationEnvironments.applicationId })
				.from(applicationEnvironments)
				.where(
					and(
						sql`${applicationEnvironments.naisTeamId} IN (${sql.join(naisTeamIds, sql`, `)})`,
						notInArray(applicationEnvironments.cluster, excludedList),
					),
				)
		} else {
			naisAppRows = await baseQuery
		}
	}

	return new Set([...teamAppRows.map((r) => r.appId), ...naisAppRows.map((r) => r.appId)])
}

/** Accept a link suggestion: links the apps and marks suggestion as accepted. */
export async function acceptLinkSuggestion(suggestionId: string, performedBy: string) {
	const [suggestion] = await db.select().from(linkSuggestions).where(eq(linkSuggestions.id, suggestionId)).limit(1)

	if (!suggestion) throw new Error("Forslag ikke funnet")

	// Link the apps
	await linkApplication(suggestion.secondaryAppId, suggestion.primaryAppId, performedBy)

	// Mark as accepted
	await db
		.update(linkSuggestions)
		.set({
			status: "accepted" as LinkSuggestionStatus,
			reviewedBy: performedBy,
			reviewedAt: new Date(),
		})
		.where(eq(linkSuggestions.id, suggestionId))
}

/** Reject a link suggestion. */
export async function rejectLinkSuggestion(suggestionId: string, performedBy: string) {
	await db
		.update(linkSuggestions)
		.set({
			status: "rejected" as LinkSuggestionStatus,
			reviewedBy: performedBy,
			reviewedAt: new Date(),
		})
		.where(eq(linkSuggestions.id, suggestionId))
}

/** Bulk-accept all suggestions above a confidence threshold. */
export async function bulkAcceptLinkSuggestions(minConfidence: number, performedBy: string) {
	const pending = await db
		.select()
		.from(linkSuggestions)
		.where(
			sql`${linkSuggestions.status} = 'pending' AND CAST(${linkSuggestions.confidence} AS REAL) >= ${minConfidence}`,
		)

	let accepted = 0
	for (const s of pending) {
		await acceptLinkSuggestion(s.id, performedBy)
		accepted++
	}
	return accepted
}

/** Create a parent application and link all variant apps to it. Accepts related suggestions. */
export async function createParentAndLinkGroup(
	parentName: string,
	variantAppIds: string[],
	performedBy: string,
): Promise<string> {
	// Create or find the parent application
	const { id: parentId } = await upsertMonitoredApp(parentName, performedBy)

	// Link all variants to the parent
	for (const appId of variantAppIds) {
		if (appId === parentId) continue
		await linkApplication(appId, parentId, performedBy)
	}

	// Accept all pending suggestions involving these apps
	const pending = await db.select().from(linkSuggestions).where(eq(linkSuggestions.status, "pending"))
	const variantSet = new Set(variantAppIds)
	for (const s of pending) {
		if (variantSet.has(s.primaryAppId) && variantSet.has(s.secondaryAppId)) {
			await db
				.update(linkSuggestions)
				.set({
					status: "accepted" as LinkSuggestionStatus,
					reviewedBy: performedBy,
					reviewedAt: new Date(),
				})
				.where(eq(linkSuggestions.id, s.id))
		}
	}

	return parentId
}

/** Accept all pending suggestions where both apps are in the given set. */
export async function acceptRelatedSuggestions(appIds: string[], performedBy: string) {
	const pending = await db.select().from(linkSuggestions).where(eq(linkSuggestions.status, "pending"))
	const appSet = new Set(appIds)
	for (const s of pending) {
		if (appSet.has(s.primaryAppId) && appSet.has(s.secondaryAppId)) {
			await db
				.update(linkSuggestions)
				.set({
					status: "accepted" as LinkSuggestionStatus,
					reviewedBy: performedBy,
					reviewedAt: new Date(),
				})
				.where(eq(linkSuggestions.id, s.id))
		}
	}
}

export type AppResolution = { status: "monitored"; appId: string } | { status: "discovered" } | { status: "unknown" }

/** Look up app names: first in monitoredApplications (monitored), then naisDiscoveredApps (discovered), else unknown. */
export async function resolveAppNames(names: string[]): Promise<Record<string, AppResolution>> {
	if (names.length === 0) return {}
	const result: Record<string, AppResolution> = {}

	// Step 1: Check monitored applications
	const monitored = await db
		.select({ id: monitoredApplications.id, name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(inArray(monitoredApplications.name, names))
	for (const row of monitored) {
		result[row.name] = { status: "monitored", appId: row.id }
	}

	// Step 2: Check nais discovered apps for remaining names
	const remaining = names.filter((n) => !result[n])
	if (remaining.length > 0) {
		const discovered = await db
			.select({ name: naisDiscoveredApps.name })
			.from(naisDiscoveredApps)
			.where(and(inArray(naisDiscoveredApps.name, remaining), isNull(naisDiscoveredApps.archivedAt)))
		for (const row of discovered) {
			if (!result[row.name]) {
				result[row.name] = { status: "discovered" }
			}
		}
	}

	// Step 3: Mark remaining as unknown
	for (const name of names) {
		if (!result[name]) {
			result[name] = { status: "unknown" }
		}
	}

	return result
}

/** Synkroniser access policy-regler for en applikasjon og retning.
 *
 * Tidligere ble alle eksisterende regler hard-slettet og deretter re-insertet.
 * Det betydde at vi mistet sporbarhet på når regler dukket opp og forsvant.
 * Nå utfører vi en eksplisitt diff: regler som ikke lenger finnes arkiveres
 * (soft-delete med archived_at/archived_by), og helt nye regler legges til.
 * Eksisterende aktive regler som fortsatt er rapportert beholdes som de er.
 *
 * Hele operasjonen og tilhørende audit-logging skjer i samme transaksjon.
 * Concurrency håndteres av advisory-låsen `nais-sync-apps-{teamSlug}` på
 * caller-siden, slik at to podder ikke kjører dette samtidig per team.
 */
export async function upsertAccessPolicyRules(
	applicationId: string,
	direction: "inbound" | "outbound",
	rules: Array<{ application: string; namespace?: string; cluster?: string }>,
	performedBy = "nais-sync",
) {
	// Dedupliser inputregler — samme app kan dukke opp i flere miljø-snapshots.
	const seen = new Set<string>()
	const uniqueRules = rules.filter((rule) => {
		const key = `${rule.application}|${rule.namespace ?? ""}|${rule.cluster ?? ""}`
		if (seen.has(key)) return false
		seen.add(key)
		return true
	})

	await db.transaction(async (tx) => {
		const existing = await tx
			.select()
			.from(applicationAccessPolicyRules)
			.where(
				and(
					eq(applicationAccessPolicyRules.applicationId, applicationId),
					eq(applicationAccessPolicyRules.direction, direction),
					isNull(applicationAccessPolicyRules.archivedAt),
				),
			)

		const keyOf = (r: { ruleApplication: string; ruleNamespace: string | null; ruleCluster: string | null }) =>
			`${r.ruleApplication}|${r.ruleNamespace ?? ""}|${r.ruleCluster ?? ""}`

		const existingByKey = new Map(existing.map((row) => [keyOf(row), row]))
		const desiredKeys = new Set<string>()

		const toInsert: Array<{
			applicationId: string
			direction: "inbound" | "outbound"
			ruleApplication: string
			ruleNamespace: string | null
			ruleCluster: string | null
		}> = []

		for (const rule of uniqueRules) {
			const ruleNamespace = rule.namespace ?? null
			const ruleCluster = rule.cluster ?? null
			const key = `${rule.application}|${ruleNamespace ?? ""}|${ruleCluster ?? ""}`
			desiredKeys.add(key)
			if (!existingByKey.has(key)) {
				toInsert.push({
					applicationId,
					direction,
					ruleApplication: rule.application,
					ruleNamespace,
					ruleCluster,
				})
			}
		}

		const toArchive = existing.filter((row) => !desiredKeys.has(keyOf(row)))

		if (toArchive.length > 0 || toInsert.length > 0) {
			logger.info("[access-policy-sync] Rule diff detected", {
				sync_component: "access_policy_rules",
				applicationId,
				direction,
				existingCount: existing.length,
				desiredCount: uniqueRules.length,
				toArchiveCount: toArchive.length,
				toInsertCount: toInsert.length,
				toArchiveKeys: toArchive.map((r) => keyOf(r)),
				toInsertKeys: toInsert.map((r) => `${r.ruleApplication}|${r.ruleNamespace ?? ""}|${r.ruleCluster ?? ""}`),
			})
		}

		for (const row of toArchive) {
			await tx
				.update(applicationAccessPolicyRules)
				.set({ archivedAt: new Date(), archivedBy: performedBy, updatedAt: new Date() })
				.where(eq(applicationAccessPolicyRules.id, row.id))

			await writeAuditLog(
				{
					action: "access_policy_rule_removed",
					entityType: "application",
					entityId: applicationId,
					previousValue: JSON.stringify({
						direction,
						ruleApplication: row.ruleApplication,
						ruleNamespace: row.ruleNamespace,
						ruleCluster: row.ruleCluster,
					}),
					performedBy,
				},
				tx,
			)
		}

		if (toInsert.length > 0) {
			const inserted = await tx.insert(applicationAccessPolicyRules).values(toInsert).returning()
			for (const row of inserted) {
				await writeAuditLog(
					{
						action: "access_policy_rule_added",
						entityType: "application",
						entityId: applicationId,
						newValue: JSON.stringify({
							direction,
							ruleApplication: row.ruleApplication,
							ruleNamespace: row.ruleNamespace,
							ruleCluster: row.ruleCluster,
						}),
						performedBy,
					},
					tx,
				)
			}
		}
	})
}

/** Get all active (non-archived) access policy rules for an application. */
export async function getAccessPolicyRules(applicationId: string) {
	return db
		.select()
		.from(applicationAccessPolicyRules)
		.where(
			and(
				eq(applicationAccessPolicyRules.applicationId, applicationId),
				isNull(applicationAccessPolicyRules.archivedAt),
			),
		)
		.orderBy(applicationAccessPolicyRules.direction, applicationAccessPolicyRules.ruleApplication)
}

export interface AccessPolicyAcknowledgment {
	id: string
	ruleApplication: string
	comment: string
	acknowledgedBy: string
	acknowledgedAt: Date
}

/** Acknowledge an unknown app in the access policy. */
export async function acknowledgeUnknownApp(
	applicationId: string,
	ruleApplication: string,
	comment: string,
	user: string,
) {
	const [row] = await db
		.insert(accessPolicyAcknowledgments)
		.values({ applicationId, ruleApplication, comment, acknowledgedBy: user })
		.returning()
	return row
}

/** Revoke an existing acknowledgment for an unknown app. */
export async function revokeAcknowledgment(applicationId: string, ruleApplication: string, user: string) {
	await db
		.update(accessPolicyAcknowledgments)
		.set({ revokedAt: new Date(), revokedBy: user })
		.where(
			and(
				eq(accessPolicyAcknowledgments.applicationId, applicationId),
				eq(accessPolicyAcknowledgments.ruleApplication, ruleApplication),
				isNull(accessPolicyAcknowledgments.revokedAt),
			),
		)
}

/** Get all active (non-revoked) acknowledgments for an application. */
export async function getActiveAcknowledgments(applicationId: string): Promise<AccessPolicyAcknowledgment[]> {
	return db
		.select({
			id: accessPolicyAcknowledgments.id,
			ruleApplication: accessPolicyAcknowledgments.ruleApplication,
			comment: accessPolicyAcknowledgments.comment,
			acknowledgedBy: accessPolicyAcknowledgments.acknowledgedBy,
			acknowledgedAt: accessPolicyAcknowledgments.acknowledgedAt,
		})
		.from(accessPolicyAcknowledgments)
		.where(
			and(eq(accessPolicyAcknowledgments.applicationId, applicationId), isNull(accessPolicyAcknowledgments.revokedAt)),
		)
}

/**
 * Legger til en manuell persistens-oppføring (kun for typer som ikke
 * automatisk oppdages fra Nais). Skriver audit-logg.
 *
 * Hvis det finnes en arkivert manuell rad med samme `applicationId + type +
 * name`, reaktiveres den i stedet for å opprette duplikat (audit-logges som
 * `persistence_unarchived`).
 */
export async function addManualPersistence(
	applicationId: string,
	type: PersistenceType,
	name: string,
	dataClassification: DataClassification | null,
	performedBy: string,
) {
	return db.transaction(async (tx) => {
		// Søk på (appId, type, name) uten å filtrere på manuallyAdded — slik
		// at vi konsistent kan oppdage at en aktiv rad allerede finnes (også
		// når den ble opprettet via Nais-sync). Den partial unique-indeksen
		// `application_persistence_active_unique_idx` ville uansett blokkert
		// duplikat innsetting; vi gir heller en kontrollert feilmelding.
		const [existing] = await tx
			.select()
			.from(applicationPersistence)
			.where(
				and(
					eq(applicationPersistence.applicationId, applicationId),
					eq(applicationPersistence.type, type),
					eq(applicationPersistence.name, name),
				),
			)
			.orderBy(sql`${applicationPersistence.archivedAt} NULLS FIRST`, applicationPersistence.discoveredAt)
			.for("update")
			.limit(1)

		if (existing && !existing.archivedAt) {
			throw new Error(
				"Det finnes allerede en aktiv persistens-oppføring med samme type og navn for denne applikasjonen",
			)
		}

		if (existing?.archivedAt) {
			const previousArchivedAt = existing.archivedAt
			const [restored] = await tx
				.update(applicationPersistence)
				.set({
					archivedAt: null,
					archivedBy: null,
					dataClassification,
					manuallyAdded: true,
					updatedAt: new Date(),
				})
				.where(eq(applicationPersistence.id, existing.id))
				.returning()

			await writeAuditLog(
				{
					action: "persistence_unarchived",
					entityType: "application_persistence",
					entityId: existing.id,
					previousValue: JSON.stringify({ type, name, archivedAt: previousArchivedAt }),
					newValue: JSON.stringify({ type, name, dataClassification }),
					metadata: { applicationId, reason: "manual_re_add" },
					performedBy,
				},
				tx,
			)
			return restored
		}

		const [inserted] = await tx
			.insert(applicationPersistence)
			.values({
				applicationId,
				type,
				name,
				dataClassification,
				manuallyAdded: true,
			})
			.returning()

		await writeAuditLog(
			{
				action: "persistence_added",
				entityType: "application_persistence",
				entityId: inserted.id,
				newValue: JSON.stringify({ type, name, dataClassification }),
				metadata: { applicationId },
				performedBy,
			},
			tx,
		)

		return inserted
	})
}

export async function updatePersistenceClassification(
	persistenceId: string,
	classification: DataClassification | null,
	performedBy: string,
) {
	return db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(applicationPersistence)
			.where(eq(applicationPersistence.id, persistenceId))
			.for("update")
			.limit(1)

		if (!existing) throw new Error("Persistens-oppføring ikke funnet")
		if (existing.archivedAt) throw new Error("Kan ikke endre arkivert persistens-oppføring")

		await tx
			.update(applicationPersistence)
			.set({ dataClassification: classification, updatedAt: new Date() })
			.where(eq(applicationPersistence.id, persistenceId))

		await writeAuditLog(
			{
				action: "persistence_updated",
				entityType: "application_persistence",
				entityId: persistenceId,
				previousValue: JSON.stringify({ dataClassification: existing.dataClassification }),
				newValue: JSON.stringify({ dataClassification: classification }),
				metadata: { applicationId: existing.applicationId, name: existing.name },
				performedBy,
			},
			tx,
		)
	})
}

/**
 * Arkiverer en manuelt opprettet persistens-oppføring. Kun rader med
 * `manuallyAdded = true` kan arkiveres herfra — Nais-detekterte rader vil
 * uansett dukke opp igjen ved neste sync, og må fjernes ved kilden.
 *
 * Idempotent: returnerer eksisterende rad uten å skrive audit hvis allerede
 * arkivert. Atomisk guarded UPDATE i transaksjon, audit i samme tx.
 */
export async function archiveManualPersistence(persistenceId: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [archived] = await tx
			.update(applicationPersistence)
			.set({ archivedAt: new Date(), archivedBy: performedBy, updatedAt: new Date() })
			.where(
				and(
					eq(applicationPersistence.id, persistenceId),
					eq(applicationPersistence.manuallyAdded, true),
					isNull(applicationPersistence.archivedAt),
				),
			)
			.returning()

		if (!archived) {
			const [existing] = await tx
				.select()
				.from(applicationPersistence)
				.where(eq(applicationPersistence.id, persistenceId))
				.limit(1)
			if (!existing) throw new Error("Persistens-oppføring ikke funnet")
			if (!existing.manuallyAdded) throw new Error("Kan bare arkivere manuelt lagt til databaser")
			if (existing.archivedAt) return existing
			throw new Error("Kunne ikke arkivere persistens-oppføring")
		}

		await writeAuditLog(
			{
				action: "persistence_archived",
				entityType: "application_persistence",
				entityId: persistenceId,
				previousValue: JSON.stringify({
					type: archived.type,
					name: archived.name,
					dataClassification: archived.dataClassification,
				}),
				newValue: JSON.stringify({
					type: archived.type,
					name: archived.name,
					archivedAt: archived.archivedAt,
				}),
				metadata: { applicationId: archived.applicationId },
				performedBy,
			},
			tx,
		)

		return archived
	})
}

/**
 * Reaktiverer en arkivert manuell persistens-oppføring. SELECT FOR UPDATE
 * for å fange `archivedAt` i audit-loggen før vi nullstiller.
 */
export async function unarchiveManualPersistence(persistenceId: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(applicationPersistence)
			.where(eq(applicationPersistence.id, persistenceId))
			.for("update")
			.limit(1)

		if (!existing) throw new Error("Persistens-oppføring ikke funnet")
		if (!existing.manuallyAdded) throw new Error("Kan bare reaktivere manuelt lagt til databaser")
		if (!existing.archivedAt) return existing

		const previousArchivedAt = existing.archivedAt
		const [restored] = await tx
			.update(applicationPersistence)
			.set({ archivedAt: null, archivedBy: null, updatedAt: new Date() })
			.where(eq(applicationPersistence.id, persistenceId))
			.returning()

		await writeAuditLog(
			{
				action: "persistence_unarchived",
				entityType: "application_persistence",
				entityId: persistenceId,
				previousValue: JSON.stringify({
					type: restored.type,
					name: restored.name,
					archivedAt: previousArchivedAt,
				}),
				newValue: JSON.stringify({ type: restored.type, name: restored.name }),
				metadata: { applicationId: restored.applicationId },
				performedBy,
			},
			tx,
		)

		return restored
	})
}

/**
 * @deprecated Bruk `archiveManualPersistence` i stedet — denne funksjonen
 * arkiverer nå raden i stedet for å hard-slette den, slik at audit-historikk
 * og innkommende FK-er (audit-summaries/-confirmations) bevares.
 */
export async function deleteManualPersistence(persistenceId: string, performedBy: string) {
	return archiveManualPersistence(persistenceId, performedBy)
}

// ─── Manual Groups ───────────────────────────────────────────────────────

/** Get manually added groups for an application. */
export async function getManualGroupsForApp(applicationId: string) {
	return db
		.select()
		.from(applicationManualGroups)
		.where(and(eq(applicationManualGroups.applicationId, applicationId), isNull(applicationManualGroups.archivedAt)))
		.orderBy(applicationManualGroups.createdAt)
}

/** Add a manual group to an application.
 *
 * Hvis gruppen finnes som arkivert tidligere kobling, lar vi den arkiverte raden
 * ligge for historikkens skyld og setter inn en ny aktiv rad. Den partielle
 * unike indeksen tillater dette så lenge det aldri er to aktive samtidig.
 *
 * Wrappet i transaksjon med audit som del av samme tx for atomisitet. Hvis
 * INSERT-konflikten gjelder en aktiv rad og en samtidig `removeManualGroup`
 * arkiverer den i et race, gjør vi en eksplisitt SELECT på aktiv rad og
 * kaster concurrency-feil hvis ingen finnes — slik at en reell "add" aldri
 * forsvinner stille.
 */
export async function addManualGroup(
	applicationId: string,
	groupId: string,
	groupName: string | null,
	performedBy: string,
) {
	return db.transaction(async (tx) => {
		const [inserted] = await tx
			.insert(applicationManualGroups)
			.values({ applicationId, groupId, groupName, createdBy: performedBy })
			.onConflictDoNothing({
				target: [applicationManualGroups.applicationId, applicationManualGroups.groupId],
				where: isNull(applicationManualGroups.archivedAt),
			})
			.returning()

		if (inserted) {
			await writeAuditLog(
				{
					action: "manual_group_added",
					entityType: "application",
					entityId: applicationId,
					newValue: JSON.stringify({ groupId, groupName }),
					performedBy,
				},
				tx,
			)
			return inserted
		}

		// Konflikt: enten finnes det en eksisterende aktiv rad (idempotent
		// no-op), eller raden ble arkivert i et race. Sjekk eksplisitt.
		const [existing] = await tx
			.select()
			.from(applicationManualGroups)
			.where(
				and(
					eq(applicationManualGroups.applicationId, applicationId),
					eq(applicationManualGroups.groupId, groupId),
					isNull(applicationManualGroups.archivedAt),
				),
			)
			.limit(1)

		if (!existing) {
			throw new Error("Kunne ikke legge til manuell gruppe pga. samtidig endring. Prøv igjen.")
		}
		return existing
	})
}

/** Archive (soft-delete) a manual group from an application.
 *
 * Tidligere ble raden hard-slettet. Nå arkiverer vi den slik at vi bevarer
 * sporbarhet på hvilke grupper applikasjonen har vært klassifisert med.
 * Wrappet i transaksjon med audit som del av samme tx for atomisitet —
 * hvis audit-skriving feiler rulles arkiveringen tilbake.
 */
export async function removeManualGroup(id: string, applicationId: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [archived] = await tx
			.update(applicationManualGroups)
			.set({ archivedAt: new Date(), archivedBy: performedBy })
			.where(
				and(
					eq(applicationManualGroups.id, id),
					eq(applicationManualGroups.applicationId, applicationId),
					isNull(applicationManualGroups.archivedAt),
				),
			)
			.returning()

		if (!archived) return null

		await writeAuditLog(
			{
				action: "manual_group_removed",
				entityType: "application",
				entityId: applicationId,
				previousValue: JSON.stringify({ groupId: archived.groupId, groupName: archived.groupName }),
				performedBy,
			},
			tx,
		)

		return archived
	})
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
			.where(and(inArray(applicationTeamMappings.devTeamId, teamIds), isNull(applicationTeamMappings.archivedAt)))
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
		.where(and(inArray(applicationManualGroups.applicationId, appIds), isNull(applicationManualGroups.archivedAt)))

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
			.where(and(inArray(entraGroupClassifications.groupId, allGroupIds), isNull(entraGroupClassifications.archivedAt)))
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

/** Set or update the access classification for a group.
 *
 * Wrappet i transaksjon med audit som del av samme tx for atomisitet.
 * - Hvis det allerede finnes en aktiv rad med samme klassifisering: idempotent
 *   no-op (ingen audit, returnerer eksisterende rad).
 * - Hvis det finnes en aktiv rad med annen klassifisering: oppdaterer raden
 *   og logger `group_classification_updated`.
 * - Hvis ingen aktiv rad finnes: oppretter ny og logger
 *   `entra_group_classification_created`.
 */
export async function upsertGroupClassification(
	groupId: string,
	classification: GroupAccessClassification,
	performedBy: string,
) {
	return db.transaction(async (tx) => {
		const existing = await tx
			.select()
			.from(entraGroupClassifications)
			.where(and(eq(entraGroupClassifications.groupId, groupId), isNull(entraGroupClassifications.archivedAt)))
			.then((rows) => rows[0] ?? null)

		if (existing) {
			if (existing.classification === classification) {
				return existing
			}

			const [updated] = await tx
				.update(entraGroupClassifications)
				.set({ classification, updatedBy: performedBy, updatedAt: new Date() })
				.where(
					and(
						eq(entraGroupClassifications.id, existing.id),
						eq(entraGroupClassifications.groupId, groupId),
						isNull(entraGroupClassifications.archivedAt),
					),
				)
				.returning()

			if (!updated) {
				throw new Error("Kunne ikke oppdatere gruppeklassifisering pga. samtidig endring. Prøv igjen.")
			}

			await writeAuditLog(
				{
					action: "group_classification_updated",
					entityType: "entra_group",
					entityId: groupId,
					previousValue: JSON.stringify({ classification: existing.classification }),
					newValue: JSON.stringify({ classification }),
					performedBy,
				},
				tx,
			)

			return updated
		}

		const [inserted] = await tx
			.insert(entraGroupClassifications)
			.values({
				groupId,
				classification,
				createdBy: performedBy,
				updatedBy: performedBy,
			})
			.onConflictDoNothing({
				target: entraGroupClassifications.groupId,
				where: isNull(entraGroupClassifications.archivedAt),
			})
			.returning()

		if (inserted) {
			await writeAuditLog(
				{
					action: "entra_group_classification_created",
					entityType: "entra_group",
					entityId: groupId,
					newValue: JSON.stringify({ classification }),
					performedBy,
				},
				tx,
			)
			return inserted
		}

		// Race: en annen pod opprettet eller arkiverte en rad mellom SELECT og INSERT.
		const [raceRow] = await tx
			.select()
			.from(entraGroupClassifications)
			.where(and(eq(entraGroupClassifications.groupId, groupId), isNull(entraGroupClassifications.archivedAt)))
			.limit(1)

		if (!raceRow) {
			throw new Error("Kunne ikke opprette gruppeklassifisering pga. samtidig endring. Prøv igjen.")
		}

		// Race-vinneren kan ha opprettet raden med en annen klassifisering enn vi
		// ba om. Siden funksjonen er en upsert, skal vi konvergere mot ønsket
		// verdi: oppdater raden til riktig classification og logg en update.
		if (raceRow.classification !== classification) {
			const [updated] = await tx
				.update(entraGroupClassifications)
				.set({ classification, updatedBy: performedBy, updatedAt: new Date() })
				.where(
					and(
						eq(entraGroupClassifications.id, raceRow.id),
						eq(entraGroupClassifications.groupId, groupId),
						isNull(entraGroupClassifications.archivedAt),
					),
				)
				.returning()

			if (!updated) {
				throw new Error("Kunne ikke oppdatere gruppeklassifisering pga. samtidig endring. Prøv igjen.")
			}

			await writeAuditLog(
				{
					action: "group_classification_updated",
					entityType: "entra_group",
					entityId: groupId,
					previousValue: JSON.stringify({ classification: raceRow.classification }),
					newValue: JSON.stringify({ classification }),
					performedBy,
				},
				tx,
			)

			return updated
		}

		return raceRow
	})
}

/** Arkiverer (soft-delete) klassifiseringen for en Entra-gruppe.
 *
 * Tidligere ble raden hard-slettet. Nå arkiverer vi den slik at vi bevarer
 * sporbarhet på hvilke klassifiseringer en gruppe har vært satt til.
 * Wrappet i transaksjon med audit som del av samme tx — hvis audit-skriving
 * feiler rulles arkiveringen tilbake. Idempotent: andre kall returnerer null
 * og skriver ingen audit.
 */
export async function deleteGroupClassification(groupId: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [archived] = await tx
			.update(entraGroupClassifications)
			.set({ archivedAt: new Date(), archivedBy: performedBy, updatedAt: new Date(), updatedBy: performedBy })
			.where(and(eq(entraGroupClassifications.groupId, groupId), isNull(entraGroupClassifications.archivedAt)))
			.returning()

		if (!archived) return null

		await writeAuditLog(
			{
				action: "entra_group_classification_archived",
				entityType: "entra_group",
				entityId: groupId,
				previousValue: JSON.stringify({ classification: archived.classification }),
				performedBy,
			},
			tx,
		)

		return archived
	})
}
