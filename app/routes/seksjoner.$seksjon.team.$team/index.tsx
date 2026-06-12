import { Alert, BodyLong, Box, Button, Detail, Heading, HGrid, HStack, Table, Tag, VStack } from "@navikt/ds-react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Link, redirect, useActionData, useLoaderData } from "react-router"
import { AddAppModal } from "~/components/AddAppModal"
import { DeploymentSummaryCards } from "~/components/DeploymentSummaryCards"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAvailableAppsForTeam, linkAppToTeam } from "~/db/queries/applications.server"
import { getDeploymentVerificationAggregate } from "~/db/queries/deployment-audit.server"
import { getSectionBySlug, getTeamApps, getTeamBySlug } from "~/db/queries/sections.server"
import { getUsersForTeam } from "~/db/queries/users.server"
import { type EconomySystemType, economySystemTypeLabels } from "~/db/schema/applications"
import { userRoleLabels } from "~/db/schema/organization"
import { getAuthenticatedUser, requireAuthenticatedUser } from "~/lib/auth.server"
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

	const canManage = user ? canManageTeam(user, result.team.id, section.id) : false
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
	const totalRoutinesIkkeGjennomfort = result.apps.reduce(
		(sum, a) => sum + a.routineCompliance.routinesIkkeGjennomfort,
		0,
	)

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
		totalRoutinesIkkeGjennomfort,
		deploymentStats,
	})
}

export async function action({ request, params }: ActionFunctionArgs) {
	const authedUser = await requireAuthenticatedUser(request)
	const teamSlug = params.team
	const seksjon = params.seksjon
	if (!teamSlug || !seksjon) throw new Response("Mangler parametere", { status: 400 })

	const teamRecord = await getTeamBySlug(teamSlug)
	if (!teamRecord) throw new Response("Team ikke funnet", { status: 404 })

	const section = await getSectionBySlug(seksjon)
	if (!section || section.id !== teamRecord.sectionId) throw new Response("Seksjon/team mismatch", { status: 404 })

	// Check authorization: team admin (admin/product_owner/tech_lead) or any team member
	if (!canManageTeam(authedUser, teamRecord.id, section.id)) {
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

function economyTypeLabel(type: EconomySystemType | null): string {
	if (!type) return "Ja"
	return economySystemTypeLabels[type]
}

function isUserRole(r: string): r is keyof typeof userRoleLabels {
	return r in userRoleLabels
}

function roleLabel(r: string): string {
	return isUserRole(r) ? userRoleLabels[r] : r
}

type TeamUser = { navIdent: string; name: string; roles: readonly string[] }

function TeamMedlemmer({ teamUsers }: { teamUsers: TeamUser[] }) {
	const utviklere = teamUsers.filter((u) => !u.roles.some((r) => r === "tech_lead" || r === "product_owner"))

	if (utviklere.length === 0) return null

	return (
		<VStack gap="space-4">
			<Heading size="large" level="3">
				Teammedlemmer
			</Heading>
			<div style={{ columns: "3 200px", columnGap: "var(--a-spacing-8)" }}>
				{utviklere.map((u) => (
					<Detail key={u.navIdent} style={{ breakInside: "avoid", paddingBottom: "var(--a-spacing-1)" }}>
						{u.name}
						{" – "}
						{u.roles.map(roleLabel).join(", ")}
					</Detail>
				))}
			</div>
		</VStack>
	)
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
		totalRoutinesIkkeGjennomfort,
		deploymentStats,
	} = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()

	return (
		<VStack gap="space-8">
			<HStack align="center" justify="space-between" wrap>
				<VStack gap="space-1">
					<Heading size="xlarge" level="2">
						{teamName}
					</Heading>
					{teamUsers.some((u) => u.roles.some((r) => r === "tech_lead" || r === "product_owner")) && (
						<HStack gap="space-6" wrap>
							{teamUsers
								.filter((u) => u.roles.some((r) => r === "tech_lead" || r === "product_owner"))
								.map((u) => (
									<Detail key={u.navIdent}>
										<strong>{u.roles.map(roleLabel).join(", ")}:</strong> {u.name}
									</Detail>
								))}
						</HStack>
					)}
				</VStack>
				{canManage && (
					<Button as={Link} to={`/seksjoner/${seksjon}/team/${team}/rediger`} variant="tertiary" size="small">
						Administrer
					</Button>
				)}
			</HStack>

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

			<DeploymentSummaryCards stats={deploymentStats} />

			{totalRoutinesIkkeGjennomfort > 0 && (
				<Link to={`/seksjoner/${seksjon}/team/${team}/rutiner`} style={{ textDecoration: "none", color: "inherit" }}>
					<Box padding="space-12" borderRadius="8" background="warning-moderate">
						<HStack align="center" gap="space-8">
							<VStack gap="space-0">
								<Heading size="medium" level="3">
									{totalRoutinesIkkeGjennomfort}
								</Heading>
								<Detail>Ikke-gjennomførte rutiner</Detail>
							</VStack>
						</HStack>
					</Box>
				</Link>
			)}

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
								<Table.HeaderCell scope="col">Økonomisystem</Table.HeaderCell>
								<Table.HeaderCell scope="col" align="right">
									Spørsmål
								</Table.HeaderCell>
								<Table.HeaderCell scope="col" align="right">
									Rutiner gjennomført
								</Table.HeaderCell>
								<Table.HeaderCell scope="col" align="right">
									Rutiner ikke gjennomført
								</Table.HeaderCell>
								<Table.HeaderCell scope="col" align="right">
									Gjennomganger med åpne punkter
								</Table.HeaderCell>
								<Table.HeaderCell scope="col" align="right">
									Status %
								</Table.HeaderCell>
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
										<Table.DataCell>
											{app.isEconomySystem === null ? (
												"–"
											) : app.isEconomySystem ? (
												<Tag variant="info" size="small">
													{economyTypeLabel(app.economySystemType)}
												</Tag>
											) : (
												"Nei"
											)}
										</Table.DataCell>
										<Table.DataCell align="right">
											{app.screeningProgress.answered}/{app.screeningProgress.total}
										</Table.DataCell>
										<Table.DataCell align="right">
											{app.routineCompliance.routinesTotal === 0 ? "–" : app.routineCompliance.routinesGjennomfort}
										</Table.DataCell>
										<Table.DataCell align="right">
											{app.routineCompliance.routinesTotal === 0 ? "–" : app.routineCompliance.routinesIkkeGjennomfort}
										</Table.DataCell>
										<Table.DataCell align="right">
											{app.routineCompliance.routinesMaaFolgesOpp === 0 && app.routineCompliance.routinesTotal === 0
												? "–"
												: app.routineCompliance.routinesMaaFolgesOpp}
										</Table.DataCell>
										<Table.DataCell align="right">
											{app.routineCompliance.routinesTotal === 0
												? "–"
												: `${Math.round((app.routineCompliance.routinesGjennomfort / app.routineCompliance.routinesTotal) * 100)}%`}
										</Table.DataCell>
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
			{teamUsers.length > 0 && <TeamMedlemmer teamUsers={teamUsers} />}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
