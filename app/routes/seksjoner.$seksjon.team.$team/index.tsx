import { Alert, BodyLong, Button, Heading, HStack, Select, Table, VStack } from "@navikt/ds-react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, useActionData, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAvailableAppsForTeam, linkAppToTeam, unlinkAppFromTeam } from "~/db/queries/applications.server"
import { getTeamApps } from "~/db/queries/sections.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { compliancePercent } from "~/lib/utils"

export async function loader({ params }: LoaderFunctionArgs) {
	const seksjon = params.seksjon
	const team = params.team
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })
	if (!team) throw new Response("Mangler team", { status: 400 })

	const result = await getTeamApps(team)
	if (!result) throw new Response("Team ikke funnet", { status: 404 })

	const availableApps = await getAvailableAppsForTeam(result.team.id)

	return data({
		seksjon,
		team,
		teamId: result.team.id,
		teamName: result.team.name,
		apps: result.apps,
		availableApps,
	})
}

type ActionResult = { success: true; message: string } | { success: false; error: string }

export async function action({ request }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	const userId = authedUser.navIdent

	const formData = await request.formData()
	const intent = formData.get("intent")

	switch (intent) {
		case "link-app": {
			const applicationId = formData.get("applicationId")
			const teamId = formData.get("teamId")
			if (typeof applicationId !== "string" || !applicationId || typeof teamId !== "string") {
				return data<ActionResult>({ success: false, error: "Velg en applikasjon." })
			}
			await linkAppToTeam(applicationId, teamId, userId)
			return data<ActionResult>({ success: true, message: "Applikasjon lagt til." })
		}

		case "unlink-app": {
			const applicationId = formData.get("applicationId")
			const teamId = formData.get("teamId")
			if (typeof applicationId !== "string" || typeof teamId !== "string") {
				return data<ActionResult>({ success: false, error: "Mangler påkrevde felt." })
			}
			await unlinkAppFromTeam(applicationId, teamId, userId)
			return data<ActionResult>({ success: true, message: "Applikasjon fjernet." })
		}

		default:
			return data<ActionResult>({ success: false, error: "Ugyldig handling." })
	}
}

export default function TeamDashboard() {
	const { seksjon, teamId, teamName, apps, availableApps } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()

	return (
		<VStack gap="space-8">
			<Heading size="xlarge" level="2">
				{teamName}
			</Heading>
			<BodyLong>
				Compliance-status per applikasjon for {teamName} i seksjon <Link to={`/seksjoner/${seksjon}`}>{seksjon}</Link>.
			</BodyLong>

			{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
			<section className="table-scroll" tabIndex={0} aria-label="Applikasjoner per team">
				<Table>
					<Table.Header>
						<Table.Row>
							<Table.HeaderCell scope="col">App</Table.HeaderCell>
							<Table.HeaderCell scope="col" align="right">
								Implementert
							</Table.HeaderCell>
							<Table.HeaderCell scope="col" align="right">
								Delvis
							</Table.HeaderCell>
							<Table.HeaderCell scope="col" align="right">
								Mangler
							</Table.HeaderCell>
							<Table.HeaderCell scope="col" align="right">
								Status %
							</Table.HeaderCell>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{apps.map((app) => {
							const pct = compliancePercent(app.implemented, app.partial, app.total)
							return (
								<Table.Row key={app.appId}>
									<Table.DataCell>
										<Link to={`/applikasjoner/${app.appId}/detaljer`}>{app.appName}</Link>
									</Table.DataCell>
									<Table.DataCell align="right">{app.implemented}</Table.DataCell>
									<Table.DataCell align="right">{app.partial}</Table.DataCell>
									<Table.DataCell align="right">{app.notImplemented}</Table.DataCell>
									<Table.DataCell align="right">{pct}%</Table.DataCell>
								</Table.Row>
							)
						})}
					</Table.Body>
				</Table>
			</section>

			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Administrer applikasjoner
				</Heading>

				{actionData && "success" in actionData && actionData.success && (
					<Alert variant="success">{actionData.message}</Alert>
				)}
				{actionData && "success" in actionData && !actionData.success && (
					<Alert variant="error">{actionData.error}</Alert>
				)}

				{apps.length > 0 && (
					/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
					<section className="table-scroll" tabIndex={0} aria-label="Tilknyttede applikasjoner">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
									<Table.HeaderCell scope="col">Handling</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{apps.map((app) => (
									<Table.Row key={app.appId}>
										<Table.DataCell>{app.appName}</Table.DataCell>
										<Table.DataCell>
											<Form method="post">
												<input type="hidden" name="intent" value="unlink-app" />
												<input type="hidden" name="applicationId" value={app.appId} />
												<input type="hidden" name="teamId" value={teamId} />
												<Button type="submit" variant="danger" size="xsmall">
													Fjern
												</Button>
											</Form>
										</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				)}

				{availableApps.length > 0 && (
					<Form method="post">
						<input type="hidden" name="intent" value="link-app" />
						<input type="hidden" name="teamId" value={teamId} />
						<HStack gap="space-4" align="end">
							<Select label="Velg applikasjon" name="applicationId" size="small">
								<option value="">Velg …</option>
								{availableApps.map((app) => (
									<option key={app.id} value={app.id}>
										{app.name}
									</option>
								))}
							</Select>
							<Button type="submit" variant="secondary" size="small">
								Legg til
							</Button>
						</HStack>
					</Form>
				)}

				{availableApps.length === 0 && apps.length === 0 && <BodyLong>Ingen applikasjoner tilgjengelig.</BodyLong>}
			</VStack>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
