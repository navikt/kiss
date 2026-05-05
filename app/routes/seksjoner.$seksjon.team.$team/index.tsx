import { PlusIcon } from "@navikt/aksel-icons"
import {
	Alert,
	BodyLong,
	Box,
	Button,
	Detail,
	Heading,
	HGrid,
	HStack,
	Modal,
	Search,
	Table,
	VStack,
} from "@navikt/ds-react"
import { useRef, useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, redirect, useActionData, useLoaderData } from "react-router"
import { ComplianceStatsPlaceholder } from "~/components/ComplianceStatsPlaceholder"
import { DeploymentSummaryCards } from "~/components/DeploymentSummaryCards"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAvailableAppsForTeam, linkAppToTeam } from "~/db/queries/applications.server"
import { getDeploymentVerificationAggregate } from "~/db/queries/deployment-audit.server"
import { getSectionBySlug, getTeamApps, getTeamBySlug } from "~/db/queries/sections.server"
import { getUserRoles } from "~/db/queries/users.server"
import { useFeatureFlags } from "~/hooks/useFeatureFlags"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { isAdmin } from "~/lib/authorization.server"
import { compliancePercent } from "~/lib/utils"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const seksjon = params.seksjon
	const teamSlug = params.team
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })
	if (!teamSlug) throw new Response("Mangler team", { status: 400 })

	const user = await getAuthenticatedUser(request)

	const [result, section, teamRecord] = await Promise.all([
		getTeamApps(teamSlug),
		getSectionBySlug(seksjon),
		getTeamBySlug(teamSlug),
	])
	if (!result) throw new Response("Team ikke funnet", { status: 404 })

	const appIds = result.apps.map((a) => a.appId)
	const { getScreeningProgressForApps } = await import("~/db/queries/screening.server")
	const [deploymentStats, screeningProgressMap] = await Promise.all([
		getDeploymentVerificationAggregate(appIds),
		getScreeningProgressForApps(appIds),
	])

	const admin = user ? isAdmin(user) : false
	let canAddApp = admin

	if (!canAddApp && user && teamRecord) {
		const roles = await getUserRoles(user.navIdent)
		canAddApp = roles.some((r) => r.devTeamId === teamRecord.id)
	}

	const availableApps = canAddApp && teamRecord ? await getAvailableAppsForTeam(teamRecord.id) : []

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
		teamId: teamRecord?.id ?? null,
		teamName: result.team.name,
		apps: result.apps.map((a) => ({
			...a,
			screeningProgress: screeningProgressMap.get(a.appId) ?? { answered: 0, total: 0 },
		})),
		canAdmin: admin,
		canAddApp,
		availableApps,
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

	// Check authorization: admin or team member
	const admin = isAdmin(authedUser)
	if (!admin) {
		const roles = await getUserRoles(authedUser.navIdent)
		const isMember = roles.some((r) => r.devTeamId === teamRecord.id)
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
		canAdmin,
		canAddApp,
		availableApps,
		totalImplemented,
		totalPartial,
		totalMangler,
		overallPercent,
		deploymentStats,
	} = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()

	const addAppModalRef = useRef<HTMLDialogElement>(null)
	const [appSearch, setAppSearch] = useState("")
	const [selectedAppId, setSelectedAppId] = useState<string | null>(null)
	const { showComplianceStats } = useFeatureFlags()

	const filteredApps = availableApps.filter((a) => a.name.toLowerCase().includes(appSearch.toLowerCase()))

	return (
		<VStack gap="space-8">
			<HStack align="center" justify="space-between" wrap>
				<Heading size="xlarge" level="2">
					{teamName}
				</Heading>
				{canAdmin && (
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
				{canAddApp && availableApps.length > 0 && (
					<Button
						variant="tertiary"
						size="small"
						icon={<PlusIcon aria-hidden />}
						onClick={() => {
							setAppSearch("")
							setSelectedAppId(null)
							addAppModalRef.current?.showModal()
						}}
					>
						Legg til applikasjon
					</Button>
				)}
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
								const answered = app.implemented + app.partial + app.notImplemented + app.notRelevant
								const unanswered = Math.max(0, app.total - answered)
								const pct = compliancePercent(app.implemented, app.partial, app.total, app.notRelevant)
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
												<Table.DataCell align="right">{unanswered}</Table.DataCell>
												<Table.DataCell align="right">{pct}%</Table.DataCell>
											</>
										)}
										<Table.DataCell>
											<Link to={`/seksjoner/${seksjon}/team/${team}/applikasjoner/${app.appId}/compliance`}>
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

			{/* Modal: Legg til applikasjon */}
			<Modal ref={addAppModalRef} header={{ heading: "Legg til applikasjon" }}>
				<Modal.Body>
					<VStack gap="space-6">
						<Search
							label="Søk etter applikasjon"
							value={appSearch}
							onChange={setAppSearch}
							onClear={() => setAppSearch("")}
							size="small"
						/>
						{filteredApps.length > 0 ? (
							<section
								className="table-scroll"
								// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1
								tabIndex={0}
								aria-label="Tilgjengelige applikasjoner"
								style={{ maxHeight: "20rem", overflow: "auto" }}
							>
								<Table size="small">
									<Table.Body>
										{filteredApps.map((app) => (
											<Table.Row
												key={app.id}
												selected={selectedAppId === app.id}
												onClick={() => setSelectedAppId(app.id)}
												style={{ cursor: "pointer" }}
											>
												<Table.DataCell>{app.name}</Table.DataCell>
											</Table.Row>
										))}
									</Table.Body>
								</Table>
							</section>
						) : (
							<BodyLong size="small">
								{appSearch ? "Ingen applikasjoner funnet." : "Ingen tilgjengelige applikasjoner."}
							</BodyLong>
						)}
					</VStack>
				</Modal.Body>
				<Modal.Footer>
					<Form method="post" onSubmit={() => addAppModalRef.current?.close()}>
						<input type="hidden" name="intent" value="add-app" />
						<input type="hidden" name="applicationId" value={selectedAppId ?? ""} />
						<HStack gap="space-4">
							<Button type="submit" size="small" disabled={!selectedAppId}>
								Legg til
							</Button>
							<Button type="button" variant="secondary" size="small" onClick={() => addAppModalRef.current?.close()}>
								Avbryt
							</Button>
						</HStack>
					</Form>
				</Modal.Footer>
			</Modal>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
