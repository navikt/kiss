import { and, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm"
import { db } from "../connection.server"
import {
	applicationEnvironments,
	applicationTeamMappings,
	monitoredApplications,
	naisTeams,
} from "../schema/applications"
import {
	applicationTechnologyElements,
	controlPredefinedAnswers,
	controlTechnologyElements,
	frameworkControls,
	frameworkDomains,
	frameworkRiskControlMappings,
	frameworkRisks,
	technologyElements,
} from "../schema/framework"
import { devTeams, sectionEnvironments } from "../schema/organization"
import { writeAuditLog } from "./audit.server"
import { getScreeningDerivedControlIds } from "./screening.server"

/** Search applications while excluding auto-discovered apps that only exist in deactivated environments. */
export async function searchApplications(query: string, limit = 200) {
	const pattern = `%${query}%`

	const hasVisibleNaisEnvironment = sql`EXISTS (
		SELECT 1 FROM ${applicationEnvironments} ae
		LEFT JOIN ${naisTeams} nt ON nt.id = ae.nais_team_id
		WHERE ae.application_id = ${monitoredApplications.id}
		AND (
			nt.section_id IS NULL
			OR NOT EXISTS (
				SELECT 1 FROM ${sectionEnvironments} se
				WHERE se.section_id = nt.section_id
				AND se.cluster = ae.cluster
				AND se.included = false
			)
		)
	)`

	const hasActiveTeamMapping = sql`EXISTS (
		SELECT 1 FROM ${applicationTeamMappings} atm
		INNER JOIN ${devTeams} dt ON dt.id = atm.dev_team_id
		WHERE atm.application_id = ${monitoredApplications.id}
		AND atm.archived_at IS NULL
		AND dt.archived_at IS NULL
	)`

	return db
		.select({
			id: monitoredApplications.id,
			name: monitoredApplications.name,
			description: monitoredApplications.description,
		})
		.from(monitoredApplications)
		.where(
			and(
				isNull(monitoredApplications.archivedAt),
				isNull(monitoredApplications.primaryApplicationId),
				or(
					eq(monitoredApplications.addedManually, true),
					sql`${hasVisibleNaisEnvironment}`,
					sql`${hasActiveTeamMapping}`,
				),
				or(ilike(monitoredApplications.name, pattern), ilike(monitoredApplications.description, pattern)),
			),
		)
		.limit(limit)
}

/** Get all monitored applications with compliance summary (excludes linked/child apps and archived). */
export async function getApplications() {
	const apps = await db
		.select()
		.from(monitoredApplications)
		.where(and(isNull(monitoredApplications.primaryApplicationId), isNull(monitoredApplications.archivedAt)))
		.orderBy(monitoredApplications.name)

	const appIds = apps.map((a) => a.id)
	if (appIds.length === 0) return []

	const { getComplianceSummaries } = await import("./application-controls.server")

	// Batch: linked (child) apps for all primary apps
	const [childApps, allTeamMappings, complianceSummaries] = await Promise.all([
		db
			.select({
				id: monitoredApplications.id,
				name: monitoredApplications.name,
				primaryApplicationId: monitoredApplications.primaryApplicationId,
			})
			.from(monitoredApplications)
			.where(
				and(
					isNotNull(monitoredApplications.primaryApplicationId),
					inArray(monitoredApplications.primaryApplicationId, appIds),
					isNull(monitoredApplications.archivedAt),
				),
			)
			.orderBy(monitoredApplications.name),
		db
			.select({
				applicationId: applicationTeamMappings.applicationId,
				teamSlug: devTeams.slug,
			})
			.from(applicationTeamMappings)
			.innerJoin(devTeams, eq(applicationTeamMappings.devTeamId, devTeams.id))
			.where(and(inArray(applicationTeamMappings.applicationId, appIds), isNull(applicationTeamMappings.archivedAt))),
		getComplianceSummaries(appIds),
	])

	const childrenByParent = new Map<string, Array<{ id: string; name: string }>>()
	for (const child of childApps) {
		if (!child.primaryApplicationId) continue
		const list = childrenByParent.get(child.primaryApplicationId) ?? []
		list.push({ id: child.id, name: child.name })
		childrenByParent.set(child.primaryApplicationId, list)
	}

	const teamsByApp = new Map<string, string[]>()
	for (const row of allTeamMappings) {
		const teams = teamsByApp.get(row.applicationId) ?? []
		teams.push(row.teamSlug)
		teamsByApp.set(row.applicationId, teams)
	}

	return apps.map((app) => {
		const assessmentAppId = app.primaryApplicationId ?? app.id
		const summary = complianceSummaries.get(assessmentAppId) ?? {
			implemented: 0,
			partial: 0,
			notImplemented: 0,
			notRelevant: 0,
			total: 0,
		}
		return {
			id: app.id,
			name: app.name,
			teams: teamsByApp.get(app.id) ?? [],
			controlsImplemented: summary.implemented,
			controlsPartial: summary.partial,
			controlsNotImplemented: summary.notImplemented,
			controlsNotRelevant: summary.notRelevant,
			controlsTotal: summary.total,
			linkedApps: childrenByParent.get(app.id) ?? [],
		}
	})
}

/**
 * Link an application to a dev team. TOCTOU-safe: dev-team-raden låses med
 * `SELECT ... FOR SHARE` slik at en samtidig `archiveTeam` ikke kan committe
 * mellom guard og INSERT. Bruker partial unique index
 * `uq_app_team_mapping_active` slik at samtidige duplikat-link-kall
 * resolves race-fritt via `onConflictDoNothing`. INSERT og audit-skriving
 * kjører i samme transaksjon (AGENTS.md regel 6). Hvis den (application_id,
 * dev_team_id)-paren tidligere er arkivert, opprettes en ny aktiv rad — den
 * arkiverte raden beholdes som historikk.
 */
export async function linkAppToTeam(applicationId: string, devTeamId: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [team] = await tx
			.select({ id: devTeams.id, name: devTeams.name, archivedAt: devTeams.archivedAt })
			.from(devTeams)
			.where(eq(devTeams.id, devTeamId))
			.limit(1)
			.for("share")
		if (!team) throw new Error(`Dev-team med id ${devTeamId} finnes ikke`)
		if (team.archivedAt) throw new Error(`Dev-team med id ${devTeamId} er arkivert`)

		const inserted = await tx
			.insert(applicationTeamMappings)
			.values({ applicationId, devTeamId, createdBy: performedBy })
			.onConflictDoNothing({
				target: [applicationTeamMappings.applicationId, applicationTeamMappings.devTeamId],
				where: isNull(applicationTeamMappings.archivedAt),
			})
			.returning()
		if (inserted.length === 0) {
			// Eksisterende aktiv link — idempotent no-op, ingen audit. I et
			// sjeldent race der en samtidig unlink arkiverer raden mellom
			// INSERT og SELECT, kan fallback returnere null; behandle det
			// som concurrency-feil i stedet for stille suksess.
			const [existing] = await tx
				.select()
				.from(applicationTeamMappings)
				.where(
					and(
						eq(applicationTeamMappings.applicationId, applicationId),
						eq(applicationTeamMappings.devTeamId, devTeamId),
						isNull(applicationTeamMappings.archivedAt),
					),
				)
				.limit(1)
			if (!existing) {
				throw new Error("Kunne ikke koble applikasjonen til teamet pga. samtidig endring. Prøv igjen.")
			}
			return existing
		}
		const [mapping] = inserted

		const [app] = await tx.select().from(monitoredApplications).where(eq(monitoredApplications.id, applicationId))

		await writeAuditLog(
			{
				action: "app_team_linked",
				entityType: "application_team_mapping",
				entityId: mapping.id,
				newValue: `${app?.name ?? applicationId} ↔ ${team.name}`,
				metadata: { applicationId, devTeamId },
				performedBy,
			},
			tx,
		)

		return mapping
	})
}

/**
 * Unlink an application from a dev team (soft-delete). Transaksjonell og
 * idempotent: audit skrives kun når en aktiv rad faktisk ble arkivert.
 */
export async function unlinkAppFromTeam(applicationId: string, devTeamId: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [archived] = await tx
			.update(applicationTeamMappings)
			.set({ archivedAt: new Date(), archivedBy: performedBy })
			.where(
				and(
					eq(applicationTeamMappings.applicationId, applicationId),
					eq(applicationTeamMappings.devTeamId, devTeamId),
					isNull(applicationTeamMappings.archivedAt),
				),
			)
			.returning({ id: applicationTeamMappings.id })

		if (!archived) return

		const [app] = await tx.select().from(monitoredApplications).where(eq(monitoredApplications.id, applicationId))
		const [team] = await tx.select().from(devTeams).where(eq(devTeams.id, devTeamId))

		await writeAuditLog(
			{
				action: "app_team_unlinked",
				entityType: "application_team_mapping",
				entityId: archived.id,
				previousValue: `${app?.name ?? applicationId} ↔ ${team?.name ?? devTeamId}`,
				metadata: { applicationId, devTeamId },
				performedBy,
			},
			tx,
		)
	})
}

/** Get applications NOT yet linked to a specific team (excludes linked/child apps). */
export async function getAvailableAppsForTeam(devTeamId: string) {
	const linkedAppIds = db
		.select({ applicationId: applicationTeamMappings.applicationId })
		.from(applicationTeamMappings)
		.where(and(eq(applicationTeamMappings.devTeamId, devTeamId), isNull(applicationTeamMappings.archivedAt)))

	return db
		.select({ id: monitoredApplications.id, name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(
			and(
				isNull(monitoredApplications.primaryApplicationId),
				isNull(monitoredApplications.archivedAt),
				sql`${monitoredApplications.id} NOT IN (${linkedAppIds})`,
			),
		)
		.orderBy(monitoredApplications.name)
}

/** Get dev team IDs and section IDs for an application — used for authorization checks.
 * Section IDs are derived from both dev-team mappings and NAIS-team environments. */
export async function getAppScopeIds(appId: string): Promise<{ devTeamIds: string[]; sectionIds: string[] }> {
	const [devTeamRows, naisTeamRows] = await Promise.all([
		db
			.select({ devTeamId: devTeams.id, sectionId: devTeams.sectionId })
			.from(applicationTeamMappings)
			.innerJoin(devTeams, eq(applicationTeamMappings.devTeamId, devTeams.id))
			.where(and(eq(applicationTeamMappings.applicationId, appId), isNull(applicationTeamMappings.archivedAt))),
		db
			.select({ sectionId: naisTeams.sectionId })
			.from(applicationEnvironments)
			.innerJoin(naisTeams, eq(applicationEnvironments.naisTeamId, naisTeams.id))
			.where(eq(applicationEnvironments.applicationId, appId)),
	])

	const devTeamIds = devTeamRows.map((r) => r.devTeamId)
	const allSectionIds = [...devTeamRows.map((r) => r.sectionId), ...naisTeamRows.map((r) => r.sectionId)]
	const sectionIds = [...new Set(allSectionIds.filter((s): s is string => s !== null))]
	return { devTeamIds, sectionIds }
}

/** Get teams NOT yet linked to a specific application. */
export async function getAvailableTeamsForApp(applicationId: string) {
	const linkedTeamIds = db
		.select({ devTeamId: applicationTeamMappings.devTeamId })
		.from(applicationTeamMappings)
		.where(and(eq(applicationTeamMappings.applicationId, applicationId), isNull(applicationTeamMappings.archivedAt)))

	return db
		.select({ id: devTeams.id, name: devTeams.name })
		.from(devTeams)
		.where(and(isNull(devTeams.archivedAt), sql`${devTeams.id} NOT IN (${linkedTeamIds})`))
		.orderBy(devTeams.name)
}

/** Get all dev teams. By default only active (non-archived) teams are returned. */
export async function getAllTeams(options: { includeArchived?: boolean } = {}) {
	const query = db
		.select({ id: devTeams.id, name: devTeams.name, slug: devTeams.slug, sectionId: devTeams.sectionId })
		.from(devTeams)
	if (!options.includeArchived) {
		return query.where(isNull(devTeams.archivedAt)).orderBy(devTeams.name)
	}
	return query.orderBy(devTeams.name)
}

/** Get compliance assessments for an application, filtered by screening-derived controls and technology elements. */
export async function getAppAssessments(appId: string) {
	const [app] = await db.select().from(monitoredApplications).where(eq(monitoredApplications.id, appId)).limit(1)
	if (!app) return null

	// If this app is linked to a primary, use the primary's assessments
	const assessmentAppId = app.primaryApplicationId ?? appId
	const isInherited = app.primaryApplicationId !== null

	let primaryName: string | null = null
	if (isInherited && app.primaryApplicationId) {
		const [primary] = await db
			.select({ name: monitoredApplications.name })
			.from(monitoredApplications)
			.where(eq(monitoredApplications.id, app.primaryApplicationId))
			.limit(1)
		primaryName = primary?.name ?? null
	}

	// Get screening-derived control IDs (empty set = no screening answers → fallback to all)
	const screeningControlIds = await getScreeningDerivedControlIds(assessmentAppId)
	const hasScreeningAnswers = screeningControlIds.size > 0

	// Get app's auto-detected or confirmed technology elements (consistent with routine matching)
	const appElements = await db
		.select({ elementId: applicationTechnologyElements.elementId })
		.from(applicationTechnologyElements)
		.where(
			and(
				eq(applicationTechnologyElements.applicationId, assessmentAppId),
				isNull(applicationTechnologyElements.archivedAt),
				or(eq(applicationTechnologyElements.source, "auto"), isNotNull(applicationTechnologyElements.confirmedAt)),
				isNull(applicationTechnologyElements.rejectedAt),
			),
		)
	const appElementIds = new Set(appElements.map((e) => e.elementId))

	const controls = await db
		.select({
			id: frameworkControls.id,
			controlId: frameworkControls.controlId,
			shortTitle: frameworkControls.shortTitle,
			requirement: frameworkControls.requirement,
			responsible: frameworkControls.responsible,
			frequency: frameworkControls.frequency,
		})
		.from(frameworkControls)
		.where(isNull(frameworkControls.archivedAt))
		.orderBy(frameworkControls.controlId)

	// Get all control → element mappings
	const controlElements = await db
		.select({
			controlId: controlTechnologyElements.controlId,
			elementId: controlTechnologyElements.elementId,
		})
		.from(controlTechnologyElements)
		.where(isNull(controlTechnologyElements.archivedAt))
	const elementsByControl = new Map<string, string[]>()
	for (const ce of controlElements) {
		const list = elementsByControl.get(ce.controlId) ?? []
		list.push(ce.elementId)
		elementsByControl.set(ce.controlId, list)
	}

	// Get element name lookup
	const allElements = await db
		.select({ id: technologyElements.id, name: technologyElements.name })
		.from(technologyElements)
	const elementNameMap = new Map(allElements.map((e) => [e.id, e.name]))

	// Fetch domains for name lookup
	const domains = await db
		.select({ id: frameworkDomains.id, code: frameworkDomains.code, name: frameworkDomains.name })
		.from(frameworkDomains)
		.where(isNull(frameworkDomains.archivedAt))
	const domainMap = new Map(domains.map((d) => [d.id, d]))

	// Fetch risk-control mappings for linked risks (include domainId for domain derivation)
	const riskMappings = await db
		.select({
			controlId: frameworkRiskControlMappings.controlId,
			riskId: frameworkRisks.riskId,
			shortTitle: frameworkRisks.shortTitle,
			description: frameworkRisks.description,
			domainId: frameworkRisks.domainId,
		})
		.from(frameworkRiskControlMappings)
		.innerJoin(frameworkRisks, eq(frameworkRiskControlMappings.riskId, frameworkRisks.id))
		.where(and(isNull(frameworkRiskControlMappings.archivedAt), isNull(frameworkRisks.archivedAt)))

	const risksByControlUuid = new Map<
		string,
		Array<{ riskId: string; shortTitle: string | null; description: string; domainId: string }>
	>()
	for (const rm of riskMappings) {
		const list = risksByControlUuid.get(rm.controlId) ?? []
		list.push({ riskId: rm.riskId, shortTitle: rm.shortTitle, description: rm.description, domainId: rm.domainId })
		risksByControlUuid.set(rm.controlId, list)
	}

	// Fetch predefined answers for all controls
	const allPredefined = await db
		.select({
			controlId: controlPredefinedAnswers.controlId,
			id: controlPredefinedAnswers.id,
			label: controlPredefinedAnswers.label,
			status: controlPredefinedAnswers.status,
			comment: controlPredefinedAnswers.comment,
		})
		.from(controlPredefinedAnswers)
		.where(isNull(controlPredefinedAnswers.archivedAt))
		.orderBy(controlPredefinedAnswers.displayOrder)
	const predefinedByControl = new Map<
		string,
		Array<{ id: string; label: string; status: string; comment: string | null }>
	>()
	for (const pa of allPredefined) {
		const list = predefinedByControl.get(pa.controlId) ?? []
		list.push({ id: pa.id, label: pa.label, status: pa.status, comment: pa.comment })
		predefinedByControl.set(pa.controlId, list)
	}

	const assessments = []
	for (const ctrl of controls) {
		const ctrlElementIds = elementsByControl.get(ctrl.id) ?? []
		// Find matching elements between control and app
		const matchingElements = ctrlElementIds.filter((eid) => appElementIds.has(eid))

		// If no control elements defined, show for all apps (backwards compat)
		// If app has no confirmed elements, show all controls (elements not yet confirmed)
		// If control has elements but none match the app's confirmed elements, skip
		if (ctrlElementIds.length > 0 && matchingElements.length === 0 && appElementIds.size > 0) continue

		// Controls not connected via screening are forced to "ikke vurdert"
		const isScreeningDerived = !hasScreeningAnswers || screeningControlIds.has(ctrl.id)

		// Derive domain from linked risks (transitive: control → risk → domain)
		const risks = risksByControlUuid.get(ctrl.id) ?? []
		const riskDomainIds = [...new Set(risks.map((r) => r.domainId))]
		const primaryDomain = riskDomainIds.length > 0 ? domainMap.get(riskDomainIds[0]) : undefined
		const predefined = predefinedByControl.get(ctrl.id) ?? []

		// Create one assessment entry per matching element (or one if no elements defined)
		const elementsToAssess = matchingElements.length > 0 ? matchingElements : [null]

		for (const elementId of elementsToAssess) {
			assessments.push({
				controlUuid: ctrl.id,
				controlId: ctrl.controlId,
				controlName: ctrl.shortTitle ?? ctrl.requirement?.split("\n")[0] ?? ctrl.controlId,
				requirement: ctrl.requirement ?? "",
				responsible: ctrl.responsible ?? null,
				frequency: ctrl.frequency ?? null,
				domainCode: primaryDomain?.code ?? "",
				domainName: primaryDomain?.name ?? "",
				technologyElementId: elementId,
				technologyElementName: elementId ? (elementNameMap.get(elementId) ?? null) : null,
				risks: risks.map((r) => ({
					riskId: r.riskId,
					name: r.shortTitle ?? r.description.split("\n")[0],
					description: r.description,
				})),
				predefinedAnswers: predefined,
				isScreeningDerived,
				status: null,
				comment: null,
				assessedBy: null,
				assessedAt: null,
			})
		}
	}

	return { app, assessments, isInherited, primaryName, hasScreeningAnswers }
}

/** Get all monitored applications for a section's Nais teams, with compliance summary. */
export async function getApplicationsForSection(sectionId: string) {
	// Find apps from two sources:
	// 1. Nais teams linked to this section (via applicationEnvironments)
	// 2. Direct team mappings (via applicationTeamMappings for section's dev teams)

	const [sectionNaisTeamRows, sectionDevTeamRows] = await Promise.all([
		db.select({ id: naisTeams.id }).from(naisTeams).where(eq(naisTeams.sectionId, sectionId)),
		db.select({ id: devTeams.id }).from(devTeams).where(eq(devTeams.sectionId, sectionId)),
	])

	const naisTeamIds = sectionNaisTeamRows.map((t) => t.id)
	const devTeamIds = sectionDevTeamRows.map((t) => t.id)

	if (naisTeamIds.length === 0 && devTeamIds.length === 0) return []

	// Load excluded environments for this section
	const excludedRows = await db
		.select({ cluster: sectionEnvironments.cluster })
		.from(sectionEnvironments)
		.where(and(eq(sectionEnvironments.sectionId, sectionId), eq(sectionEnvironments.included, false)))
	const excludedEnvs = new Set(excludedRows.map((r) => r.cluster))

	// Collect app IDs from both sources
	const allAppIdSet = new Set<string>()

	// Source 1: Nais team apps (with environment filtering)
	if (naisTeamIds.length > 0) {
		const envConditions = [inArray(applicationEnvironments.naisTeamId, naisTeamIds)]
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
			.selectDistinct({ appId: applicationEnvironments.applicationId })
			.from(applicationEnvironments)
			.where(and(...envConditions))

		for (const row of envApps) {
			allAppIdSet.add(row.appId)
		}
	}

	// Source 2: Directly-mapped apps from section's dev teams
	if (devTeamIds.length > 0) {
		const directApps = await db
			.select({ appId: applicationTeamMappings.applicationId })
			.from(applicationTeamMappings)
			.innerJoin(monitoredApplications, eq(applicationTeamMappings.applicationId, monitoredApplications.id))
			.where(
				and(
					inArray(applicationTeamMappings.devTeamId, devTeamIds),
					isNull(applicationTeamMappings.archivedAt),
					isNull(monitoredApplications.primaryApplicationId),
				),
			)

		for (const row of directApps) {
			allAppIdSet.add(row.appId)
		}
	}

	// Filter out apps whose ONLY environments are in excluded clusters
	if (excludedEnvs.size > 0 && allAppIdSet.size > 0) {
		const appEnvRows = await db
			.select({
				appId: applicationEnvironments.applicationId,
				cluster: applicationEnvironments.cluster,
			})
			.from(applicationEnvironments)
			.where(inArray(applicationEnvironments.applicationId, [...allAppIdSet]))
		const appEnvMap = new Map<string, Set<string>>()
		for (const row of appEnvRows) {
			if (!appEnvMap.has(row.appId)) appEnvMap.set(row.appId, new Set())
			appEnvMap.get(row.appId)?.add(row.cluster)
		}
		for (const appId of allAppIdSet) {
			const clusters = appEnvMap.get(appId)
			if (clusters && clusters.size > 0 && [...clusters].every((c) => excludedEnvs.has(c))) {
				allAppIdSet.delete(appId)
			}
		}
	}

	const sectionAppIds = [...allAppIdSet]
	if (sectionAppIds.length === 0) return []

	// Get primary apps only (exclude linked/child apps)
	const apps = await db
		.select()
		.from(monitoredApplications)
		.where(
			and(
				inArray(monitoredApplications.id, sectionAppIds),
				isNull(monitoredApplications.primaryApplicationId),
				isNull(monitoredApplications.archivedAt),
			),
		)
		.orderBy(monitoredApplications.name)

	const appIds = apps.map((a) => a.id)
	if (appIds.length === 0) return []

	const { getComplianceSummaries } = await import("./application-controls.server")

	const [childApps, allTeamMappings, complianceSummaries] = await Promise.all([
		db
			.select({
				id: monitoredApplications.id,
				name: monitoredApplications.name,
				primaryApplicationId: monitoredApplications.primaryApplicationId,
			})
			.from(monitoredApplications)
			.where(
				and(
					isNotNull(monitoredApplications.primaryApplicationId),
					inArray(monitoredApplications.primaryApplicationId, appIds),
					isNull(monitoredApplications.archivedAt),
				),
			)
			.orderBy(monitoredApplications.name),
		db
			.select({ applicationId: applicationTeamMappings.applicationId, teamSlug: devTeams.slug })
			.from(applicationTeamMappings)
			.innerJoin(devTeams, eq(applicationTeamMappings.devTeamId, devTeams.id))
			.where(and(inArray(applicationTeamMappings.applicationId, appIds), isNull(applicationTeamMappings.archivedAt))),
		getComplianceSummaries(appIds),
	])

	const childrenByParent = new Map<string, Array<{ id: string; name: string }>>()
	for (const child of childApps) {
		if (!child.primaryApplicationId) continue
		const list = childrenByParent.get(child.primaryApplicationId) ?? []
		list.push({ id: child.id, name: child.name })
		childrenByParent.set(child.primaryApplicationId, list)
	}

	const teamsByApp = new Map<string, string[]>()
	for (const row of allTeamMappings) {
		const teams = teamsByApp.get(row.applicationId) ?? []
		teams.push(row.teamSlug)
		teamsByApp.set(row.applicationId, teams)
	}

	return apps.map((app) => {
		const assessmentAppId = app.primaryApplicationId ?? app.id
		const summary = complianceSummaries.get(assessmentAppId) ?? {
			implemented: 0,
			partial: 0,
			notImplemented: 0,
			notRelevant: 0,
			total: 0,
		}
		return {
			id: app.id,
			name: app.name,
			teams: teamsByApp.get(app.id) ?? [],
			controlsImplemented: summary.implemented,
			controlsPartial: summary.partial,
			controlsNotImplemented: summary.notImplemented,
			controlsNotRelevant: summary.notRelevant,
			controlsTotal: summary.total,
			linkedApps: childrenByParent.get(app.id) ?? [],
		}
	})
}
