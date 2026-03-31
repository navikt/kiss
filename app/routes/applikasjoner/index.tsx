import { Alert, BodyLong, Button, Heading, HStack, Select, Switch, Table, Tag, VStack } from "@navikt/ds-react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, useActionData, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAllTeams, getApplications, linkAppToTeam, unlinkAppFromTeam } from "~/db/queries/applications.server"
import { getAppsPersistence } from "~/db/queries/nais.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { compliancePercent } from "~/lib/utils"

const persistenceLabels: Record<string, string> = {
	cloud_sql_postgres: "PostgreSQL",
	nais_postgres: "Postgres",
	opensearch: "OpenSearch",
	bucket: "Bucket",
	valkey: "Valkey",
	oracle: "Oracle",
	other: "Annet",
}

export async function loader(_args: LoaderFunctionArgs) {
	const [apps, allTeams] = await Promise.all([getApplications(), getAllTeams()])
	const appIds = apps.map((a) => a.id)
	const persistenceMap = await getAppsPersistence(appIds)
	return data({ apps, allTeams, persistenceMap: Object.fromEntries(persistenceMap) })
}

type ActionResult = { success: true; message: string } | { success: false; error: string }

export async function action({ request }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	const userId = authedUser.navIdent

	const formData = await request.formData()
	const intent = formData.get("intent")

	switch (intent) {
		case "link-team": {
			const applicationId = formData.get("applicationId")
			const devTeamId = formData.get("devTeamId")
			if (typeof applicationId !== "string" || typeof devTeamId !== "string" || !devTeamId) {
				return data<ActionResult>({ success: false, error: "Velg et team." })
			}
			await linkAppToTeam(applicationId, devTeamId, userId)
			return data<ActionResult>({ success: true, message: "Team lagt til." })
		}

		case "unlink-team": {
			const applicationId = formData.get("applicationId")
			const devTeamId = formData.get("devTeamId")
			if (typeof applicationId !== "string" || typeof devTeamId !== "string") {
				return data<ActionResult>({ success: false, error: "Mangler påkrevde felt." })
			}
			await unlinkAppFromTeam(applicationId, devTeamId, userId)
			return data<ActionResult>({ success: true, message: "Team fjernet." })
		}

		default:
			return data<ActionResult>({ success: false, error: "Ugyldig handling." })
	}
}

export default function Applikasjoner() {
	const { apps, allTeams, persistenceMap } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const [showLinked, setShowLinked] = useState(false)

	const filteredApps = showLinked ? apps : apps.filter((a) => !a.primaryApplicationId)

	return (
		<VStack gap="space-6">
			<Heading size="xlarge" level="2">
				Applikasjoner
			</Heading>
			<BodyLong>Oversikt over overvåkede applikasjoner og deres compliance-status.</BodyLong>

			{actionData && "success" in actionData && actionData.success && (
				<Alert variant="success">{actionData.message}</Alert>
			)}
			{actionData && "success" in actionData && !actionData.success && (
				<Alert variant="error">{actionData.error}</Alert>
			)}

			<Switch size="small" checked={showLinked} onChange={() => setShowLinked(!showLinked)}>
				Vis lenkede applikasjoner
			</Switch>

			{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
			<section className="table-scroll" tabIndex={0} aria-label="Applikasjonstabell">
				<Table>
					<Table.Header>
						<Table.Row>
							<Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
							<Table.HeaderCell scope="col">Team</Table.HeaderCell>
							<Table.HeaderCell scope="col">Persistens</Table.HeaderCell>
							<Table.HeaderCell scope="col">Implementert</Table.HeaderCell>
							<Table.HeaderCell scope="col">Delvis</Table.HeaderCell>
							<Table.HeaderCell scope="col">Compliance</Table.HeaderCell>
							<Table.HeaderCell scope="col">Handling</Table.HeaderCell>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{filteredApps.map((app) => {
							const pct = compliancePercent(app.controlsImplemented, app.controlsPartial, app.controlsTotal)
							const linkedTeamSlugs = app.teams
							const availableTeams = allTeams.filter((t) => !linkedTeamSlugs.includes(t.slug))
							const appPersistence = persistenceMap[app.id] ?? []
							// Deduplicate persistence types for compact display
							const uniqueTypes = [...new Set(appPersistence.map((p: { type: string }) => p.type))]
							return (
								<Table.Row key={app.id}>
									<Table.DataCell>
										<HStack gap="space-2" align="center" wrap>
											<Link to={`/applikasjoner/${app.id}/detaljer`}>{app.name}</Link>
											{app.primaryApplicationId && (
												<Tag variant="alt1" size="xsmall">
													Lenket
												</Tag>
											)}
										</HStack>
									</Table.DataCell>
									<Table.DataCell>
										<HStack gap="space-2" wrap>
											{app.teams.map((teamSlug) => {
												const teamObj = allTeams.find((t) => t.slug === teamSlug)
												return (
													<HStack key={teamSlug} gap="space-1" align="center">
														<Tag variant="info" size="xsmall">
															{teamSlug}
														</Tag>
														{teamObj && (
															<Form method="post" style={{ display: "inline" }}>
																<input type="hidden" name="intent" value="unlink-team" />
																<input type="hidden" name="applicationId" value={app.id} />
																<input type="hidden" name="devTeamId" value={teamObj.id} />
																<Button type="submit" variant="tertiary" size="xsmall" aria-label={`Fjern ${teamSlug}`}>
																	✕
																</Button>
															</Form>
														)}
													</HStack>
												)
											})}
											{app.teams.length === 0 && "–"}
										</HStack>
									</Table.DataCell>
									<Table.DataCell>
										<HStack gap="space-1" wrap>
											{uniqueTypes.length > 0
												? uniqueTypes.map((type: string) => (
														<Tag key={type} variant="neutral" size="xsmall">
															{persistenceLabels[type] ?? type}
														</Tag>
													))
												: "–"}
										</HStack>
									</Table.DataCell>
									<Table.DataCell>
										{app.controlsImplemented} / {app.controlsTotal}
									</Table.DataCell>
									<Table.DataCell>{app.controlsPartial}</Table.DataCell>
									<Table.DataCell>
										<Tag variant={pct >= 80 ? "success" : pct >= 50 ? "warning" : "error"} size="small">
											{pct}%
										</Tag>
									</Table.DataCell>
									<Table.DataCell>
										<HStack gap="space-2" align="center">
											<Link to={`/applikasjoner/${app.id}/compliance`}>Vurder</Link>
											{availableTeams.length > 0 && (
												<Form method="post">
													<input type="hidden" name="intent" value="link-team" />
													<input type="hidden" name="applicationId" value={app.id} />
													<HStack gap="space-2" align="end">
														<Select label="Team" name="devTeamId" size="small" hideLabel>
															<option value="">Velg …</option>
															{availableTeams.map((t) => (
																<option key={t.id} value={t.id}>
																	{t.name}
																</option>
															))}
														</Select>
														<Button type="submit" variant="secondary" size="xsmall">
															Legg til team
														</Button>
													</HStack>
												</Form>
											)}
										</HStack>
									</Table.DataCell>
								</Table.Row>
							)
						})}
					</Table.Body>
				</Table>
			</section>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
