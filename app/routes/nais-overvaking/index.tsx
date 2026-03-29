import { BodyLong, Button, Heading, Table, Tag, VStack } from "@navikt/ds-react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getNaisTeams, updateNaisTeamStatus } from "~/db/queries/nais.server"

export async function loader(_args: LoaderFunctionArgs) {
	const teams = await getNaisTeams()
	const naisTeams = teams.map((t) => ({
		slug: t.slug,
		status: t.status,
		appCount: 0,
		discoveredAt: t.discoveredAt.toISOString().split("T")[0],
	}))
	return data({ teams: naisTeams, lastSync: new Date().toISOString() })
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

	const newStatus = actionType === "monitor" ? "monitored" : "ignored"
	await updateNaisTeamStatus(teamSlug, newStatus, "system")

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

			<section className="table-scroll" tabIndex={-1} aria-label="Nais-team">
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
			</section>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
