import { and, count, eq, inArray, isNull, sql } from "drizzle-orm"
import { db } from "../connection.server"
import { applicationTeamMappings, monitoredApplications } from "../schema/applications"
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

/** Get all monitored applications with compliance summary. */
export async function getApplications() {
	const apps = await db.select().from(monitoredApplications).orderBy(monitoredApplications.name)

	const [totalControlsRow] = await db
		.select({ count: count() })
		.from(frameworkControls)
		.where(isNull(frameworkControls.archivedAt))

	const totalControls = totalControlsRow?.count ?? 0

	const result = []
	for (const app of apps) {
		// Get teams for this app
		const teamMappings = await db
			.select({ teamSlug: devTeams.slug })
			.from(applicationTeamMappings)
			.innerJoin(devTeams, eq(applicationTeamMappings.devTeamId, devTeams.id))
			.where(eq(applicationTeamMappings.applicationId, app.id))

		// Use primary's compliance if linked
		const assessmentAppId = app.primaryApplicationId ?? app.id
		let implemented = 0
		let partial = 0

		const [implRow] = await db
			.select({ count: count() })
			.from(complianceAssessments)
			.where(
				sql`${complianceAssessments.applicationId} = ${assessmentAppId} AND ${complianceAssessments.status} = 'implemented'`,
			)
		implemented = implRow?.count ?? 0

		const [partialRow] = await db
			.select({ count: count() })
			.from(complianceAssessments)
			.where(
				sql`${complianceAssessments.applicationId} = ${assessmentAppId} AND ${complianceAssessments.status} = 'partially_implemented'`,
			)
		partial = partialRow?.count ?? 0

		result.push({
			id: app.id,
			name: app.name,
			primaryApplicationId: app.primaryApplicationId,
			teams: teamMappings.map((t) => t.teamSlug),
			controlsImplemented: implemented,
			controlsPartial: partial,
			controlsTotal: totalControls,
		})
	}

	return result
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

/** Get applications NOT yet linked to a specific team. */
export async function getAvailableAppsForTeam(devTeamId: string) {
	const linkedAppIds = db
		.select({ applicationId: applicationTeamMappings.applicationId })
		.from(applicationTeamMappings)
		.where(eq(applicationTeamMappings.devTeamId, devTeamId))

	return db
		.select({ id: monitoredApplications.id, name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(sql`${monitoredApplications.id} NOT IN (${linkedAppIds})`)
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

/** Get compliance assessments for an application, filtered by matching technology elements. */
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

	// Get app's technology elements
	const appElements = await db
		.select({ elementId: applicationTechnologyElements.elementId })
		.from(applicationTechnologyElements)
		.where(eq(applicationTechnologyElements.applicationId, assessmentAppId))
	const appElementIds = new Set(appElements.map((e) => e.elementId))

	const controls = await db
		.select({
			id: frameworkControls.id,
			controlId: frameworkControls.controlId,
			shortTitle: frameworkControls.shortTitle,
			requirement: frameworkControls.requirement,
			domainId: frameworkControls.domainId,
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

	// Fetch risk-control mappings for linked risks
	const riskMappings = await db
		.select({
			controlId: frameworkRiskControlMappings.controlId,
			riskId: frameworkRisks.riskId,
			shortTitle: frameworkRisks.shortTitle,
			description: frameworkRisks.description,
		})
		.from(frameworkRiskControlMappings)
		.innerJoin(frameworkRisks, eq(frameworkRiskControlMappings.riskId, frameworkRisks.id))

	const risksByControlUuid = new Map<
		string,
		Array<{ riskId: string; shortTitle: string | null; description: string }>
	>()
	for (const rm of riskMappings) {
		const list = risksByControlUuid.get(rm.controlId) ?? []
		list.push({ riskId: rm.riskId, shortTitle: rm.shortTitle, description: rm.description })
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

		const domain = domainMap.get(ctrl.domainId)
		const risks = risksByControlUuid.get(ctrl.id) ?? []
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
				domainCode: domain?.code ?? "",
				domainName: domain?.name ?? "",
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

	return { app, assessments, isInherited, primaryName }
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
