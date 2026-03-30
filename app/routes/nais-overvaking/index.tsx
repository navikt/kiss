import { Alert, BodyLong, Button, Heading, HStack, Table, Tag, VStack } from "@navikt/ds-react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, useActionData, useLoaderData, useNavigation } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getRecentAuditLog } from "~/db/queries/audit.server"
import {
	getLastSyncTimestamp,
	getNaisTeamAppCounts,
	getNaisTeams,
	updateNaisTeamStatus,
} from "~/db/queries/nais.server"
import { getAuthenticatedUser } from "~/lib/auth.server"
import { runFullNaisSync } from "~/lib/nais-sync.server"

export async function loader(_args: LoaderFunctionArgs) {
	const [teams, appCounts, lastSync, auditEntries] = await Promise.all([
		getNaisTeams(),
		getNaisTeamAppCounts(),
		getLastSyncTimestamp(),
		getRecentAuditLog(50),
	])

	const naisTeams = teams.map((t) => ({
		slug: t.slug,
		displayName: t.displayName,
		status: t.status,
		appCount: appCounts.get(t.id) ?? 0,
		discoveredAt: new Date(t.discoveredAt).toISOString().split("T")[0],
	}))

	const naisAudit = auditEntries.filter((e) => e.entityType === "nais_team" || e.entityType === "nais_sync")

	return data({
		teams: naisTeams,
		lastSync: lastSync ? new Date(lastSync).toISOString() : null,
		auditEntries: naisAudit,
	})
}

export async function action({ request }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const formData = await request.formData()
	const intent = formData.get("intent")

	if (intent === "sync") {
		const token = process.env.NAIS_API_TOKEN || undefined
		const result = await runFullNaisSync(token)
		if (!result) {
			return data({ message: "Synkronisering kjører allerede" })
		}
		return data({ success: true, newTeams: result.teams.new })
	}

	const teamSlug = formData.get("teamSlug")
	const actionType = formData.get("action")

	if (typeof teamSlug !== "string" || !teamSlug) {
		throw new Response("Mangler team", { status: 400 })
	}

	if (actionType !== "monitor" && actionType !== "ignore") {
		throw new Response("Ugyldig handling", { status: 400 })
	}

	const userName = user?.navIdent ?? "system"
	const newStatus = actionType === "monitor" ? "monitored" : "ignored"
	await updateNaisTeamStatus(teamSlug, newStatus, userName)

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
	const { teams, lastSync, auditEntries } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const navigation = useNavigation()
	const isSyncing = navigation.state === "submitting" && navigation.formData?.get("intent") === "sync"

	return (
		<VStack gap="space-6">
			<Heading size="xlarge" level="2">
				Nais-overvåking
			</Heading>

			{actionData && "success" in actionData && actionData.success && "newTeams" in actionData && (
				<Alert variant="success">Synkronisering fullført. {actionData.newTeams} nye team oppdaget.</Alert>
			)}
			{actionData && "message" in actionData && !("success" in actionData) && (
				<Alert variant="warning">{actionData.message}</Alert>
			)}

			<HStack gap="space-4" align="center">
				<BodyLong>
					Overvåk Nais-plattformen for automatisk oppdagelse av applikasjoner.
					{lastSync && <> Siste synkronisering: {new Date(lastSync).toLocaleString("nb-NO")}</>}
				</BodyLong>
				<Form method="post">
					<input type="hidden" name="intent" value="sync" />
					<Button type="submit" variant="secondary" size="small" loading={isSyncing}>
						{isSyncing ? "Synkroniserer…" : "Synkroniser nå"}
					</Button>
				</Form>
			</HStack>

			{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
			<section className="table-scroll" tabIndex={0} aria-label="Nais-team">
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
								<Table.DataCell>
									{team.slug}
									{team.displayName && team.displayName !== team.slug && <> ({team.displayName})</>}
								</Table.DataCell>
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
						{teams.length === 0 && (
							<Table.Row>
								<Table.DataCell colSpan={5}>Ingen Nais-team oppdaget ennå. Trykk «Synkroniser nå».</Table.DataCell>
							</Table.Row>
						)}
					</Table.Body>
				</Table>
			</section>

			{auditEntries.length > 0 && (
				<VStack gap="space-4">
					<Heading size="medium" level="3">
						Endringslogg
					</Heading>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
					<section className="table-scroll" tabIndex={0} aria-label="Endringslogg Nais-overvåking">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Tidspunkt</Table.HeaderCell>
									<Table.HeaderCell scope="col">Handling</Table.HeaderCell>
									<Table.HeaderCell scope="col">Detaljer</Table.HeaderCell>
									<Table.HeaderCell scope="col">Utført av</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{auditEntries.map((entry) => (
									<Table.Row key={entry.id}>
										<Table.DataCell>{new Date(entry.performedAt).toLocaleString("nb-NO")}</Table.DataCell>
										<Table.DataCell>{entry.action}</Table.DataCell>
										<Table.DataCell>
											{entry.entityId}
											{entry.newValue ? ` → ${entry.newValue}` : ""}
										</Table.DataCell>
										<Table.DataCell>{entry.performedBy}</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				</VStack>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
