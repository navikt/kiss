import { BodyLong, Heading, Table, Tag, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { compliancePercent, mockApps } from "~/lib/mock-data.server"

export async function loader(_args: LoaderFunctionArgs) {
	return data({ apps: mockApps })
}

export default function Applikasjoner() {
	const { apps } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-6">
			<Heading size="xlarge" level="2">
				Applikasjoner
			</Heading>
			<BodyLong>Oversikt over overvåkede applikasjoner og deres compliance-status.</BodyLong>

			<section className="table-scroll" tabIndex={-1} aria-label="Applikasjonstabell">
				<Table>
					<Table.Header>
						<Table.Row>
							<Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
							<Table.HeaderCell scope="col">Team</Table.HeaderCell>
							<Table.HeaderCell scope="col">Implementert</Table.HeaderCell>
							<Table.HeaderCell scope="col">Delvis</Table.HeaderCell>
							<Table.HeaderCell scope="col">Compliance</Table.HeaderCell>
							<Table.HeaderCell scope="col">Handling</Table.HeaderCell>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{apps.map((app) => {
							const pct = compliancePercent(app.controlsImplemented, app.controlsPartial, app.controlsTotal)
							return (
								<Table.Row key={app.id}>
									<Table.DataCell>{app.name}</Table.DataCell>
									<Table.DataCell>{app.teams.join(", ")}</Table.DataCell>
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
										<Link to={`/applikasjoner/${app.id}/compliance`}>Vurder</Link>
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
