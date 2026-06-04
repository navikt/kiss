import type { LoaderFunctionArgs } from "react-router"
import { data } from "react-router"
import { getActiveApplicationControls } from "~/db/queries/application-controls.server"
import { getAppAssessments, getAppScopeIds } from "~/db/queries/applications.server"
import { getOracleInstancesForApp, getSnapshotHistory } from "~/db/queries/audit-evidence.server"
import { getOracleAuditSummariesForApp } from "~/db/queries/audit-logging.server"
import { getScreeningEffectsByControlForApp } from "~/db/queries/compliance-auto.server"
import { getEconomyClassification } from "~/db/queries/economy-classification.server"
import {
	getGitHubAccessChangeLog,
	getGitHubCollaboratorsForApp,
	getGitHubTeamsForApp,
} from "~/db/queries/github-access.server"
import {
	getActiveAcknowledgments,
	getApplicationDetail,
	getGroupAssessmentsForApp,
	getManualGroupsForApp,
	resolveAppNames,
} from "~/db/queries/nais.server"
import { getReportsForApp } from "~/db/queries/reports.server"
import { getRoutineDeadlinesWithControls } from "~/db/queries/routine-deadlines.server"
import { getReviewsForApp } from "~/db/queries/routines.server"
import { getRpaUsersForApp } from "~/db/queries/rpa.server"
import { getScreeningSessionsForApp } from "~/db/queries/screening-sessions.server"
import { getSections } from "~/db/queries/sections.server"
import type { GroupCriticality } from "~/db/schema/applications"
import { getAuthenticatedUser } from "~/lib/auth.server"
import { canAccessAppReports, hasAnyTeamRole, hasRole, isAdmin } from "~/lib/authorization.server"
import { computeAutoCompliance } from "~/lib/auto-compliance"
import { resolveGroupNames } from "~/lib/graph.server"
import { logger } from "~/lib/logger.server"
import { filterInstancesByAccess } from "~/lib/oracle-access.server"
import { getOracleInstances, getOracleRoles, shouldAssessRole } from "~/lib/oracle-revisjon.server"
import { computeRoutineComplianceCounts } from "~/lib/routine-compliance"

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

	// Run getAppScopeIds in parallel with the detail query so canAccessReports
	// is known before the expensive report/evidence queries fire.
	const [detail, assessmentsResult, appScopeIds] = await Promise.all([
		getApplicationDetail(appId),
		getAppAssessments(appId),
		user ? getAppScopeIds(appId) : Promise.resolve({ devTeamIds: [], sectionIds: [] }),
	])

	if (!detail) throw new Response("Applikasjon ikke funnet", { status: 404 })

	const canAccessReports = user ? canAccessAppReports(user, appScopeIds.sectionIds, appScopeIds.devTeamIds) : false

	// Resolve effective git repository: prefer app-level, fallback to oldest environment with a repo
	// (matches sync job logic: ORDER BY discovered_at ASC LIMIT 1)
	const appRepo = detail.app.gitRepository?.trim() || null
	const envRepo =
		detail.environments
			.filter((e) => e.gitRepository?.trim())
			.sort((a, b) => new Date(a.discoveredAt).getTime() - new Date(b.discoveredAt).getTime())
			.at(0)
			?.gitRepository?.trim() || null
	const effectiveGitRepository = appRepo || envRepo

	// Extract referenced app names from detail (pure computation, no I/O)
	const referencedAppNames = new Set<string>()
	for (const auth of detail.authIntegrations) {
		if (auth.inboundRules) {
			try {
				const rules = JSON.parse(auth.inboundRules) as Array<{ application: string }>
				for (const r of rules) referencedAppNames.add(r.application)
			} catch {
				// Legacy/corrupt inboundRules data — skip gracefully
			}
		}
	}
	for (const rule of detail.accessPolicyRules) {
		referencedAppNames.add(rule.ruleApplication)
	}

	// Dynamic imports in parallel (avoids sequential awaits on cold starts)
	const [
		{ getApplicationElements },
		{ getScreeningProgressForApps },
		{ getDeploymentVerificationForAppWithFetch },
		{ getOracleRoleAssessments },
	] = await Promise.all([
		import("~/db/queries/technology-elements.server"),
		import("~/db/queries/screening.server"),
		import("~/db/queries/deployment-audit.server"),
		import("~/db/queries/oracle-roles.server"),
	])

	// Batch 1: Core queries for compliance computation (pool max=10, keep batches ≤10)
	const [
		appElements,
		deadlinesWithControls,
		completedReviews,
		allSections,
		appReports,
		screeningProgressMap,
		screeningSessions,
		screeningEffectsByControl,
		persistedControls,
		appRulesets,
		economyClassification,
	] = await Promise.all([
		getApplicationElements(appId),
		getRoutineDeadlinesWithControls(appId),
		getReviewsForApp(appId),
		getSections({ includeArchived: true }),
		canAccessReports ? getReportsForApp(appId) : Promise.resolve([]),
		getScreeningProgressForApps([appId]),
		getScreeningSessionsForApp(appId, user ? isAdmin(user) : false),
		getScreeningEffectsByControlForApp(appId),
		getActiveApplicationControls(appId),
		(async () => {
			const { getRulesetsSelectedByApp } = await import("~/db/queries/rulesets.server")
			return getRulesetsSelectedByApp(appId)
		})(),
		getEconomyClassification(appId),
	])

	// Batch 2: Supporting queries (independent of batch 1 results)
	const [
		knownApps,
		acknowledgmentsRaw,
		allOracleInstances,
		oracleInstances,
		roleAssessments,
		deploymentVerifications,
		manualGroups,
		groupAssessments,
		githubTeams,
		githubCollaborators,
		githubChangeLog,
	] = await Promise.all([
		resolveAppNames([...referencedAppNames]),
		getActiveAcknowledgments(appId),
		getOracleInstances(),
		canAccessReports ? getOracleInstancesForApp(appId) : Promise.resolve([]),
		getOracleRoleAssessments(appId),
		getDeploymentVerificationForAppWithFetch(appId),
		getManualGroupsForApp(appId),
		getGroupAssessmentsForApp(appId),
		effectiveGitRepository ? getGitHubTeamsForApp(appId) : Promise.resolve([]),
		effectiveGitRepository ? getGitHubCollaboratorsForApp(appId) : Promise.resolve([]),
		effectiveGitRepository ? getGitHubAccessChangeLog(appId) : Promise.resolve([]),
	])

	// Compute auto-compliance from parallel results
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

	const routineNameById = new Map(
		deadlinesWithControls
			.filter((d): d is typeof d & { routine: NonNullable<typeof d.routine> } => d.routine != null)
			.map((d) => [d.routine.id, d.routine.name]),
	)

	const assessmentsBase = (assessmentsResult?.assessments ?? []).map((a) => {
		const key = `${a.controlUuid}:${a.technologyElementId ?? "null"}`
		const auto = autoComplianceMap.get(key)
		const coveringRoutines = (auto?.matchingRoutineIds ?? []).map((id) => ({ id, name: routineNameById.get(id) ?? id }))
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
			coveringRoutines,
		}
	})

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
	// Routine-based compliance counts — one entry per unique periodic routine
	// (frequency !== null = shown in Rutinestatus + Seksjonsbaserte rutiner).
	// Each routine appears exactly once in deadlinesWithControls (sources are deduplicated).
	const { routinesGjennomfort, routinesIkkeGjennomfort, routinesMaaFolgesOpp, routineCompliancePercent } =
		computeRoutineComplianceCounts(deadlinesWithControls)

	const acknowledgments: Record<string, { comment: string; acknowledgedBy: string; acknowledgedAt: string }> = {}
	for (const ack of acknowledgmentsRaw) {
		acknowledgments[ack.ruleApplication] = {
			comment: ack.comment,
			acknowledgedBy: ack.acknowledgedBy,
			acknowledgedAt: ack.acknowledgedAt.toISOString(),
		}
	}

	const accessibleInstanceIds = new Set(
		filterInstancesByAccess(allOracleInstances, user?.groups ?? []).map((i) => i.id),
	)
	const filteredOracleInstances = oracleInstances.filter((i) => accessibleInstanceIds.has(i.instanceId))
	const totalOracleInstanceCount = oracleInstances.length

	// Collect Entra ID group IDs required for inaccessible Oracle instances
	const oracleInstanceMetaById = new Map(allOracleInstances.map((i) => [i.id, i]))

	// Consider both applicationOracleInstances and persistence entries of type "oracle"
	const allReferencedOracleInstanceIds = new Set([
		...oracleInstances.map((i) => i.instanceId),
		...detail.persistence
			.filter((p) => p.type === "oracle" && p.oracleInstanceId)
			.map((p) => p.oracleInstanceId as string),
		// Also match by persistence name (same logic as resolveOracleInstanceId fallback)
		...detail.persistence
			.filter((p) => p.type === "oracle" && !p.oracleInstanceId && oracleInstanceMetaById.has(p.name))
			.map((p) => p.name),
	])
	const inaccessibleOracleGroupIds = [
		...new Set(
			[...allReferencedOracleInstanceIds]
				.filter((id) => !accessibleInstanceIds.has(id))
				.map((id) => oracleInstanceMetaById.get(id)?.group)
				.filter((g): g is NonNullable<typeof g> => g !== null && g !== undefined),
		),
	]

	const oraclePersistenceInstanceIds = new Set(
		detail.persistence.filter((p) => p.type === "oracle").map((p) => p.oracleInstanceId ?? p.name),
	)
	const orphanInstances = filteredOracleInstances.filter((inst) => !oraclePersistenceInstanceIds.has(inst.instanceId))

	if (orphanInstances.length > 0) {
		const { ensureOraclePersistenceEntries } = await import("~/db/queries/audit-logging.server")
		const newEntries = await ensureOraclePersistenceEntries(
			appId,
			orphanInstances.map((i) => i.instanceId),
			user?.navIdent ?? "system",
		)
		detail.persistence.push(...newEntries)
	}

	const knownOracleInstanceIds = new Set(allOracleInstances.map((i) => i.id))

	// Parallelize oracle sub-queries: snapshot histories, audit summaries, and role lookups
	const [instanceSnapshotHistories, oracleAuditSummaries, oracleRoleResults] = await Promise.all([
		Promise.all(
			filteredOracleInstances.map(async (inst) => {
				const history = await getSnapshotHistory(appId, inst.instanceId)
				return { instanceId: inst.instanceId, history }
			}),
		),
		getOracleAuditSummariesForApp(detail.persistence, knownOracleInstanceIds),
		Promise.allSettled(
			filteredOracleInstances.map(async (inst) => {
				const roles = await getOracleRoles(inst.instanceId)
				const meta = oracleInstanceMetaById.get(inst.instanceId)
				const instanceName = meta?.name ?? inst.instanceId.toUpperCase()
				return { instanceId: inst.instanceId, instanceName, roles: roles?.roles ?? [] }
			}),
		),
	])
	const oracleRoles = oracleRoleResults.flatMap((result) => {
		if (result.status !== "fulfilled") {
			logger.warn("Oracle role fetch failed", { reason: String(result.reason) })
			return []
		}
		const { instanceId, instanceName, roles } = result.value
		return roles.filter(shouldAssessRole).map((r) => {
			const key = `${instanceId}:${r.name.toUpperCase().trim()}`
			const assessment = roleAssessments[key]
			return {
				instanceId,
				instanceName,
				roleName: r.name.toUpperCase().trim(),
				oracleMaintained: r.oracleMaintained,
				common: r.common,
				criticality: assessment?.criticality ?? null,
				updatedBy: assessment?.updatedBy ?? null,
				updatedAt: assessment?.updatedAt ?? null,
			}
		})
	})

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
		...new Set([
			...naisGroupIds,
			...manualGroups.map((g) => g.groupId),
			...ghostGroupIds,
			...oracleGroupIds,
			...inaccessibleOracleGroupIds,
		]),
	]

	// Check if app has allowAllUsers enabled (for RPA matching via manual groups)
	const hasAllowAllUsers = detail.authIntegrations.some(
		(auth) => auth.type === "entra_id" && auth.allowAllUsers === true,
	)

	// resolveGroupNames (Graph API) and getRpaUsersForApp (DB query) are independent — run in parallel
	const [groupNames, rpaUsers] = await Promise.all([
		resolveGroupNames(allGroupIds),
		getRpaUsersForApp(
			[...naisGroupIdSet],
			manualGroups.map((g) => g.groupId),
			hasAllowAllUsers,
		),
	])

	const inaccessibleOracleGroups = inaccessibleOracleGroupIds.map((id) => ({
		id,
		name: groupNames[id] ?? id,
	}))

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
		effectiveGitRepository,
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
		rpaUsers: rpaUsers.map((u) => ({ ...u, syncedAt: u.syncedAt.toISOString() })),
		accessPolicyRules: detail.accessPolicyRules,
		teams: detail.teams,
		primaryApp: detail.primaryApp,
		linkedApps: detail.linkedApps,
		appElements,
		routineDeadlines: deadlinesWithControls,
		completedReviews,
		sectionSlugMap,
		canAdmin: user ? isAdmin(user) : false,
		// Positivt tilgangsflagg: admin og teammedlemmer uten revisor-rolle kan starte/fortsette gjennomganger.
		// buildEffectiveAuth undertrykker revisor-rollen for effektive admins (admin-modus aktiv),
		// så !hasRole(user, "auditor") er false kun for rene revisorer — ikke for admins med admin-modus på.
		canManageReviews: user
			? !hasRole(user, "auditor") && (isAdmin(user) || appScopeIds.devTeamIds.some((id) => hasAnyTeamRole(user, id)))
			: false,
		canAccessReports,
		knownApps,
		acknowledgments,
		compliance: {
			percent: routineCompliancePercent,
			hasScreeningAnswers: assessmentsResult?.hasScreeningAnswers ?? false,
			screeningProgress: screeningProgressMap.get(appId) ?? { answered: 0, total: 0 },
			routinesGjennomfort,
			routinesIkkeGjennomfort,
			routinesMaaFolgesOpp,
		},
		assessments,
		appReports: canAccessReports
			? appReports.map((r) => ({
					id: r.id,
					name: r.name,
					createdAt: r.createdAt.toISOString(),
					createdBy: r.createdBy,
					reportBucketPath: r.reportBucketPath,
				}))
			: [],
		screeningSessions: screeningSessions.map((s) => ({
			id: s.id,
			title: s.title,
			status: s.status,
			completedAt: s.completedAt?.toISOString() ?? null,
			completedBy: s.completedBy,
			createdAt: s.createdAt.toISOString(),
			createdBy: s.createdBy,
			archivedAt: s.archivedAt?.toISOString() ?? null,
			archivedBy: s.archivedBy ?? null,
			archiveReason: s.archiveReason ?? null,
			participants: s.participants.map((p) => ({
				userIdent: p.userIdent,
				userName: p.userName,
			})),
		})),
		oracleInstances: canAccessReports
			? filteredOracleInstances.map((inst) => ({
					...inst,
					configuredAt: inst.configuredAt.toISOString(),
					latestSnapshot: inst.latestSnapshot
						? {
								...inst.latestSnapshot,
								fetchedAt: inst.latestSnapshot.fetchedAt.toISOString(),
							}
						: null,
				}))
			: [],
		totalOracleInstanceCount: canAccessReports ? totalOracleInstanceCount : 0,
		inaccessibleOracleGroups,
		oracleRoles,
		instanceSnapshotHistories: canAccessReports
			? (() => {
					const oracleInstanceMetaById = new Map(allOracleInstances.map((i) => [i.id, i]))
					return instanceSnapshotHistories.map(({ instanceId, history }) => {
						const meta = oracleInstanceMetaById.get(instanceId)
						return {
							instanceId,
							instanceName: meta?.name ?? instanceId.toUpperCase(),
							instanceType: meta?.type ?? null,
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
				})()
			: [],
		githubAccess: {
			teams: githubTeams.map((t) => ({
				...t,
				syncedAt: t.syncedAt.toISOString(),
			})),
			collaborators: githubCollaborators.map((c) => ({
				...c,
				syncedAt: c.syncedAt.toISOString(),
			})),
			changeLog: githubChangeLog.map((e) => ({
				...e,
				performedAt: e.performedAt.toISOString(),
			})),
		},
		appRulesets,
		economyClassification: economyClassification
			? {
					isEconomySystem: economyClassification.isEconomySystem,
					economySystemType: economyClassification.economySystemType ?? null,
					justification: economyClassification.justification,
					validUntil: economyClassification.validUntil.toISOString(),
				}
			: null,
	})
}
