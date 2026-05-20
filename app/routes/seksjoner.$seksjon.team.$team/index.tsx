import { Alert, BodyLong, Box, Button, Detail, Heading, HGrid, HStack, Table, VStack } from "@navikt/ds-react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Link, redirect, useActionData, useLoaderData } from "react-router"
import { AddAppModal } from "~/components/AddAppModal"
import { ComplianceStatsPlaceholder } from "~/components/ComplianceStatsPlaceholder"
import { DeploymentSummaryCards } from "~/components/DeploymentSummaryCards"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAvailableAppsForTeam, linkAppToTeam } from "~/db/queries/applications.server"
import { getDeploymentVerificationAggregate } from "~/db/queries/deployment-audit.server"
import { getSectionBySlug, getTeamApps, getTeamBySlug } from "~/db/queries/sections.server"
import { getUsersForTeam } from "~/db/queries/users.server"
import { userRoleLabels } from "~/db/schema/organization"
import { useFeatureFlags } from "~/hooks/useFeatureFlags"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { canManageTeam } from "~/lib/authorization.server"
import { compliancePercent } from "~/lib/utils"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const seksjon = params.seksjon
	const teamSlug = params.team
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })
	if (!teamSlug) throw new Response("Mangler team", { status: 400 })

	const user = await getAuthenticatedUser(request)

	const [result, section] = await Promise.all([getTeamApps(teamSlug), getSectionBySlug(seksjon)])
	if (!result) throw new Response("Team ikke funnet", { status: 404 })
	if (!section) throw new Response("Seksjon ikke funnet", { status: 404 })
	if (result.team.sectionId !== section.id) throw new Response("Team tilhører ikke denne seksjonen", { status: 404 })

	const appIds = result.apps.map((a) => a.appId)
	const { getScreeningProgressForApps } = await import("~/db/queries/screening.server")
	const [deploymentStats, screeningProgressMap] = await Promise.all([
		getDeploymentVerificationAggregate(appIds),
		getScreeningProgressForApps(appIds),
	])

	const canManage = user ? canManageTeam(user, result.team.id) : false
	let canAddApp = canManage

	if (!canAddApp && user) {
		canAddApp = user.dbRoles.some((r) => r.devTeamId === result.team.id)
	}

	const availableApps = canAddApp ? await getAvailableAppsForTeam(result.team.id) : []
	const teamUsers = user ? await getUsersForTeam(result.team.id) : []

	const totalControls = result.apps.reduce((sum, a) => sum + a.total, 0)
	const totalImplemented = result.apps.reduce((sum, a) => sum + a.implemented, 0)
	const totalPartial = result.apps.reduce((sum, a) => sum + a.partial, 0)
	const totalNotRelevant = result.apps.reduce((sum, a) => sum + a.notRelevant, 0)
	const totalMangler =
		totalControls -
		totalImplemented -
		totalPartial -
		totalNotRelevant -
		result.apps.reduce((sum, a) => sum + a.notImplemented, 0)
	const overallPercent = compliancePercent(totalImplemented, totalPartial, totalControls, totalNotRelevant)

	return data({
		seksjon,
		seksjonName: section?.name ?? seksjon,
		team: teamSlug,
		teamId: result.team.id,
		teamName: result.team.name,
		apps: result.apps.map((a) => ({
			...a,
			screeningProgress: screeningProgressMap.get(a.appId) ?? { answered: 0, total: 0 },
		})),
		canManage,
		canAddApp,
		availableApps,
		teamUsers,
		totalImplemented,
		totalPartial,
		totalMangler,
		overallPercent,
		deploymentStats,
	})
}

export async function action({ request, params }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	const teamSlug = params.team
	const seksjon = params.seksjon
	if (!teamSlug || !seksjon) throw new Response("Mangler parametere", { status: 400 })

	const teamRecord = await getTeamBySlug(teamSlug)
	if (!teamRecord) throw new Response("Team ikke funnet", { status: 404 })

	const section = await getSectionBySlug(seksjon)
	if (!section || section.id !== teamRecord.sectionId) throw new Response("Seksjon/team mismatch", { status: 404 })

	// Check authorization: team admin (admin/product_owner/tech_lead) or any team member
	if (!canManageTeam(authedUser, teamRecord.id)) {
		const isMember = authedUser.dbRoles.some((r) => r.devTeamId === teamRecord.id)
		if (!isMember) throw new Response("Ikke tilgang", { status: 403 })
	}

	const formData = await request.formData()
	const intent = formData.get("intent")

	if (intent === "add-app") {
		const applicationId = formData.get("applicationId")
		if (typeof applicationId !== "string" || !applicationId) {
			return data({ success: false, error: "Velg en applikasjon." })
		}
		await linkAppToTeam(applicationId, teamRecord.id, authedUser.navIdent)
		return redirect(`/seksjoner/${seksjon}/team/${teamSlug}`)
	}

	throw new Response("Ugyldig handling", { status: 400 })
}

export default function TeamDashboard() {
	const {
		seksjon,
		team,
		teamName,
		apps,
		canManage,
		canAddApp,
		availableApps,
		teamUsers,
		totalImplemented,
		totalPartial,
		totalMangler,
		overallPercent,
		deploymentStats,
	} = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()

	const { showComplianceStats } = useFeatureFlags()

	return (
		<VStack gap="space-8">
			<HStack align="center" justify="space-between" wrap>
				<Heading size="xlarge" level="2">
					{teamName}
				</Heading>
				{canManage && (
					<Button as={Link} to={`/seksjoner/${seksjon}/team/${team}/rediger`} variant="tertiary" size="small">
						Administrer
					</Button>
				)}
			</HStack>

			{showComplianceStats ? (
				<HGrid gap="space-6" columns={{ xs: 2, sm: 3, md: 5 }}>
					<Box padding="space-6" borderRadius="8" background="sunken">
						<VStack align="center">
							<Heading size="xlarge" level="3">
								{overallPercent}%
							</Heading>
							<Detail>Total compliance</Detail>
						</VStack>
					</Box>
					<Box padding="space-6" borderRadius="8" background="sunken">
						<VStack align="center">
							<Heading size="xlarge" level="3">
								{apps.length}
							</Heading>
							<Detail>Applikasjoner</Detail>
						</VStack>
					</Box>
					<Box padding="space-6" borderRadius="8" background="sunken">
						<VStack align="center">
							<Heading size="xlarge" level="3">
								{totalImplemented}
							</Heading>
							<Detail>Implementert</Detail>
						</VStack>
					</Box>
					<Box padding="space-6" borderRadius="8" background="sunken">
						<VStack align="center">
							<Heading size="xlarge" level="3">
								{totalPartial}
							</Heading>
							<Detail>Delvis</Detail>
						</VStack>
					</Box>
					<Box padding="space-6" borderRadius="8" background="sunken">
						<VStack align="center">
							<Heading size="xlarge" level="3">
								{totalMangler}
							</Heading>
							<Detail>Mangler</Detail>
						</VStack>
					</Box>
				</HGrid>
			) : (
				<ComplianceStatsPlaceholder />
			)}

			<DeploymentSummaryCards stats={deploymentStats} />

			<HStack align="center" justify="space-between" wrap>
				<Heading size="large" level="3">
					Applikasjoner
				</Heading>
				{canAddApp && availableApps.length > 0 && <AddAppModal availableApps={availableApps} intent="add-app" />}
			</HStack>

			{actionData && "error" in actionData && <Alert variant="error">{actionData.error}</Alert>}

			{apps.length > 0 ? (
				/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
				<section className="table-scroll" tabIndex={0} aria-label="Applikasjoner per team">
					<Table>
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
								<Table.HeaderCell scope="col" align="right">
									Spørsmål
								</Table.HeaderCell>
								{showComplianceStats && (
									<>
										<Table.HeaderCell scope="col" align="right">
											Implementert
										</Table.HeaderCell>
										<Table.HeaderCell scope="col" align="right">
											Delvis
										</Table.HeaderCell>
										<Table.HeaderCell scope="col" align="right">
											Ikke impl.
										</Table.HeaderCell>
										<Table.HeaderCell scope="col" align="right">
											Ikke besvart
										</Table.HeaderCell>
										<Table.HeaderCell scope="col" align="right">
											Status %
										</Table.HeaderCell>
									</>
								)}
								<Table.HeaderCell scope="col" />
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{apps.map((app) => {
								return (
									<Table.Row key={app.appId}>
										<Table.DataCell>
											<Link to={`/seksjoner/${seksjon}/team/${team}/applikasjoner/${app.appId}/detaljer`}>
												{app.appName}
											</Link>
										</Table.DataCell>
										<Table.DataCell align="right">
											{app.screeningProgress.answered}/{app.screeningProgress.total}
										</Table.DataCell>
										{showComplianceStats && (
											<>
												<Table.DataCell align="right">{app.implemented}</Table.DataCell>
												<Table.DataCell align="right">{app.partial}</Table.DataCell>
												<Table.DataCell align="right">{app.notImplemented}</Table.DataCell>
												<Table.DataCell align="right">
													{Math.max(
														0,
														app.total - (app.implemented + app.partial + app.notImplemented + app.notRelevant),
													)}
												</Table.DataCell>
												<Table.DataCell align="right">
													{compliancePercent(app.implemented, app.partial, app.total, app.notRelevant)}%
												</Table.DataCell>
											</>
										)}
										<Table.DataCell>
											<Link
												to={`/seksjoner/${seksjon}/team/${team}/applikasjoner/${app.appId}/detaljer?fane=screeninger`}
											>
												Vurder
											</Link>
										</Table.DataCell>
									</Table.Row>
								)
							})}
						</Table.Body>
					</Table>
				</section>
			) : (
				<BodyLong>Ingen applikasjoner er tilknyttet dette teamet.</BodyLong>
			)}

			{/* Teammedlemmer */}
			{teamUsers.length > 0 && (
				<VStack gap="space-4">
					<Heading size="large" level="3">
						Teammedlemmer
					</Heading>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
					<section className="table-scroll" tabIndex={0} aria-label="Brukere tilknyttet teamet">
						<Table>
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Navn</Table.HeaderCell>
									<Table.HeaderCell scope="col">NAV-ident</Table.HeaderCell>
									<Table.HeaderCell scope="col">Rolle</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{teamUsers.map((u) => (
									<Table.Row key={u.navIdent}>
										<Table.DataCell>{u.name}</Table.DataCell>
										<Table.DataCell>{u.navIdent}</Table.DataCell>
										<Table.DataCell>{u.roles.map((r) => userRoleLabels[r] ?? r).join(", ")}</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				</VStack>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
