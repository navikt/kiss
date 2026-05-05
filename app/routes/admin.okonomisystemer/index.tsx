import { BodyShort, Heading, Table, Tag, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { economySystemTypeLabels } from "~/db/schema/applications"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"

export { RouteErrorBoundary as ErrorBoundary }

export async function loader({ request }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const { getAllEconomyClassifications } = await import("~/db/queries/economy-classification.server")
	const { db } = await import("~/db/connection.server")
	const { monitoredApplications } = await import("~/db/schema/applications")
	const { inArray, and, isNull } = await import("drizzle-orm")

	const classifications = await getAllEconomyClassifications()

	if (classifications.length === 0) {
		return { items: [] }
	}

	const appIds = classifications.map((c) => c.applicationId)
	const apps = await db
		.select()
		.from(monitoredApplications)
		.where(and(inArray(monitoredApplications.id, appIds), isNull(monitoredApplications.archivedAt)))
	const appMap = new Map(apps.map((a) => [a.id, a]))

	const now = new Date()
	const items = classifications
		.filter((c) => c.isEconomySystem && appMap.has(c.applicationId))
		.map((c) => {
			const app = appMap.get(c.applicationId)!
			return {
				id: c.id,
				applicationId: c.applicationId,
				applicationName: app.name,
				economySystemType: c.economySystemType,
				justification: c.justification,
				validUntil: c.validUntil.toISOString(),
				isExpired: c.validUntil < now,
			}
		})

	return { items }
}

export default function AdminOkonomisystemer() {
	const { items } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-8" className="page-container">
			<Heading size="xlarge" level="1">
				Økonomisystemer
			</Heading>
			<BodyShort size="small" textColor="subtle">
				Oversikt over applikasjoner klassifisert som økonomisystem iht. Bestemmelser om økonomistyring i staten.
			</BodyShort>

			{items.length === 0 ? (
				<BodyShort>Ingen applikasjoner er klassifisert som økonomisystem ennå.</BodyShort>
			) : (
				// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1
				<section className="table-scroll" tabIndex={0} aria-label="Økonomisystemer">
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell>Applikasjon</Table.HeaderCell>
								<Table.HeaderCell>Type</Table.HeaderCell>
								<Table.HeaderCell>Begrunnelse</Table.HeaderCell>
								<Table.HeaderCell>Gyldig til</Table.HeaderCell>
								<Table.HeaderCell>Status</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{items.map((item) => (
								<Table.Row key={item.id}>
									<Table.DataCell>
										<Link to={`/applikasjoner/${item.applicationId}/compliance`}>{item.applicationName}</Link>
									</Table.DataCell>
									<Table.DataCell>
										{item.economySystemType && (
											<Tag variant="warning" size="xsmall">
												{economySystemTypeLabels[item.economySystemType as keyof typeof economySystemTypeLabels]}
											</Tag>
										)}
									</Table.DataCell>
									<Table.DataCell>
										<BodyShort size="small" truncate style={{ maxWidth: "300px" }}>
											{item.justification}
										</BodyShort>
									</Table.DataCell>
									<Table.DataCell>{new Date(item.validUntil).toLocaleDateString("nb-NO")}</Table.DataCell>
									<Table.DataCell>
										{item.isExpired ? (
											<Tag variant="error" size="xsmall">
												Utløpt
											</Tag>
										) : (
											<Tag variant="success" size="xsmall">
												Gyldig
											</Tag>
										)}
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
