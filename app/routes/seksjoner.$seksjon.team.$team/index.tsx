import { BodyLong, Heading, Table, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"

interface AppComplianceStatus {
	appId: string
	appName: string
	implemented: number
	partial: number
	notImplemented: number
	total: number
}

export async function loader({ params }: LoaderFunctionArgs) {
	const seksjon = params.seksjon
	const team = params.team
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })
	if (!team) throw new Response("Mangler team", { status: 400 })

	const teamName = team
		.split("-")
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ")

	// Placeholder data – will be replaced with DB queries
	const apps: AppComplianceStatus[] = [
		{ appId: "app-001", appName: "Behandlingsflyt", implemented: 8, partial: 2, notImplemented: 2, total: 12 },
		{ appId: "app-002", appName: "Søknadsportal", implemented: 5, partial: 3, notImplemented: 4, total: 12 },
		{ appId: "app-003", appName: "Dokumentarkiv", implemented: 10, partial: 1, notImplemented: 1, total: 12 },
	]

	return data({ seksjon, team, teamName, apps })
}

export default function TeamDashboard() {
	const { seksjon, teamName, apps } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-8">
			<Heading size="xlarge" level="2">
				{teamName}
			</Heading>
			<BodyLong>
				Compliance-status per applikasjon for {teamName} i seksjon <Link to={`/seksjoner/${seksjon}`}>{seksjon}</Link>.
			</BodyLong>

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
						const pct = app.total > 0 ? Math.round(((app.implemented + app.partial * 0.5) / app.total) * 100) : 0
						return (
							<Table.Row key={app.appId}>
								<Table.DataCell>
									<Link to={`/applikasjoner/${app.appId}/compliance`}>{app.appName}</Link>
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
		</VStack>
	)
}
