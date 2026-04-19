import type { LoaderFunctionArgs } from "react-router"
import { data } from "react-router"
import {
	getApplicationDetail,
	getAppPersistence,
	getGroupAssessmentsForApp,
	getManualGroupsForApp,
} from "~/db/queries/nais.server"
import { getRulesetsForSection } from "~/db/queries/rulesets.server"
import { getScreeningDataForApp } from "~/db/queries/screening.server"
import { resolveGroupNames } from "~/lib/graph.server"
import { renderMarkdown } from "~/lib/markdown.server"

export async function loader({ params }: LoaderFunctionArgs) {
	const appId = params.appId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })

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

	const [screeningData, appDetail] = await Promise.all([getScreeningDataForApp(appId), getApplicationDetail(appId)])
	if (!appDetail) throw new Response("Applikasjon ikke funnet", { status: 404 })

	const hasPersistenceQuestion = screeningData.questions.some((q) => q.answerType === "persistence")
	const persistence = hasPersistenceQuestion ? await getAppPersistence(appId) : []

	const hasEntraGroupsQuestion = screeningData.questions.some((q) => q.answerType === "entra_id_groups")
	let entraGroupsData: {
		naisGroupIds: string[]
		manualGroups: Array<{ id: string; groupId: string; groupName: string | null; createdBy: string; createdAt: string }>
		ghostGroupIds: string[]
		groupNames: Record<string, string>
		assessmentsByGroupId: Record<string, { criticality: string; updatedBy: string; updatedAt: string }>
	} = { naisGroupIds: [], manualGroups: [], ghostGroupIds: [], groupNames: {}, assessmentsByGroupId: {} }

	if (hasEntraGroupsQuestion) {
		const [manualGroups, groupAssessments] = await Promise.all([
			getManualGroupsForApp(appId),
			getGroupAssessmentsForApp(appId),
		])
		const naisGroupIds: string[] = []
		for (const auth of appDetail.authIntegrations) {
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
		const allGroupIds = [...new Set([...naisGroupIds, ...manualGroups.map((g) => g.groupId), ...ghostGroupIds])]
		const groupNames = await resolveGroupNames(allGroupIds)
		const assessmentsByGroupId: Record<string, { criticality: string; updatedBy: string; updatedAt: string }> = {}
		for (const a of groupAssessments) {
			assessmentsByGroupId[a.groupId] = {
				criticality: a.criticality,
				updatedBy: a.updatedBy,
				updatedAt: a.updatedAt.toISOString(),
			}
		}
		entraGroupsData = {
			naisGroupIds,
			manualGroups: manualGroups.map((g) => ({ ...g, createdAt: g.createdAt.toISOString() })),
			ghostGroupIds,
			groupNames,
			assessmentsByGroupId,
		}
	}

	const hasRulesetQuestion = screeningData.questions.some((q) => q.answerType === "ruleset")
	const rulesetOptions: { id: string; name: string }[] = []
	if (hasRulesetQuestion && screeningData.sectionIds.length > 0) {
		const allRulesets = await Promise.all(screeningData.sectionIds.map((sid) => getRulesetsForSection(sid)))
		const seen = new Set<string>()
		for (const sectionRulesets of allRulesets) {
			for (const rs of sectionRulesets) {
				if (!seen.has(rs.id)) {
					seen.add(rs.id)
					rulesetOptions.push({ id: rs.id, name: rs.name })
				}
			}
		}
	}

	return data({
		...breadcrumbCtx,
		appId,
		appName: appDetail.app.name,
		screening: screeningData.questions.map((q) => ({
			...q,
			descriptionHtml: renderMarkdown(q.description),
		})),
		persistence: persistence.map((p) => ({
			id: p.id,
			type: p.type,
			name: p.name,
			dataClassification: p.dataClassification,
			manuallyAdded: p.manuallyAdded,
		})),
		rulesetOptions,
		entraGroupsData,
	})
}
