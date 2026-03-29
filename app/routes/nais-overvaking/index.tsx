import { BodyLong, Button, Heading, Table, Tag, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Form, useLoaderData } from "react-router"

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
						<Table.HeaderCell>Team</Table.HeaderCell>
						<Table.HeaderCell>Status</Table.HeaderCell>
						<Table.HeaderCell>Applikasjoner</Table.HeaderCell>
						<Table.HeaderCell>Oppdaget</Table.HeaderCell>
						<Table.HeaderCell>Handlinger</Table.HeaderCell>
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
											<Button type="submit" name="action" value="monitor" size="xsmall" variant="primary">
												Overvåk
											</Button>
											<Button type="submit" name="action" value="ignore" size="xsmall" variant="tertiary">
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
