import { Alert, BodyLong, Button, Heading, HStack, Search, Select, Switch, Table, Tag, VStack } from "@navikt/ds-react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, useActionData, useLoaderData, useNavigation } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import {
	getLastSyncTimestamp,
	getNaisTeamAppCounts,
	getNaisTeams,
	linkNaisTeamToSection,
	unlinkNaisTeamFromSection,
	updateNaisTeamStatus,
} from "~/db/queries/nais.server"
import { getSections } from "~/db/queries/sections.server"
import { getAuthenticatedUser } from "~/lib/auth.server"
import { runFullNaisSync } from "~/lib/nais-sync.server"

export async function loader(_args: LoaderFunctionArgs) {
	const [teams, appCounts, lastSync, allSections] = await Promise.all([
		getNaisTeams(),
		getNaisTeamAppCounts(),
		getLastSyncTimestamp(),
		getSections(),
	])

	const sectionMap = new Map(allSections.map((s) => [s.id, s.name]))

	const naisTeams = teams.map((t) => ({
		slug: t.slug,
		displayName: t.displayName,
		status: t.status,
		appCount: Math.max(t.appCount, appCounts.get(t.id) ?? 0),
		discoveredAt: new Date(t.discoveredAt).toISOString().split("T")[0],
		sectionId: t.sectionId,
		sectionName: t.sectionId ? (sectionMap.get(t.sectionId) ?? null) : null,
	}))

	return data({
		teams: naisTeams,
		sections: allSections.map((s) => ({ id: s.id, name: s.name })),
		lastSync: lastSync ? new Date(lastSync).toISOString() : null,
	})
}

export async function action({ request }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const formData = await request.formData()
	const intent = formData.get("intent")
	const userName = user?.navIdent ?? "system"

	if (intent === "sync") {
		const token = process.env.NAIS_API_TOKEN || undefined
		const result = await runFullNaisSync(token)
		if (!result) {
			return data({ message: "Synkronisering kjører allerede" })
		}
		return data({ success: true, newTeams: result.teams.new })
	}

	if (intent === "link-section") {
		const teamSlug = formData.get("teamSlug") as string
		const sectionId = formData.get("sectionId") as string
		if (!teamSlug || !sectionId) throw new Response("Mangler data", { status: 400 })
		await linkNaisTeamToSection(teamSlug, sectionId, userName)
		return data({ success: true })
	}

	if (intent === "unlink-section") {
		const teamSlug = formData.get("teamSlug") as string
		if (!teamSlug) throw new Response("Mangler team", { status: 400 })
		await unlinkNaisTeamFromSection(teamSlug, userName)
		return data({ success: true })
	}

	const teamSlug = formData.get("teamSlug")
	const actionType = formData.get("action")

	if (typeof teamSlug !== "string" || !teamSlug) {
		throw new Response("Mangler team", { status: 400 })
	}

	if (actionType !== "monitor" && actionType !== "ignore") {
		throw new Response("Ugyldig handling", { status: 400 })
	}

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
	const { teams, sections, lastSync } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const navigation = useNavigation()
	const isSyncing = navigation.state === "submitting" && navigation.formData?.get("intent") === "sync"

	const [hideEmpty, setHideEmpty] = useState(false)
	const [onlyUnmonitored, setOnlyUnmonitored] = useState(false)
	const [searchQuery, setSearchQuery] = useState("")

	const filteredTeams = teams.filter((t) => {
		if (hideEmpty && t.appCount === 0) return false
		if (onlyUnmonitored && t.status !== "pending") return false
		if (searchQuery) {
			const q = searchQuery.toLowerCase()
			return t.slug.toLowerCase().includes(q) || (t.displayName?.toLowerCase().includes(q) ?? false)
		}
		return true
	})

	return (
		<VStack gap="space-6">
			<Heading size="xlarge" level="2">
				Nais-overvåking
			</Heading>

			{actionData && "success" in actionData && actionData.success && "newTeams" in actionData && (
				<Alert variant="success">Synkronisering fullført. {String(actionData.newTeams)} nye team oppdaget.</Alert>
			)}
			{actionData && "message" in actionData && !("success" in actionData) && (
				<Alert variant="warning">{String(actionData.message)}</Alert>
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

			<HStack gap="space-6" align="center" wrap>
				<Search
					label="Søk etter team"
					size="small"
					variant="simple"
					value={searchQuery}
					onChange={setSearchQuery}
					onClear={() => setSearchQuery("")}
					style={{ maxWidth: "16rem" }}
				/>
				<Switch size="small" checked={hideEmpty} onChange={() => setHideEmpty(!hideEmpty)}>
					Skjul team uten apper
				</Switch>
				<Switch size="small" checked={onlyUnmonitored} onChange={() => setOnlyUnmonitored(!onlyUnmonitored)}>
					Kun ikke-overvåkede
				</Switch>
			</HStack>

			{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
			<section className="table-scroll" tabIndex={0} aria-label="Nais-team">
				<Table>
					<Table.Header>
						<Table.Row>
							<Table.HeaderCell scope="col">Team</Table.HeaderCell>
							<Table.HeaderCell scope="col">Seksjon</Table.HeaderCell>
							<Table.HeaderCell scope="col">Status</Table.HeaderCell>
							<Table.HeaderCell scope="col" align="right">
								Applikasjoner
							</Table.HeaderCell>
							<Table.HeaderCell scope="col">Oppdaget</Table.HeaderCell>
							<Table.HeaderCell scope="col">Handlinger</Table.HeaderCell>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{filteredTeams.map((team) => (
							<Table.Row key={team.slug}>
								<Table.DataCell>
									<Link to={`/nais-overvaking/${team.slug}`}>{team.slug}</Link>
									{team.displayName && team.displayName !== team.slug && <> ({team.displayName})</>}
								</Table.DataCell>
								<Table.DataCell>
									{team.sectionName ? (
										<HStack gap="space-2" align="center">
											<Tag variant="info" size="xsmall">
												{team.sectionName}
											</Tag>
											<Form method="post" style={{ display: "inline" }}>
												<input type="hidden" name="intent" value="unlink-section" />
												<input type="hidden" name="teamSlug" value={team.slug} />
												<Button variant="tertiary-neutral" size="xsmall" type="submit" title="Fjern seksjon">
													✕
												</Button>
											</Form>
										</HStack>
									) : (
										<Form method="post">
											<input type="hidden" name="intent" value="link-section" />
											<input type="hidden" name="teamSlug" value={team.slug} />
											<HStack gap="space-2" align="end">
												<Select label="" name="sectionId" size="small" hideLabel style={{ minWidth: "10rem" }}>
													<option value="">Velg seksjon</option>
													{sections.map((s) => (
														<option key={s.id} value={s.id}>
															{s.name}
														</option>
													))}
												</Select>
												<Button variant="tertiary" size="xsmall" type="submit">
													Koble
												</Button>
											</HStack>
										</Form>
									)}
								</Table.DataCell>
								<Table.DataCell>
									<Tag variant={statusTagVariant[team.status]} size="small">
										{statusLabel[team.status]}
									</Tag>
								</Table.DataCell>
								<Table.DataCell align="right">{team.appCount}</Table.DataCell>
								<Table.DataCell>{new Date(team.discoveredAt).toLocaleDateString("nb-NO")}</Table.DataCell>
								<Table.DataCell>
									{team.status === "pending" && (
										<Form method="post">
											<input type="hidden" name="teamSlug" value={team.slug} />
											<HStack gap="space-2">
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
											</HStack>
										</Form>
									)}
								</Table.DataCell>
							</Table.Row>
						))}
						{filteredTeams.length === 0 && (
							<Table.Row>
								<Table.DataCell colSpan={6}>Ingen Nais-team oppdaget ennå. Trykk «Synkroniser nå».</Table.DataCell>
							</Table.Row>
						)}
					</Table.Body>
				</Table>
			</section>

			<Link to="/nais-overvaking/endringslogg">Vis endringslogg</Link>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
