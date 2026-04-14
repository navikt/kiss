import {
	Alert,
	BodyLong,
	BodyShort,
	Button,
	Heading,
	HStack,
	Modal,
	Search,
	Select,
	Switch,
	Table,
	Tabs,
	VStack,
} from "@navikt/ds-react"
import { useRef, useState } from "react"
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
		await updateNaisTeamStatus(teamSlug, "monitored", userName)
		return data({ success: true })
	}

	if (intent === "unlink-section") {
		const teamSlug = formData.get("teamSlug") as string
		if (!teamSlug) throw new Response("Mangler team", { status: 400 })
		await unlinkNaisTeamFromSection(teamSlug, userName)
		return data({ success: true })
	}

	throw new Response("Ugyldig handling", { status: 400 })
}

export default function NaisOvervaking() {
	const { teams, sections, lastSync } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const navigation = useNavigation()
	const isSyncing = navigation.state === "submitting" && navigation.formData?.get("intent") === "sync"

	const [hideEmpty, setHideEmpty] = useState(false)
	const [searchQuery, setSearchQuery] = useState("")
	const unlinkModalRef = useRef<HTMLDialogElement>(null)
	const [unlinkTarget, setUnlinkTarget] = useState<{ slug: string; sectionName: string } | null>(null)
	const [sort, setSort] = useState<{ orderBy: string; direction: "ascending" | "descending" } | undefined>()

	const handleSort = (sortKey: string) =>
		setSort((prev) =>
			prev?.orderBy === sortKey && prev.direction === "ascending"
				? { orderBy: sortKey, direction: "descending" }
				: { orderBy: sortKey, direction: "ascending" },
		)

	const filteredTeams = teams.filter((t) => {
		if (hideEmpty && t.appCount === 0) return false
		if (searchQuery) {
			const q = searchQuery.toLowerCase()
			return t.slug.toLowerCase().includes(q) || (t.displayName?.toLowerCase().includes(q) ?? false)
		}
		return true
	})

	const unlinkedTeams = filteredTeams.filter((t) => !t.sectionId)

	function sortTeams<T extends (typeof filteredTeams)[number]>(list: T[]): T[] {
		if (!sort) return list
		return [...list].sort((a, b) => {
			const dir = sort.direction === "ascending" ? 1 : -1
			switch (sort.orderBy) {
				case "slug":
					return dir * a.slug.localeCompare(b.slug, "nb")
				case "appCount":
					return dir * (a.appCount - b.appCount)
				case "discoveredAt":
					return dir * a.discoveredAt.localeCompare(b.discoveredAt)
				default:
					return 0
			}
		})
	}

	const sortedUnlinkedTeams = sortTeams(unlinkedTeams)

	// Group linked teams by sectionId
	const teamsBySection = new Map<string, typeof filteredTeams>()
	for (const t of filteredTeams) {
		if (!t.sectionId) continue
		const list = teamsBySection.get(t.sectionId) ?? []
		list.push(t)
		teamsBySection.set(t.sectionId, list)
	}

	// Build tab list: one per section that has teams, plus "Uten seksjon"
	const sectionTabs = sections
		.filter((s) => teamsBySection.has(s.id))
		.map((s) => ({
			id: s.id,
			name: s.name,
			teams: teamsBySection.get(s.id) ?? [],
		}))

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
					Skjul team uten applikasjoner
				</Switch>
			</HStack>

			<Tabs defaultValue="unlinked">
				<Tabs.List>
					<Tabs.Tab value="unlinked" label={`Uten seksjon (${unlinkedTeams.length})`} />
					{sectionTabs.map((s) => (
						<Tabs.Tab key={s.id} value={s.id} label={`${s.name} (${s.teams.length})`} />
					))}
				</Tabs.List>

				<Tabs.Panel value="unlinked">
					<VStack gap="space-4" style={{ paddingTop: "var(--ax-space-4)" }}>
						{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
						<section className="table-scroll" tabIndex={0} aria-label="Team uten seksjon">
							<Table sort={sort} onSortChange={handleSort}>
								<Table.Header>
									<Table.Row>
										<Table.ColumnHeader sortKey="slug" sortable scope="col">
											Team
										</Table.ColumnHeader>
										<Table.ColumnHeader sortKey="appCount" sortable scope="col" align="right">
											Applikasjoner
										</Table.ColumnHeader>
										<Table.ColumnHeader sortKey="discoveredAt" sortable scope="col">
											Oppdaget
										</Table.ColumnHeader>
										<Table.HeaderCell scope="col">Koble til seksjon</Table.HeaderCell>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{sortedUnlinkedTeams.map((team) => (
										<Table.Row key={team.slug}>
											<Table.DataCell>
												<Link to={`/admin/nais-overvaking/${team.slug}`}>{team.slug}</Link>
												{team.displayName && team.displayName !== team.slug && <> ({team.displayName})</>}
											</Table.DataCell>
											<Table.DataCell align="right">{team.appCount}</Table.DataCell>
											<Table.DataCell>{new Date(team.discoveredAt).toLocaleDateString("nb-NO")}</Table.DataCell>
											<Table.DataCell>
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
											</Table.DataCell>
										</Table.Row>
									))}
									{unlinkedTeams.length === 0 && (
										<Table.Row>
											<Table.DataCell colSpan={4}>Alle team er koblet til en seksjon.</Table.DataCell>
										</Table.Row>
									)}
								</Table.Body>
							</Table>
						</section>
					</VStack>
				</Tabs.Panel>

				{sectionTabs.map((s) => (
					<Tabs.Panel key={s.id} value={s.id}>
						<VStack gap="space-4" style={{ paddingTop: "var(--ax-space-4)" }}>
							{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
							<section className="table-scroll" tabIndex={0} aria-label={`Team i ${s.name}`}>
								<Table sort={sort} onSortChange={handleSort}>
									<Table.Header>
										<Table.Row>
											<Table.ColumnHeader sortKey="slug" sortable scope="col">
												Team
											</Table.ColumnHeader>
											<Table.ColumnHeader sortKey="appCount" sortable scope="col" align="right">
												Applikasjoner
											</Table.ColumnHeader>
											<Table.ColumnHeader sortKey="discoveredAt" sortable scope="col">
												Oppdaget
											</Table.ColumnHeader>
											<Table.HeaderCell scope="col" />
										</Table.Row>
									</Table.Header>
									<Table.Body>
										{sortTeams(s.teams).map((team) => (
											<Table.Row key={team.slug}>
												<Table.DataCell>
													<Link to={`/admin/nais-overvaking/${team.slug}`}>{team.slug}</Link>
													{team.displayName && team.displayName !== team.slug && <> ({team.displayName})</>}
												</Table.DataCell>
												<Table.DataCell align="right">{team.appCount}</Table.DataCell>
												<Table.DataCell>{new Date(team.discoveredAt).toLocaleDateString("nb-NO")}</Table.DataCell>
												<Table.DataCell align="right">
													<Button
														variant="tertiary-neutral"
														size="xsmall"
														type="button"
														title={`Fjern kobling for ${team.slug}`}
														onClick={() => {
															setUnlinkTarget({ slug: team.slug, sectionName: s.name })
															unlinkModalRef.current?.showModal()
														}}
													>
														Fjern kobling
													</Button>
												</Table.DataCell>
											</Table.Row>
										))}
									</Table.Body>
								</Table>
							</section>
						</VStack>
					</Tabs.Panel>
				))}
			</Tabs>

			<Modal ref={unlinkModalRef} header={{ heading: "Fjern seksjonskobling" }}>
				<Modal.Body>
					<BodyShort>
						Er du sikker på at du vil fjerne koblingen mellom <strong>{unlinkTarget?.slug}</strong> og seksjonen{" "}
						<strong>{unlinkTarget?.sectionName}</strong>?
					</BodyShort>
				</Modal.Body>
				<Modal.Footer>
					<Form method="post" onSubmit={() => unlinkModalRef.current?.close()}>
						<input type="hidden" name="intent" value="unlink-section" />
						<input type="hidden" name="teamSlug" value={unlinkTarget?.slug ?? ""} />
						<HStack gap="space-4">
							<Button type="button" variant="secondary" size="small" onClick={() => unlinkModalRef.current?.close()}>
								Avbryt
							</Button>
							<Button type="submit" variant="danger" size="small">
								Fjern kobling
							</Button>
						</HStack>
					</Form>
				</Modal.Footer>
			</Modal>

			<Link to="/admin/nais-overvaking/endringslogg">Vis endringslogg</Link>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
