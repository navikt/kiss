import { BodyLong, Button, Heading, Table, Tag, VStack } from "@navikt/ds-react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"

interface NaisTeamInfo {
	slug: string
	status: "pending" | "monitored" | "ignored"
	appCount: number
	discoveredAt: string
}

export async function loader(_args: LoaderFunctionArgs) {
	// Placeholder data
	const teams: NaisTeamInfo[] = [
		{ slug: "team-pensjon", status: "monitored", appCount: 12, discoveredAt: "2026-03-01" },
		{ slug: "team-arbeid", status: "monitored", appCount: 8, discoveredAt: "2026-03-01" },
		{ slug: "team-helserefusjon", status: "pending", appCount: 5, discoveredAt: "2026-03-28" },
		{ slug: "team-deploy", status: "ignored", appCount: 3, discoveredAt: "2026-03-15" },
	]

	return data({ teams, lastSync: "2026-03-29T07:00:00Z" })
}

export async function action({ request }: ActionFunctionArgs) {
	const formData = await request.formData()
	const teamSlug = formData.get("teamSlug")
	const actionType = formData.get("action")

	if (typeof teamSlug !== "string" || !teamSlug) {
		throw new Response("Mangler team", { status: 400 })
	}

	if (actionType !== "monitor" && actionType !== "ignore") {
		throw new Response("Ugyldig handling", { status: 400 })
	}

	// Placeholder – will persist to DB
	return data({ success: true, teamSlug, action: actionType })
}

const statusTagVariant: Record<string, "success" | "warning" | "neutral"> = {
	monitored: "success",
	pending: "warning",
	ignored: "neutral",
}

const statusLabel: Record<string, string> = {
	monitored: "Overvåket",
	pending: "Venter",
	ignored: "Ignorert",
}

export default function NaisOvervaking() {
	const { teams, lastSync } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-6">
			<Heading size="xlarge" level="2">
				Nais-overvåking
			</Heading>
			<BodyLong>
				Overvåk Nais-plattformen for automatisk oppdagelse av applikasjoner. Siste synkronisering:{" "}
				{new Date(lastSync).toLocaleString("nb-NO")}
			</BodyLong>

			<Table>
				<Table.Header>
					<Table.Row>
						<Table.HeaderCell scope="col">Team</Table.HeaderCell>
						<Table.HeaderCell scope="col">Status</Table.HeaderCell>
						<Table.HeaderCell scope="col">Applikasjoner</Table.HeaderCell>
						<Table.HeaderCell scope="col">Oppdaget</Table.HeaderCell>
						<Table.HeaderCell scope="col">Handlinger</Table.HeaderCell>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{teams.map((team) => (
						<Table.Row key={team.slug}>
							<Table.DataCell>{team.slug}</Table.DataCell>
							<Table.DataCell>
								<Tag variant={statusTagVariant[team.status]} size="small">
									{statusLabel[team.status]}
								</Tag>
							</Table.DataCell>
							<Table.DataCell>{team.appCount}</Table.DataCell>
							<Table.DataCell>{new Date(team.discoveredAt).toLocaleDateString("nb-NO")}</Table.DataCell>
							<Table.DataCell>
								{team.status === "pending" && (
									<Form method="post">
										<input type="hidden" name="teamSlug" value={team.slug} />
										<div style={{ display: "flex", gap: "0.5rem" }}>
											<Button
												type="submit"
												name="action"
												value="monitor"
												size="xsmall"
												variant="primary"
												aria-label={`Overvåk ${team.slug}`}
											>
												Overvåk
											</Button>
											<Button
												type="submit"
												name="action"
												value="ignore"
												size="xsmall"
												variant="tertiary"
												aria-label={`Ignorer ${team.slug}`}
											>
												Ignorer
											</Button>
										</div>
									</Form>
								)}
							</Table.DataCell>
						</Table.Row>
					))}
				</Table.Body>
			</Table>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
