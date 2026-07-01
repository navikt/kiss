import { data } from "react-router"
import { getAppScopeIds, getAvailableTeamsForApp } from "~/db/queries/applications.server"
import { getOracleInstancesForApp } from "~/db/queries/audit-evidence.server"
import { findLinkCandidates, getApplicationDetail, getLinkCandidatesForSection } from "~/db/queries/nais.server"
import { getAllTechnologyElements, getApplicationElements } from "~/db/queries/technology-elements.server"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"
import { filterInstancesByAccess } from "~/lib/oracle-access.server"
import { getOracleInstances } from "~/lib/oracle-revisjon.server"
import type { Route } from "./+types/index"

type LoaderArgs = Route.LoaderArgs & {
	params: Route.LoaderArgs["params"] & {
		seksjon?: string
		team?: string
	}
}

export async function loader({ request, params }: LoaderArgs) {
	const appId = params.appId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })

	const authedUser = await requireAuthenticatedUser(request)
	requireAdmin(authedUser)

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

	const [detail, candidates, appElements, allElements, availableTeams, oracleInstances, allOracleInstances] =
		await Promise.all([
			getApplicationDetail(appId),
			getAppScopeIds(appId).then(({ sectionIds }) =>
				sectionIds.length === 1 ? getLinkCandidatesForSection(sectionIds[0]) : findLinkCandidates(),
			),
			getApplicationElements(appId),
			getAllTechnologyElements(),
			getAvailableTeamsForApp(appId),
			getOracleInstancesForApp(appId),
			getOracleInstances(),
		])

	if (!detail) throw new Response("Applikasjon ikke funnet", { status: 404 })

	const accessibleInstances = filterInstancesByAccess(allOracleInstances, authedUser.groups)
	const accessibleInstanceIds = new Set(accessibleInstances.map((i) => i.id))
	const filteredOracleInstances = oracleInstances.filter((i) => accessibleInstanceIds.has(i.instanceId))

	const relevantCandidates = [
		...new Map(
			candidates
				.filter((c) => c.apps.some((a) => a.id === appId))
				.flatMap((c) => c.apps.filter((a) => a.id !== appId && !a.alreadyLinked))
				.map((a) => [a.id, a]),
		).values(),
	]

	const configuredIds = new Set(filteredOracleInstances.map((i) => i.instanceId))
	const availableOracleInstances = accessibleInstances.filter((i) => !configuredIds.has(i.id))

	const canDelete = detail.linkedApps.length === 0 && detail.environments.length === 0

	return data({
		...breadcrumbCtx,
		app: detail.app,
		teams: detail.teams,
		primaryApp: detail.primaryApp,
		linkedApps: detail.linkedApps,
		linkSuggestions: relevantCandidates,
		appElements,
		availableElements: allElements.filter((e) => !appElements.some((ae) => ae.id === e.id)),
		availableTeams,
		oracleInstances: filteredOracleInstances,
		availableOracleInstances,
		oraclePersistence: detail.persistence
			.filter((p) => p.type === "oracle")
			.map((p) => ({ id: p.id, name: p.name, oracleInstanceId: p.oracleInstanceId })),
		canDelete,
	})
}
