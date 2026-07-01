import { Alert, BodyLong, Heading, HStack, Table, Tag, VStack } from "@navikt/ds-react"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getNaisTeamDetail } from "~/db/queries/nais.server"
import { fetchNaisApps, getNaisToken } from "~/lib/nais.server"
import type { Route } from "./+types/index"

const persistenceLabels: Record<string, string> = {
	cloud_sql_postgres: "PostgreSQL",
	nais_postgres: "Postgres",
	opensearch: "OpenSearch",
	bucket: "Bucket",
	valkey: "Valkey",
	oracle: "Oracle",
	other: "Annet",
}

const statusLabel: Record<string, string> = {
	monitored: "Overvåket",
	pending: "Venter",
	ignored: "Ignorert",
}

const statusVariant: Record<string, "success" | "warning" | "neutral"> = {
	monitored: "success",
	pending: "warning",
	ignored: "neutral",
}

export async function loader({ params }: Route.LoaderArgs) {
	const teamSlug = params.team
	if (!teamSlug) throw new Response("Mangler team-slug", { status: 400 })

	const detail = await getNaisTeamDetail(teamSlug)
	if (!detail) throw new Response("Nais-team ikke funnet", { status: 404 })

	let fromApi = false

	// If no synced apps (unmonitored team), fetch live from Nais API
	if (detail.apps.length === 0) {
		try {
			const token = getNaisToken()
			const naisApps = await fetchNaisApps(token, teamSlug)
			detail.apps = naisApps.map((app) => ({
				appId: "",
				appName: app.name,
				environments: [{ cluster: app.cluster, namespace: app.namespace }],
				persistence: app.persistence.map((p) => ({ type: p.type, name: p.name, version: p.version ?? null })),
			}))
			fromApi = true
		} catch {
			// Nais API unavailable — show empty list
		}
	}

	return data({ detail, fromApi })
}

export default function NaisTeamDetalj() {
	const { detail, fromApi } = useLoaderData<typeof loader>()
	const { team, sectionName, sectionSlug, apps } = detail

	return (
		<VStack gap="space-8">
			<div>
				<Link to="/admin/nais-overvaking">← Nais-overvåking</Link>
				<Heading size="xlarge" level="2" spacing>
					{team.slug}
				</Heading>
				<HStack gap="space-4" wrap>
					<Tag variant={statusVariant[team.status]} size="small">
						{statusLabel[team.status]}
					</Tag>
					{sectionName && (
						<Link to={sectionSlug ? `/seksjoner/${sectionSlug}` : "#"}>
							<Tag variant="info" size="small">
								Seksjon: {sectionName}
							</Tag>
						</Link>
					)}
					<BodyLong size="small">Oppdaget {new Date(team.discoveredAt).toLocaleDateString("nb-NO")}</BodyLong>
				</HStack>
			</div>

			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Applikasjoner ({apps.length})
				</Heading>

				{fromApi && (
					<Alert variant="info" size="small">
						Teamet er ikke overvåket. Applikasjonene hentes direkte fra Nais API.
					</Alert>
				)}

				{apps.length > 0 ? (
					/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
					<section className="table-scroll" tabIndex={0} aria-label="Applikasjoner i teamet">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
									<Table.HeaderCell scope="col">Miljøer</Table.HeaderCell>
									<Table.HeaderCell scope="col">Persistens</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{apps.map((app, idx) => (
									<Table.Row key={app.appId || `api-${idx}`}>
										<Table.DataCell>
											{app.appId ? <Link to={`/applikasjoner/${app.appId}/detaljer`}>{app.appName}</Link> : app.appName}
										</Table.DataCell>
										<Table.DataCell>
											<HStack gap="space-1" wrap>
												{app.environments.map((env) => (
													<Tag key={`${env.cluster}-${env.namespace}`} variant="neutral" size="xsmall">
														{env.cluster}
													</Tag>
												))}
											</HStack>
										</Table.DataCell>
										<Table.DataCell>
											<HStack gap="space-1" wrap>
												{app.persistence.length > 0
													? app.persistence.map((p) => (
															<Tag key={`${p.type}-${p.name}`} variant="info" size="xsmall">
																{persistenceLabels[p.type] ?? p.type}
																{p.version ? ` (${p.version})` : ""}
															</Tag>
														))
													: "–"}
											</HStack>
										</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				) : (
					<BodyLong>Ingen applikasjoner er registrert for dette teamet.</BodyLong>
				)}
			</VStack>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
