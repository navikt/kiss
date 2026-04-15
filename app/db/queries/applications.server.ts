import { and, count, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import { db } from "../connection.server"
import {
	applicationEnvironments,
	applicationTeamMappings,
	monitoredApplications,
	naisTeams,
} from "../schema/applications"
import { type ComplianceStatus, complianceAssessmentHistory, complianceAssessments } from "../schema/compliance"
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
import { devTeams } from "../schema/organization"
import { writeAuditLog } from "./audit.server"
import { getScreeningDerivedControlIds } from "./screening.server"

/** Get all monitored applications with compliance summary (excludes linked/child apps). */
export async function getApplications() {
	const apps = await db
		.select()
		.from(monitoredApplications)
		.where(isNull(monitoredApplications.primaryApplicationId))
		.orderBy(monitoredApplications.name)

	const [totalControlsRow] = await db
		.select({ count: count() })
		.from(frameworkControls)
		.where(isNull(frameworkControls.archivedAt))

	const totalControls = totalControlsRow?.count ?? 0

	const appIds = apps.map((a) => a.id)
	if (appIds.length === 0) return []

	// Batch: linked (child) apps for all primary apps
	const childApps = await db
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
			),
		)
		.orderBy(monitoredApplications.name)

	const childrenByParent = new Map<string, Array<{ id: string; name: string }>>()
	for (const child of childApps) {
		if (!child.primaryApplicationId) continue
		const list = childrenByParent.get(child.primaryApplicationId) ?? []
		list.push({ id: child.id, name: child.name })
		childrenByParent.set(child.primaryApplicationId, list)
	}

	// Batch: team mappings for all apps
	const allTeamMappings = await db
		.select({
			applicationId: applicationTeamMappings.applicationId,
			teamSlug: devTeams.slug,
		})
		.from(applicationTeamMappings)
		.innerJoin(devTeams, eq(applicationTeamMappings.devTeamId, devTeams.id))
		.where(inArray(applicationTeamMappings.applicationId, appIds))

	const teamsByApp = new Map<string, string[]>()
	for (const row of allTeamMappings) {
		const teams = teamsByApp.get(row.applicationId) ?? []
		teams.push(row.teamSlug)
		teamsByApp.set(row.applicationId, teams)
	}

	// Batch: compliance stats for all apps
	const complianceRows = await db
		.select({
			applicationId: complianceAssessments.applicationId,
			status: complianceAssessments.status,
			count: count(),
		})
		.from(complianceAssessments)
		.where(inArray(complianceAssessments.applicationId, appIds))
		.groupBy(complianceAssessments.applicationId, complianceAssessments.status)

	const complianceByApp = new Map<string, { implemented: number; partial: number }>()
	for (const row of complianceRows) {
		const stats = complianceByApp.get(row.applicationId) ?? { implemented: 0, partial: 0 }
		if (row.status === "implemented") stats.implemented = row.count
		else if (row.status === "partially_implemented") stats.partial = row.count
		complianceByApp.set(row.applicationId, stats)
	}

	return apps.map((app) => {
		const assessmentAppId = app.primaryApplicationId ?? app.id
		const stats = complianceByApp.get(assessmentAppId) ?? { implemented: 0, partial: 0 }
		return {
			id: app.id,
			name: app.name,
			teams: teamsByApp.get(app.id) ?? [],
			controlsImplemented: stats.implemented,
			controlsPartial: stats.partial,
			controlsTotal: totalControls,
			linkedApps: childrenByParent.get(app.id) ?? [],
		}
	})
}

/** Link an application to a dev team. */
export async function linkAppToTeam(applicationId: string, devTeamId: string, performedBy: string) {
	const [mapping] = await db
		.insert(applicationTeamMappings)
		.values({ applicationId, devTeamId, createdBy: performedBy })
		.returning()

	const [app] = await db.select().from(monitoredApplications).where(eq(monitoredApplications.id, applicationId))
	const [team] = await db.select().from(devTeams).where(eq(devTeams.id, devTeamId))

	await writeAuditLog({
		action: "app_team_linked",
		entityType: "application_team_mapping",
		entityId: mapping.id,
		newValue: `${app?.name ?? applicationId} ↔ ${team?.name ?? devTeamId}`,
		metadata: { applicationId, devTeamId },
		performedBy,
	})

	return mapping
}

/** Unlink an application from a dev team. */
export async function unlinkAppFromTeam(applicationId: string, devTeamId: string, performedBy: string) {
	const [app] = await db.select().from(monitoredApplications).where(eq(monitoredApplications.id, applicationId))
	const [team] = await db.select().from(devTeams).where(eq(devTeams.id, devTeamId))

	await db
		.delete(applicationTeamMappings)
		.where(
			and(eq(applicationTeamMappings.applicationId, applicationId), eq(applicationTeamMappings.devTeamId, devTeamId)),
		)

	await writeAuditLog({
		action: "app_team_unlinked",
		entityType: "application_team_mapping",
		entityId: `${applicationId}_${devTeamId}`,
		previousValue: `${app?.name ?? applicationId} ↔ ${team?.name ?? devTeamId}`,
		metadata: { applicationId, devTeamId },
		performedBy,
	})
}

/** Get applications NOT yet linked to a specific team (excludes linked/child apps). */
export async function getAvailableAppsForTeam(devTeamId: string) {
	const linkedAppIds = db
		.select({ applicationId: applicationTeamMappings.applicationId })
		.from(applicationTeamMappings)
		.where(eq(applicationTeamMappings.devTeamId, devTeamId))

	return db
		.select({ id: monitoredApplications.id, name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(
			and(
				isNull(monitoredApplications.primaryApplicationId),
				sql`${monitoredApplications.id} NOT IN (${linkedAppIds})`,
			),
		)
		.orderBy(monitoredApplications.name)
}

/** Get teams NOT yet linked to a specific application. */
export async function getAvailableTeamsForApp(applicationId: string) {
	const linkedTeamIds = db
		.select({ devTeamId: applicationTeamMappings.devTeamId })
		.from(applicationTeamMappings)
		.where(eq(applicationTeamMappings.applicationId, applicationId))

	return db
		.select({ id: devTeams.id, name: devTeams.name })
		.from(devTeams)
		.where(sql`${devTeams.id} NOT IN (${linkedTeamIds})`)
		.orderBy(devTeams.name)
}

/** Get all dev teams. */
export async function getAllTeams() {
	return db.select({ id: devTeams.id, name: devTeams.name, slug: devTeams.slug }).from(devTeams).orderBy(devTeams.name)
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

	// Get app's confirmed technology elements (consistent with routine matching)
	const appElements = await db
		.select({ elementId: applicationTechnologyElements.elementId })
		.from(applicationTechnologyElements)
		.where(
			and(
				eq(applicationTechnologyElements.applicationId, assessmentAppId),
				isNotNull(applicationTechnologyElements.confirmedAt),
				isNull(applicationTechnologyElements.rejectedAt),
			),
		)
	const appElementIds = new Set(appElements.map((e) => e.elementId))

	let controls = await db
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

	// Filter to screening-derived controls if screening has been answered
	if (hasScreeningAnswers) {
		controls = controls.filter((c) => screeningControlIds.has(c.id))
	}

	// Get all control → element mappings
	const controlElements = await db
		.select({
			controlId: controlTechnologyElements.controlId,
			elementId: controlTechnologyElements.elementId,
		})
		.from(controlTechnologyElements)
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

	// Fetch existing assessments for this app (include element ID)
	const existingAssessments = await db
		.select()
		.from(complianceAssessments)
		.where(eq(complianceAssessments.applicationId, assessmentAppId))
	const assessmentLookup = new Map<string, (typeof existingAssessments)[number]>()
	for (const a of existingAssessments) {
		const key = `${a.controlId}:${a.technologyElementId ?? "null"}`
		assessmentLookup.set(key, a)
	}

	const assessments = []
	for (const ctrl of controls) {
		const ctrlElementIds = elementsByControl.get(ctrl.id) ?? []
		// Find matching elements between control and app
		const matchingElements = ctrlElementIds.filter((eid) => appElementIds.has(eid))

		// If no control elements defined, show for all apps (backwards compat)
		// If no matching elements, skip this control
		if (ctrlElementIds.length > 0 && matchingElements.length === 0) continue

		// Derive domain from linked risks (transitive: control → risk → domain)
		const risks = risksByControlUuid.get(ctrl.id) ?? []
		const riskDomainIds = [...new Set(risks.map((r) => r.domainId))]
		const primaryDomain = riskDomainIds.length > 0 ? domainMap.get(riskDomainIds[0]) : undefined
		const predefined = predefinedByControl.get(ctrl.id) ?? []

		// Create one assessment entry per matching element (or one if no elements defined)
		const elementsToAssess = matchingElements.length > 0 ? matchingElements : [null]

		for (const elementId of elementsToAssess) {
			const key = `${ctrl.id}:${elementId ?? "null"}`
			const assessment = assessmentLookup.get(key)

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
				status: assessment?.status ?? null,
				comment: assessment?.comment ?? null,
				assessedBy: assessment?.assessedBy ?? null,
				assessedAt: assessment?.assessedAt?.toISOString() ?? null,
			})
		}
	}

	return { app, assessments, isInherited, primaryName, hasScreeningAnswers }
}

/** Save a compliance assessment (upsert). */
export async function saveAssessment(
	appId: string,
	controlUuid: string,
	status: string,
	comment: string,
	performedBy: string,
	technologyElementId?: string | null,
) {
	// Find existing assessment matching (app, control, element)
	const conditions = [
		sql`${complianceAssessments.applicationId} = ${appId}`,
		sql`${complianceAssessments.controlId} = ${controlUuid}`,
	]
	if (technologyElementId) {
		conditions.push(sql`${complianceAssessments.technologyElementId} = ${technologyElementId}`)
	} else {
		conditions.push(sql`${complianceAssessments.technologyElementId} IS NULL`)
	}

	const [existing] = await db.select().from(complianceAssessments).where(sql.join(conditions, sql` AND `)).limit(1)

	if (existing) {
		// Write history before updating
		await db.insert(complianceAssessmentHistory).values({
			assessmentId: existing.id,
			previousStatus: existing.status,
			newStatus: status as ComplianceStatus,
			previousComment: existing.comment,
			newComment: comment || null,
			changedBy: performedBy,
		})

		await db
			.update(complianceAssessments)
			.set({
				status: status as ComplianceStatus,
				comment: comment || null,
				assessedBy: performedBy,
				assessedAt: new Date(),
				updatedBy: performedBy,
				updatedAt: new Date(),
			})
			.where(eq(complianceAssessments.id, existing.id))
	} else {
		const [newAssessment] = await db
			.insert(complianceAssessments)
			.values({
				applicationId: appId,
				controlId: controlUuid,
				technologyElementId: technologyElementId ?? null,
				status: status as ComplianceStatus,
				comment: comment || null,
				assessedBy: performedBy,
				createdBy: performedBy,
				updatedBy: performedBy,
			})
			.returning()

		// Write initial history
		await db.insert(complianceAssessmentHistory).values({
			assessmentId: newAssessment.id,
			previousStatus: null,
			newStatus: status as ComplianceStatus,
			previousComment: null,
			newComment: comment || null,
			changedBy: performedBy,
		})
	}
}

/** Save only a comment on an existing assessment (without changing status). */
export async function saveAssessmentComment(
	appId: string,
	controlUuid: string,
	comment: string,
	performedBy: string,
	technologyElementId?: string | null,
) {
	const conditions = [
		sql`${complianceAssessments.applicationId} = ${appId}`,
		sql`${complianceAssessments.controlId} = ${controlUuid}`,
	]
	if (technologyElementId) {
		conditions.push(sql`${complianceAssessments.technologyElementId} = ${technologyElementId}`)
	} else {
		conditions.push(sql`${complianceAssessments.technologyElementId} IS NULL`)
	}

	const [existing] = await db.select().from(complianceAssessments).where(sql.join(conditions, sql` AND `)).limit(1)

	if (!existing) {
		throw new Error("Kan ikke lagre kommentar uten en eksisterende vurdering")
	}

	await db.insert(complianceAssessmentHistory).values({
		assessmentId: existing.id,
		previousStatus: existing.status,
		newStatus: existing.status,
		previousComment: existing.comment,
		newComment: comment || null,
		changedBy: performedBy,
	})

	await db
		.update(complianceAssessments)
		.set({
			comment: comment || null,
			updatedBy: performedBy,
			updatedAt: new Date(),
		})
		.where(eq(complianceAssessments.id, existing.id))
}

/** Get all monitored applications for a section's Nais teams, with compliance summary. */
export async function getApplicationsForSection(sectionId: string) {
	// Find apps belonging to nais teams linked to this section
	const sectionNaisTeamRows = await db
		.select({ id: naisTeams.id })
		.from(naisTeams)
		.where(eq(naisTeams.sectionId, sectionId))
	if (sectionNaisTeamRows.length === 0) return []

	const naisTeamIds = sectionNaisTeamRows.map((t) => t.id)
	const envApps = await db
		.selectDistinct({ appId: applicationEnvironments.applicationId })
		.from(applicationEnvironments)
		.where(inArray(applicationEnvironments.naisTeamId, naisTeamIds))

	const sectionAppIds = [...new Set(envApps.map((r) => r.appId))]
	if (sectionAppIds.length === 0) return []

	// Get primary apps only (exclude linked/child apps)
	const apps = await db
		.select()
		.from(monitoredApplications)
		.where(and(inArray(monitoredApplications.id, sectionAppIds), isNull(monitoredApplications.primaryApplicationId)))
		.orderBy(monitoredApplications.name)

	const appIds = apps.map((a) => a.id)
	if (appIds.length === 0) return []

	// Run 4 independent queries in parallel to reduce total time and connection hold duration
	const [totalControlsResult, childApps, allTeamMappings, complianceRows] = await Promise.all([
		db.select({ count: count() }).from(frameworkControls).where(isNull(frameworkControls.archivedAt)),
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
				),
			)
			.orderBy(monitoredApplications.name),
		db
			.select({ applicationId: applicationTeamMappings.applicationId, teamSlug: devTeams.slug })
			.from(applicationTeamMappings)
			.innerJoin(devTeams, eq(applicationTeamMappings.devTeamId, devTeams.id))
			.where(inArray(applicationTeamMappings.applicationId, appIds)),
		db
			.select({
				applicationId: complianceAssessments.applicationId,
				status: complianceAssessments.status,
				count: count(),
			})
			.from(complianceAssessments)
			.where(inArray(complianceAssessments.applicationId, appIds))
			.groupBy(complianceAssessments.applicationId, complianceAssessments.status),
	])

	const totalControls = totalControlsResult[0]?.count ?? 0

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

	const complianceByApp = new Map<string, { implemented: number; partial: number }>()
	for (const row of complianceRows) {
		const stats = complianceByApp.get(row.applicationId) ?? { implemented: 0, partial: 0 }
		if (row.status === "implemented") stats.implemented = row.count
		else if (row.status === "partially_implemented") stats.partial = row.count
		complianceByApp.set(row.applicationId, stats)
	}

	return apps.map((app) => {
		const assessmentAppId = app.primaryApplicationId ?? app.id
		const stats = complianceByApp.get(assessmentAppId) ?? { implemented: 0, partial: 0 }
		return {
			id: app.id,
			name: app.name,
			teams: teamsByApp.get(app.id) ?? [],
			controlsImplemented: stats.implemented,
			controlsPartial: stats.partial,
			controlsTotal: totalControls,
			linkedApps: childrenByParent.get(app.id) ?? [],
		}
	})
}
