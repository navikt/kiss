import { Alert, BodyLong, Button, Heading, HStack, Table, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getReports } from "~/db/queries/reports.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAuditor } from "~/lib/authorization.server"

export async function loader({ request }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAuditor(authedUser)

	const reports = await getReports()
	return data({
		reports: reports.map((r) => ({
			id: r.id,
			name: r.name,
			reportType: r.reportType,
			scope: r.scope,
			createdAt: r.createdAt.toISOString(),
			createdBy: r.createdBy,
		})),
	})
}

export default function Rapporter() {
	const { reports } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-6">
			<HStack justify="space-between" align="center">
				<Heading size="xlarge" level="2">
					Rapporter
				</Heading>
				<Link to="/rapporter/generer">
					<Button variant="primary" size="small" as="span">
						Generer rapport
					</Button>
				</Link>
			</HStack>
			<BodyLong>Generer og last ned compliance-rapporter.</BodyLong>

			{reports.length === 0 ? (
				<Alert variant="info">Ingen rapporter er generert ennå.</Alert>
			) : (
				/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
				<section className="table-scroll" tabIndex={0} aria-label="Rapporttabell">
					<Table>
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Navn</Table.HeaderCell>
								<Table.HeaderCell scope="col">Type</Table.HeaderCell>
								<Table.HeaderCell scope="col">Omfang</Table.HeaderCell>
								<Table.HeaderCell scope="col">Opprettet</Table.HeaderCell>
								<Table.HeaderCell scope="col">Opprettet av</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{reports.map((r) => (
								<Table.Row key={r.id}>
									<Table.DataCell>
										<Link to={`/rapporter/${r.id}`}>{r.name}</Link>
									</Table.DataCell>
									<Table.DataCell>{r.reportType}</Table.DataCell>
									<Table.DataCell>{r.scope === "all" ? "Alle seksjoner" : "Seksjon"}</Table.DataCell>
									<Table.DataCell>{new Date(r.createdAt).toLocaleString("nb-NO")}</Table.DataCell>
									<Table.DataCell>{r.createdBy}</Table.DataCell>
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
