import { BodyLong, Heading, Table, VStack } from "@navikt/ds-react"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { UserDisplayName } from "~/components/UserDisplayName"
import { getArchivedTeamApps, getSectionBySlug, getTeamBySlug } from "~/db/queries/sections.server"
import { getUserNamesByNavIdents } from "~/db/queries/users.server"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import type { Route } from "./+types/index"

export async function loader({ params, request }: Route.LoaderArgs) {
	await requireAuthenticatedUser(request)

	const { seksjon, team: teamSlug } = params
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })
	if (!teamSlug) throw new Response("Mangler team", { status: 400 })

	const [team, section] = await Promise.all([getTeamBySlug(teamSlug), getSectionBySlug(seksjon)])
	if (!team) throw new Response("Team ikke funnet", { status: 404 })
	if (!section) throw new Response("Seksjon ikke funnet", { status: 404 })
	if (team.sectionId !== section.id) throw new Response("Team tilhører ikke denne seksjonen", { status: 404 })

	const archivedApps = await getArchivedTeamApps(team.id)
	const archivedByNavIdents = [...new Set(archivedApps.map((a) => a.archivedBy).filter((v): v is string => v !== null))]
	const userNames = await getUserNamesByNavIdents(archivedByNavIdents)
	const nameFor = (navIdent: string | null) =>
		navIdent ? (userNames.get(navIdent.trim().toUpperCase()) ?? null) : null

	return data({
		seksjon,
		seksjonName: section.name,
		team: teamSlug,
		teamName: team.name,
		archivedApps: archivedApps.map((a) => ({
			appId: a.appId,
			appName: a.appName,
			archivedAt: a.archivedAt ? a.archivedAt.toISOString() : null,
			archivedBy: a.archivedBy,
			archivedByName: nameFor(a.archivedBy),
		})),
	})
}

export default function TeamArchivedApps() {
	const { seksjon, team, archivedApps } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-8">
			<Heading size="xlarge" level="2">
				Arkiverte applikasjoner
			</Heading>

			{archivedApps.length === 0 ? (
				<BodyLong>Ingen arkiverte applikasjoner for dette teamet.</BodyLong>
			) : (
				/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
				<section className="table-scroll" tabIndex={0} aria-label="Arkiverte applikasjoner for teamet">
					<Table>
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
								<Table.HeaderCell scope="col">Arkivert</Table.HeaderCell>
								<Table.HeaderCell scope="col">Arkivert av</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{archivedApps.map((app) => (
								<Table.Row key={app.appId}>
									<Table.DataCell>
										<Link to={`/seksjoner/${seksjon}/team/${team}/applikasjoner/${app.appId}/detaljer`}>
											{app.appName}
										</Link>
									</Table.DataCell>
									<Table.DataCell>
										{app.archivedAt ? new Date(app.archivedAt).toLocaleDateString("nb-NO") : "–"}
									</Table.DataCell>
									<Table.DataCell>
										{app.archivedBy ? <UserDisplayName navIdent={app.archivedBy} name={app.archivedByName} /> : "–"}
									</Table.DataCell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				</section>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
