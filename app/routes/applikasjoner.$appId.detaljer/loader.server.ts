import type { LoaderFunctionArgs } from "react-router"
import { data } from "react-router"
import { getAppAssessments } from "~/db/queries/applications.server"
import { getOracleInstancesForApp, getSnapshotHistory } from "~/db/queries/audit-evidence.server"
import { getOracleAuditSummariesForApp } from "~/db/queries/audit-logging.server"
import { getScreeningEffectsByControlForApp } from "~/db/queries/compliance-auto.server"
import {
	getActiveAcknowledgments,
	getApplicationDetail,
	getGroupAssessmentsForApp,
	getManualGroupsForApp,
	resolveAppNames,
} from "~/db/queries/nais.server"
import { getReportsForApp } from "~/db/queries/reports.server"
import {
	getReviewsForApp,
	getRoutineDeadlinesForApp,
	getRoutineDeadlinesForAppByGroupClassification,
	getRoutineDeadlinesForAppByPersistence,
	getRoutineDeadlinesForAppByRuleset,
	getRoutineDeadlinesForAppByScreeningSelection,
	getRoutineDeadlinesForAppBySection,
} from "~/db/queries/routines.server"
import { getSections } from "~/db/queries/sections.server"
import type { GroupCriticality } from "~/db/schema/applications"
import { getAuthenticatedUser } from "~/lib/auth.server"
import { isAdmin } from "~/lib/authorization.server"
import { computeAutoCompliance } from "~/lib/auto-compliance"
import { resolveGroupNames } from "~/lib/graph.server"
import { filterInstancesByAccess } from "~/lib/oracle-access.server"
import { getOracleInstances } from "~/lib/oracle-revisjon.server"
import { compliancePercent } from "~/lib/utils"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const appId = params.appId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })

	const user = await getAuthenticatedUser(request)

	const breadcrumbCtx = await (async () => {
		if (params.seksjon && params.team) {
			const { getTeamBreadcrumbContext } = await import("~/lib/breadcrumb-context.server")
			return getTeamBreadcrumbContext(params.seksjon, params.team)
		}
		if (params.seksjon) {
			const { getSectionBreadcrumbContext } = await import("~/lib/breadcrumb-context.server")
			return getSectionBreadcrumbContext(params.seksjon)
		}
		return {}
	})()

	const [detail, assessmentsResult] = await Promise.all([getApplicationDetail(appId), getAppAssessments(appId)])

	if (!detail) throw new Response("Applikasjon ikke funnet", { status: 404 })

	const { getApplicationElements } = await import("~/db/queries/technology-elements.server")
	const [appElements, screeningRoutines, completedReviews, allSections, appReports] = await Promise.all([
		getApplicationElements(appId),
		getRoutineDeadlinesForApp(appId),
		getReviewsForApp(appId),
		getSections(),
		getReportsForApp(appId),
	])

	const screeningRoutineIds = new Set(screeningRoutines.map((d) => d.routine?.id).filter(Boolean) as string[])
	const persistenceRoutines = await getRoutineDeadlinesForAppByPersistence(appId, screeningRoutineIds)

	const afterPersistenceIds = new Set([
		...screeningRoutineIds,
		...(persistenceRoutines.map((d) => d.routine?.id).filter(Boolean) as string[]),
	])
	const groupClassificationRoutines = await getRoutineDeadlinesForAppByGroupClassification(appId, afterPersistenceIds)

	const alreadyMatchedIds = new Set([
		...afterPersistenceIds,
		...(groupClassificationRoutines.map((d) => d.routine?.id).filter(Boolean) as string[]),
	])
	const screeningSelectionRoutines = await getRoutineDeadlinesForAppByScreeningSelection(appId, alreadyMatchedIds)

	const allMatchedIds = new Set([
		...alreadyMatchedIds,
		...(screeningSelectionRoutines.map((d) => d.routine?.id).filter(Boolean) as string[]),
	])
	const sectionWideRoutines = await getRoutineDeadlinesForAppBySection(appId, allMatchedIds)

	const allMatchedBeforeRuleset = new Set([
		...allMatchedIds,
		...(sectionWideRoutines.map((d) => d.routine?.id).filter(Boolean) as string[]),
	])
	const rulesetRoutines = await getRoutineDeadlinesForAppByRuleset(appId, allMatchedBeforeRuleset)

	const routineDeadlines = [
		...screeningRoutines.map((d) => ({ ...d, matchSource: "screening" as const })),
		...persistenceRoutines.map((d) => ({ ...d, matchSource: "persistence" as const })),
		...groupClassificationRoutines.map((d) => ({ ...d, matchSource: "group_classification" as const })),
		...screeningSelectionRoutines.map((d) => ({ ...d, matchSource: "screening_selection" as const })),
		...sectionWideRoutines.map((d) => ({ ...d, matchSource: "section" as const })),
		...rulesetRoutines.map((d) => ({ ...d, matchSource: "ruleset" as const })),
	]

	const allRoutineIds = [...new Set(routineDeadlines.map((d) => d.routine?.id).filter(Boolean) as string[])]
	const routineControlsMap = new Map<string, Array<{ id: string }>>()
	const routineTechElementsMap = new Map<string, string[]>()
	if (allRoutineIds.length > 0) {
		const { routineControls: routineControlsTable, routineTechnologyElements } = await import("~/db/schema/routines")
		const { db } = await import("~/db/connection.server")
		const { inArray } = await import("drizzle-orm")
		const [controlRows, techElementRows] = await Promise.all([
			db
				.select({ routineId: routineControlsTable.routineId, controlId: routineControlsTable.controlId })
				.from(routineControlsTable)
				.where(inArray(routineControlsTable.routineId, allRoutineIds)),
			db
				.select({
					routineId: routineTechnologyElements.routineId,
					elementId: routineTechnologyElements.elementId,
				})
				.from(routineTechnologyElements)
				.where(inArray(routineTechnologyElements.routineId, allRoutineIds)),
		])
		for (const row of controlRows) {
			const list = routineControlsMap.get(row.routineId) ?? []
			list.push({ id: row.controlId })
			routineControlsMap.set(row.routineId, list)
		}
		for (const row of techElementRows) {
			const list = routineTechElementsMap.get(row.routineId) ?? []
			list.push(row.elementId)
			routineTechElementsMap.set(row.routineId, list)
		}
	}

	const deadlinesWithControls = routineDeadlines.map((d) => ({
		...d,
		routine: d.routine
			? {
					...d.routine,
					controls: routineControlsMap.get(d.routine.id) ?? [],
					technologyElementIds: routineTechElementsMap.get(d.routine.id) ?? [],
				}
			: d.routine,
	}))

	const screeningEffectsByControl = await getScreeningEffectsByControlForApp(appId)
	const autoComplianceMap = computeAutoCompliance(
		(assessmentsResult?.assessments ?? []).map((a) => ({
			controlUuid: a.controlUuid,
			technologyElementId: a.technologyElementId,
			status: null,
		})),
		deadlinesWithControls,
		screeningEffectsByControl,
	)

	const sectionSlugMap = Object.fromEntries(allSections.map((s) => [s.id, s.slug]))

	const assessmentsBase = (assessmentsResult?.assessments ?? []).map((a) => {
		const key = `${a.controlUuid}:${a.technologyElementId ?? "null"}`
		const auto = autoComplianceMap.get(key)
		return {
			...a,
			autoStatus: auto?.autoStatus ?? null,
			autoReason: auto?.autoStatus != null ? (auto?.reason ?? null) : null,
			effectiveStatus: auto?.autoStatus ?? null,
			establishment: auto?.establishment ?? "not_established",
			routineCompliance: auto?.compliance ?? "not_applicable",
			routinesEstablished: auto?.routinesEstablished ?? 0,
			routinesCompleted: auto?.routinesCompleted ?? 0,
			routinesOverdue: auto?.routinesOverdue ?? 0,
			screeningDetails: auto?.screeningDetails ?? [],
		}
	})

	const { getActiveApplicationControls } = await import("~/db/queries/application-controls.server")
	const persistedControls = await getActiveApplicationControls(appId)
	const persistedMap = new Map(persistedControls.map((c) => [`${c.controlId}:${c.technologyElementId ?? "null"}`, c]))

	const assessments = assessmentsBase.map((a) => {
		const persisted = persistedMap.get(`${a.controlUuid}:${a.technologyElementId ?? "null"}`)
		return {
			...a,
			applicationControlId: persisted?.id ?? null,
			comment: persisted?.comment ?? null,
			commentUpdatedAt: persisted?.commentUpdatedAt?.toISOString() ?? null,
			commentUpdatedBy: persisted?.commentUpdatedBy ?? null,
		}
	})
	const totalControls = assessments.length
	const implemented = assessments.filter((a) => a.effectiveStatus === "implemented").length
	const partial = assessments.filter((a) => a.effectiveStatus === "partially_implemented").length
	const notImplemented = assessments.filter((a) => a.effectiveStatus === "not_implemented").length
	const notRelevant = assessments.filter((a) => a.effectiveStatus === "not_relevant").length
	const notAssessed = assessments.filter((a) => !a.effectiveStatus).length

	const withRoutine = assessments.filter((a) => a.establishment === "established").length
	const withoutRoutine = assessments.filter((a) => a.establishment === "not_established").length
	const routineNotRelevant = assessments.filter((a) => a.establishment === "not_relevant").length
	const routineCompleted = assessments.filter((a) => a.routineCompliance === "completed").length
	const routineOverdue = assessments.filter((a) => a.routineCompliance === "overdue").length
	const routineNeverReviewed = assessments.filter((a) => a.routineCompliance === "never_reviewed").length

	const referencedAppNames = new Set<string>()
	for (const auth of detail.authIntegrations) {
		if (auth.inboundRules) {
			const rules = JSON.parse(auth.inboundRules) as Array<{ application: string }>
			for (const r of rules) referencedAppNames.add(r.application)
		}
	}
	for (const rule of detail.accessPolicyRules) {
		referencedAppNames.add(rule.ruleApplication)
	}
	const knownApps = await resolveAppNames([...referencedAppNames])

	const acknowledgmentsRaw = await getActiveAcknowledgments(appId)
	const acknowledgments: Record<string, { comment: string; acknowledgedBy: string; acknowledgedAt: string }> = {}
	for (const ack of acknowledgmentsRaw) {
		acknowledgments[ack.ruleApplication] = {
			comment: ack.comment,
			acknowledgedBy: ack.acknowledgedBy,
			acknowledgedAt: ack.acknowledgedAt.toISOString(),
		}
	}

	const allOracleInstances = await getOracleInstances()
	const oracleInstances = await getOracleInstancesForApp(appId)

	const accessibleInstanceIds = new Set(
		filterInstancesByAccess(allOracleInstances, user?.groups ?? []).map((i) => i.id),
	)
	const filteredOracleInstances = oracleInstances.filter((i) => accessibleInstanceIds.has(i.instanceId))
	const totalOracleInstanceCount = oracleInstances.length

	const oraclePersistenceInstanceIds = new Set(
		detail.persistence.filter((p) => p.type === "oracle").map((p) => p.oracleInstanceId ?? p.name),
	)
	const orphanInstances = filteredOracleInstances.filter((inst) => !oraclePersistenceInstanceIds.has(inst.instanceId))

	if (orphanInstances.length > 0) {
		const { ensureOraclePersistenceEntries } = await import("~/db/queries/audit-logging.server")
		const newEntries = await ensureOraclePersistenceEntries(
			appId,
			orphanInstances.map((i) => i.instanceId),
		)
		detail.persistence.push(...newEntries)
	}

	const snapshotHistoryPromises = filteredOracleInstances.map(async (inst) => {
		const history = await getSnapshotHistory(appId, inst.instanceId)
		return { instanceId: inst.instanceId, history }
	})
	const instanceSnapshotHistories = await Promise.all(snapshotHistoryPromises)

	const oracleAuditSummaries = await getOracleAuditSummariesForApp(detail.persistence)

	const { getDeploymentVerificationForAppWithFetch } = await import("~/db/queries/deployment-audit.server")
	const deploymentVerifications = await getDeploymentVerificationForAppWithFetch(appId)

	const manualGroups = await getManualGroupsForApp(appId)
	const groupAssessments = await getGroupAssessmentsForApp(appId)
	const naisGroupIds: string[] = []
	for (const auth of detail.authIntegrations) {
		if (auth.groups) {
			const groups = JSON.parse(auth.groups) as string[]
			naisGroupIds.push(...groups)
		}
	}
	const naisGroupIdSet = new Set(naisGroupIds)
	const manualGroupIdSet = new Set(manualGroups.map((g) => g.groupId))

	const ghostGroupIds = groupAssessments
		.filter((a) => !naisGroupIdSet.has(a.groupId) && !manualGroupIdSet.has(a.groupId))
		.map((a) => a.groupId)

	const filteredOracleInstanceIdSet = new Set(filteredOracleInstances.map((i) => i.instanceId))
	const oracleGroupIds = allOracleInstances
		.filter((i) => filteredOracleInstanceIdSet.has(i.id) && i.group !== null)
		.map((i) => i.group as string)

	const allGroupIds = [
		...new Set([...naisGroupIds, ...manualGroups.map((g) => g.groupId), ...ghostGroupIds, ...oracleGroupIds]),
	]
	const groupNames = await resolveGroupNames(allGroupIds)

	const assessmentsByGroupId: Record<string, { criticality: GroupCriticality; updatedBy: string; updatedAt: string }> =
		{}
	for (const a of groupAssessments) {
		assessmentsByGroupId[a.groupId] = {
			criticality: a.criticality as GroupCriticality,
			updatedBy: a.updatedBy,
			updatedAt: a.updatedAt.toISOString(),
		}
	}

	return data({
		...breadcrumbCtx,
		app: detail.app,
		environments: detail.environments,
		persistence: detail.persistence,
		oracleAuditSummaries,
		deploymentVerifications: deploymentVerifications.map((v) => ({
			...v,
			periodFrom: v.periodFrom.toISOString(),
			periodTo: v.periodTo.toISOString(),
			lastDeploymentAt: v.lastDeploymentAt?.toISOString() ?? null,
			fetchedAt: v.fetchedAt.toISOString(),
			lastSyncAttemptedAt: v.lastSyncAttemptedAt?.toISOString() ?? null,
			createdAt: v.createdAt.toISOString(),
			updatedAt: v.updatedAt.toISOString(),
		})),
		authIntegrations: detail.authIntegrations,
		manualGroups: manualGroups.map((g) => ({ ...g, createdAt: g.createdAt.toISOString() })),
		groupNames,
		assessmentsByGroupId,
		naisGroupIds: [...naisGroupIdSet],
		ghostGroupIds,
		accessPolicyRules: detail.accessPolicyRules,
		teams: detail.teams,
		primaryApp: detail.primaryApp,
		linkedApps: detail.linkedApps,
		appElements,
		routineDeadlines,
		completedReviews,
		sectionSlugMap,
		canAdmin: user ? isAdmin(user) : false,
		knownApps,
		acknowledgments,
		compliance: {
			totalControls,
			implemented,
			partial,
			notImplemented,
			notRelevant,
			notAssessed,
			percent: compliancePercent(implemented, partial, totalControls, notRelevant),
			hasScreeningAnswers: assessmentsResult?.hasScreeningAnswers ?? false,
			withRoutine,
			withoutRoutine,
			routineNotRelevant,
			routineCompleted,
			routineOverdue,
			routineNeverReviewed,
		},
		assessments,
		appReports: appReports.map((r) => ({
			id: r.id,
			name: r.name,
			createdAt: r.createdAt.toISOString(),
			createdBy: r.createdBy,
			reportBucketPath: r.reportBucketPath,
		})),
		oracleInstances: filteredOracleInstances.map((inst) => ({
			...inst,
			configuredAt: inst.configuredAt.toISOString(),
			latestSnapshot: inst.latestSnapshot
				? {
						...inst.latestSnapshot,
						fetchedAt: inst.latestSnapshot.fetchedAt.toISOString(),
					}
				: null,
		})),
		totalOracleInstanceCount,
		instanceSnapshotHistories: (() => {
			const oracleInstanceMetaById = new Map(allOracleInstances.map((i) => [i.id, i]))
			return instanceSnapshotHistories.map(({ instanceId, history }) => {
				const meta = oracleInstanceMetaById.get(instanceId)
				return {
					instanceId,
					instanceName: meta?.name ?? instanceId.toUpperCase(),
					instanceType: meta?.type ?? null,
					instanceSchema: meta?.schema ?? null,
					instanceGroup: meta?.group ?? null,
					snapshots: history.map((s) => ({
						id: s.id,
						overallStatus: s.overallStatus,
						collectedAt: s.collectedAt.toISOString(),
						fetchedAt: s.fetchedAt.toISOString(),
						fetchedBy: s.fetchedBy,
					})),
				}
			})
		})(),
	})
}
