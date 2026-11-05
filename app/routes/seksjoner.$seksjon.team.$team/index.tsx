import { MenuElipsisVerticalIcon } from "@navikt/aksel-icons"
import type { SortState } from "@navikt/ds-react"
import {
	ActionMenu,
	Alert,
	BodyLong,
	BodyShort,
	Box,
	Button,
	Detail,
	Dialog,
	Heading,
	HelpText,
	HGrid,
	HStack,
	ReadMore,
	Table,
	Tag,
	VStack,
} from "@navikt/ds-react"
import { useMemo, useRef, useState } from "react"
import { data, Form, Link, redirect, useActionData, useLoaderData } from "react-router"
import { AddAppModal } from "~/components/AddAppModal"
import { DeploymentSummaryCards } from "~/components/DeploymentSummaryCards"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAvailableAppsForTeam, linkAppToTeam } from "~/db/queries/applications.server"
import { getDeploymentVerificationAggregate } from "~/db/queries/deployment-audit.server"
import { getActiveDevTeamEntraMembers } from "~/db/queries/dev-team-entra.server"
import { archiveApplication } from "~/db/queries/nais.server"
import { countOpenFollowUpPointsForApps } from "~/db/queries/routines.server"
import {
	countArchivedTeamApps,
	getSectionBySlug,
	getTeamActiveAppIds,
	getTeamApps,
	getTeamBySlug,
} from "~/db/queries/sections.server"
import { getUsersForTeam } from "~/db/queries/users.server"
import { type EconomySystemType, economySystemTypeLabels } from "~/db/schema/applications"
import { userRoleLabels } from "~/db/schema/organization"
import { getAuthenticatedUser, requireAuthenticatedUser } from "~/lib/auth.server"
import { canManageTeam } from "~/lib/authorization.server"
import { compliancePercent } from "~/lib/utils"
import type { Route } from "./+types/index"

export async function loader({ request, params }: Route.LoaderArgs) {
	const seksjon = params.seksjon
	const teamSlug = params.team
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })
	if (!teamSlug) throw new Response("Mangler team", { status: 400 })

	const user = await getAuthenticatedUser(request)

	const [result, section] = await Promise.all([getTeamApps(teamSlug), getSectionBySlug(seksjon)])
	if (!result) throw new Response("Team ikke funnet", { status: 404 })
	if (!section) throw new Response("Seksjon ikke funnet", { status: 404 })
	if (result.team.sectionId !== section.id) throw new Response("Team tilhører ikke denne seksjonen", { status: 404 })

	const appIds = result.apps.map((a) => a.appId)
	const { getScreeningProgressForApps } = await import("~/db/queries/screening.server")
	const [deploymentStats, screeningProgressMap, needsFollowUpPoints, archivedAppsCount] = await Promise.all([
		getDeploymentVerificationAggregate(appIds),
		getScreeningProgressForApps(appIds, [section.id]),
		countOpenFollowUpPointsForApps(section.id, appIds),
		countArchivedTeamApps(result.team.id),
	])

	const canManage = user ? canManageTeam(user, result.team.id, section.id) : false
	let canAddApp = canManage

	if (!canAddApp && user) {
		canAddApp = user.dbRoles.some((r) => r.devTeamId === result.team.id)
	}

	const availableApps = canAddApp ? await getAvailableAppsForTeam(result.team.id, section.id) : []
	const [teamUsers, entraMembers] = await Promise.all([
		user ? getUsersForTeam(result.team.id) : Promise.resolve([]),
		user && result.team.entraGroupId ? getActiveDevTeamEntraMembers(result.team.id) : Promise.resolve([]),
	])

	// Entra-koblede medlemmer synkroniseres automatisk og har ikke egne userRoles-rader (jf. #706/#707).
	// Slå dem sammen med KISS-forvaltede roller (Tech Lead/Produktleder) slik at de vises som "Teammedlem" her.
	// Nøkkelen normaliseres (trim + uppercase) for å unngå duplikater ved avvikende casing/whitespace
	// mellom userRoles og Entra-cachen, i tråd med konvensjonen i getUserNamesByNavIdents.
	const teamUsersByNavIdent = new Map(teamUsers.map((u) => [u.navIdent.trim().toUpperCase(), u]))
	for (const m of entraMembers) {
		const key = m.navIdent.trim().toUpperCase()
		if (!teamUsersByNavIdent.has(key)) {
			teamUsersByNavIdent.set(key, {
				navIdent: m.navIdent,
				name: m.displayName?.trim() || m.navIdent,
				roles: ["developer"],
			})
		}
	}
	const mergedTeamUsers = Array.from(teamUsersByNavIdent.values()).sort((a, b) => a.name.localeCompare(b.name, "nb"))

	const totalControls = result.apps.reduce((sum, a) => sum + a.total, 0)
	const totalImplemented = result.apps.reduce((sum, a) => sum + a.implemented, 0)
	const totalPartial = result.apps.reduce((sum, a) => sum + a.partial, 0)
	const totalNotRelevant = result.apps.reduce((sum, a) => sum + a.notRelevant, 0)
	const totalMangler =
		totalControls -
		totalImplemented -
		totalPartial -
		totalNotRelevant -
		result.apps.reduce((sum, a) => sum + a.notImplemented, 0)
	const overallPercent = compliancePercent(totalImplemented, totalPartial, totalControls, totalNotRelevant)
	const totalRoutinesIkkeGjennomfort = result.apps.reduce(
		(sum, a) => sum + a.routineCompliance.routinesIkkeGjennomfort,
		0,
	)

	return data({
		seksjon,
		seksjonName: section?.name ?? seksjon,
		team: teamSlug,
		teamId: result.team.id,
		teamName: result.team.name,
		apps: result.apps.map((a) => ({
			...a,
			screeningProgress: screeningProgressMap.get(a.appId) ?? { answered: 0, total: 0 },
		})),
		canManage,
		canAddApp,
		canArchiveApps: canAddApp,
		archivedAppsCount,
		availableApps,
		teamUsers: mergedTeamUsers,
		totalImplemented,
		totalPartial,
		totalMangler,
		overallPercent,
		totalRoutinesIkkeGjennomfort,
		needsFollowUpPoints,
		deploymentStats,
	})
}

export async function action({ request, params }: Route.ActionArgs) {
	const authedUser = await requireAuthenticatedUser(request)
	const teamSlug = params.team
	const seksjon = params.seksjon
	if (!teamSlug || !seksjon) throw new Response("Mangler parametere", { status: 400 })

	const teamRecord = await getTeamBySlug(teamSlug)
	if (!teamRecord) throw new Response("Team ikke funnet", { status: 404 })

	const section = await getSectionBySlug(seksjon)
	if (!section || section.id !== teamRecord.sectionId) throw new Response("Seksjon/team mismatch", { status: 404 })

	// Check authorization: team admin (admin/product_owner/tech_lead) or any team member
	if (!canManageTeam(authedUser, teamRecord.id, section.id)) {
		const isMember = authedUser.dbRoles.some((r) => r.devTeamId === teamRecord.id)
		if (!isMember) throw new Response("Ikke tilgang", { status: 403 })
	}

	const formData = await request.formData()
	const intent = formData.get("intent")

	if (intent === "add-app") {
		const applicationId = formData.get("applicationId")
		if (typeof applicationId !== "string" || !applicationId) {
			return data({ success: false, error: "Velg en applikasjon." })
		}
		await linkAppToTeam(applicationId, teamRecord.id, authedUser.navIdent)
		return redirect(`/seksjoner/${seksjon}/team/${teamSlug}`)
	}

	if (intent === "archive-app") {
		const applicationId = formData.get("applicationId")
		if (typeof applicationId !== "string" || !applicationId) {
			return data({ success: false, error: "Mangler applikasjon." })
		}
		const activeAppIds = await getTeamActiveAppIds(teamSlug)
		if (!activeAppIds?.appIds.includes(applicationId)) {
			throw new Response("Applikasjonen tilhører ikke dette teamet", { status: 403 })
		}
		try {
			await archiveApplication(applicationId, authedUser.navIdent)
		} catch (error) {
			return data({
				success: false,
				error: error instanceof Error ? error.message : "Kunne ikke arkivere applikasjonen.",
			})
		}
		return redirect(`/seksjoner/${seksjon}/team/${teamSlug}`)
	}

	throw new Response("Ugyldig handling", { status: 400 })
}

function economyTypeLabel(type: EconomySystemType | null): string {
	if (!type) return "Ja"
	return economySystemTypeLabels[type]
}

function isUserRole(r: string): r is keyof typeof userRoleLabels {
	return r in userRoleLabels
}

function roleLabel(r: string): string {
	return isUserRole(r) ? userRoleLabels[r] : r
}

function isLeadershipRole(r: string) {
	return ["tech_lead", "product_owner"].includes(r)
}

function isLeadership(u: TeamUser) {
	return u.roles.some(isLeadershipRole)
}

type TeamUser = { navIdent: string; name: string; roles: readonly string[] }

function TeamLedelse({ teamUsers }: { teamUsers: TeamUser[] }) {
	const ledelse = teamUsers.filter(isLeadership)

	if (ledelse.length === 0) return null

	return (
		<HStack gap="space-6" wrap>
			{ledelse.map((u) => (
				<Detail key={u.navIdent}>
					<strong>{u.roles.filter(isLeadershipRole).map(roleLabel).join(", ")}:</strong> {u.name}
				</Detail>
			))}
		</HStack>
	)
}

function TeamMedlemmer({ teamUsers }: { teamUsers: TeamUser[] }) {
	const utviklere = teamUsers.filter((u) => !isLeadership(u))

	if (utviklere.length === 0) return null

	return (
		<VStack gap="space-4">
			<Heading size="large" level="3">
				Teammedlemmer
			</Heading>
			<div style={{ columns: "3 200px", columnGap: "var(--a-spacing-8)" }}>
				{utviklere.map((u) => (
					<Detail key={u.navIdent} style={{ breakInside: "avoid", paddingBottom: "var(--a-spacing-1)" }}>
						{u.name}
						{" – "}
						{u.roles.map(roleLabel).join(", ")}
					</Detail>
				))}
			</div>
		</VStack>
	)
}

function TeamAppActionsCell({
	seksjon,
	team,
	appId,
	appName,
	canArchive,
	canArchiveApps,
}: {
	seksjon: string
	team: string
	appId: string
	appName: string
	canArchive: boolean
	canArchiveApps: boolean
}) {
	const [confirmOpen, setConfirmOpen] = useState(false)
	const archiveFormRef = useRef<HTMLFormElement>(null)
	const showArchive = canArchive && canArchiveApps

	return (
		<>
			<ActionMenu>
				<ActionMenu.Trigger>
					<Button
						aria-label={`Handlinger for ${appName}`}
						data-color="neutral"
						icon={<MenuElipsisVerticalIcon aria-hidden />}
						size="small"
						variant="tertiary"
					/>
				</ActionMenu.Trigger>
				<ActionMenu.Content>
					<ActionMenu.Item
						as={Link}
						to={`/seksjoner/${seksjon}/team/${team}/applikasjoner/${appId}/detaljer?fane=screeninger`}
					>
						Vurder
					</ActionMenu.Item>
					{showArchive && (
						<ActionMenu.Item variant="danger" onSelect={() => setConfirmOpen(true)}>
							Arkiver
						</ActionMenu.Item>
					)}
				</ActionMenu.Content>
			</ActionMenu>
			{showArchive && (
				<>
					<Form method="post" ref={archiveFormRef}>
						<input type="hidden" name="intent" value="archive-app" />
						<input type="hidden" name="applicationId" value={appId} />
					</Form>
					<Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
						<Dialog.Popup
							width="small"
							position="center"
							closeOnOutsideClick
							aria-label={`Bekreft arkivering av ${appName}`}
						>
							<Dialog.Header>Arkiver {appName}?</Dialog.Header>
							<Dialog.Body>
								<VStack gap="space-16">
									<BodyShort>
										Er du sikker på at du vil arkivere {appName}? Applikasjonen skjules fra brukervendte lister, men all
										data og historikk bevares. Arkivering kan reverseres.
									</BodyShort>
									<HStack gap="space-4">
										<Button
											type="button"
											variant="danger"
											size="small"
											onClick={() => {
												setConfirmOpen(false)
												archiveFormRef.current?.requestSubmit()
											}}
										>
											Arkiver
										</Button>
										<Button type="button" variant="secondary" size="small" onClick={() => setConfirmOpen(false)}>
											Avbryt
										</Button>
									</HStack>
								</VStack>
							</Dialog.Body>
						</Dialog.Popup>
					</Dialog>
				</>
			)}
		</>
	)
}

type SortKey =
	| "appName"
	| "economySystem"
	| "screening"
	| "routinesGjennomfort"
	| "routinesIkkeGjennomfort"
	| "followUp"
	| "statusPct"

export default function TeamDashboard() {
	const {
		seksjon,
		team,
		teamName,
		apps,
		canManage,
		canAddApp,
		canArchiveApps,
		availableApps,
		teamUsers,
		totalImplemented,
		totalPartial,
		totalMangler,
		overallPercent,
		totalRoutinesIkkeGjennomfort,
		needsFollowUpPoints,
		archivedAppsCount,
		deploymentStats,
	} = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const [sort, setSort] = useState<SortState>({ orderBy: "appName", direction: "ascending" })

	const sortedApps = useMemo(() => {
		const dir = sort.direction === "ascending" ? 1 : -1
		return [...apps].sort((a, b) => {
			switch (sort.orderBy as SortKey) {
				case "appName":
					return dir * a.appName.localeCompare(b.appName, "nb")
				case "economySystem": {
					const label = (a: (typeof apps)[number]): string => {
						if (a.isEconomySystem === null) return ""
						if (!a.isEconomySystem) return "Nei"
						return economyTypeLabel(a.economySystemType)
					}
					return dir * label(a).localeCompare(label(b), "nb")
				}
				case "screening":
					return dir * (a.screeningProgress.answered - b.screeningProgress.answered)
				case "routinesGjennomfort":
					return dir * (a.routineCompliance.routinesGjennomfort - b.routineCompliance.routinesGjennomfort)
				case "routinesIkkeGjennomfort":
					return dir * (a.routineCompliance.routinesIkkeGjennomfort - b.routineCompliance.routinesIkkeGjennomfort)
				case "followUp":
					return dir * (a.routineCompliance.routinesMaaFolgesOpp - b.routineCompliance.routinesMaaFolgesOpp)
				case "statusPct": {
					const pctFor = (a: (typeof apps)[number]) =>
						a.routineCompliance.routinesTotal === 0
							? -1
							: (a.routineCompliance.routinesGjennomfort / a.routineCompliance.routinesTotal) * 100
					return dir * (pctFor(a) - pctFor(b))
				}
				default:
					return 0
			}
		})
	}, [apps, sort])

	const handleSort = (sortKey: string) => {
		setSort((prev) =>
			prev.orderBy === sortKey
				? { orderBy: sortKey, direction: prev.direction === "ascending" ? "descending" : "ascending" }
				: { orderBy: sortKey, direction: "ascending" },
		)
	}

	return (
		<VStack gap="space-8">
			<HStack align="center" justify="space-between" wrap>
				<VStack gap="space-1">
					<Heading size="xlarge" level="2">
						{teamName}
					</Heading>
					<TeamLedelse teamUsers={teamUsers} />
					<Box paddingBlock="space-6 space-0">
						<TeamMedlemmer teamUsers={teamUsers} />
					</Box>
				</VStack>
				{canManage && (
					<Button as={Link} to={`/seksjoner/${seksjon}/team/${team}/rediger`} variant="tertiary" size="small">
						Administrer
					</Button>
				)}
			</HStack>

			<BodyShort size="small">
				Tallene gjelder teamets aktive applikasjoner. Arkiverte applikasjoner telles separat.
			</BodyShort>
			<HGrid gap="space-6" columns={{ xs: 1, sm: 2, md: 4 }}>
				<Box padding="space-6" borderRadius="8" background="sunken">
					<VStack align="center">
						<Heading size="xlarge" level="3">
							{overallPercent}%
						</Heading>
						<HStack gap="space-8" align="center" justify="center">
							<Detail>Kontrolloppfyllelse</Detail>
							<HelpText title="Om kontrolloppfyllelse">
								Implementert gir full uttelling. Delvis implementert gir halv uttelling. Summen deles på antall
								kontrollpunkter, uten de som er vurdert som ikke relevante, og vises i prosent. Ikke implementert og
								kontrollpunkter uten vurdering gir ingen uttelling. Uten beregningsgrunnlag vises 0 %. Dette er ikke et
								gjennomsnitt av applikasjonenes rutineprosenter.
							</HelpText>
						</HStack>
						<BodyShort size="small">Implementert gir full uttelling, delvis gir halv.</BodyShort>
					</VStack>
				</Box>
				<Box padding="space-6" borderRadius="8" background="sunken">
					<VStack align="center">
						<Heading size="xlarge" level="3">
							{apps.length}
						</Heading>
						<HStack gap="space-8" align="center" justify="center">
							<Detail>Applikasjoner</Detail>
							<HelpText title="Om applikasjoner">
								Antall aktive applikasjoner tilknyttet teamet, direkte eller via Nais-team, innenfor seksjonens
								miljøutvalg. Applikasjonene vises i tabellen nedenfor.
							</HelpText>
						</HStack>
					</VStack>
				</Box>
				<Box padding="space-6" borderRadius="8" background="sunken">
					<VStack align="center">
						<Heading size="xlarge" level="3">
							{totalImplemented}
						</Heading>
						<HStack gap="space-8" align="center" justify="center">
							<Detail>Implementerte kontrollpunkter</Detail>
							<HelpText title="Om implementerte kontrollpunkter">
								Antall kontrollpunkter med status implementert, summert for applikasjonene. Samme kontroll kan telles
								flere ganger dersom den gjelder flere applikasjoner eller teknologielementer.
							</HelpText>
						</HStack>
					</VStack>
				</Box>
				<Box padding="space-6" borderRadius="8" background="sunken">
					<VStack align="center">
						<Heading size="xlarge" level="3">
							{totalPartial}
						</Heading>
						<HStack gap="space-8" align="center" justify="center">
							<Detail>Delvis implementerte kontrollpunkter</Detail>
							<HelpText title="Om delvis implementerte kontrollpunkter">
								Antall kontrollpunkter med status delvis implementert, summert for applikasjonene. Hvert punkt gir halv
								uttelling i kontrolloppfyllelsen.
							</HelpText>
						</HStack>
					</VStack>
				</Box>
				<Box padding="space-6" borderRadius="8" background="sunken">
					<VStack align="center" gap="space-8">
						<Link to={`/seksjoner/${seksjon}/team/${team}/mangler`} style={{ color: "inherit" }}>
							<Heading size="xlarge" level="3">
								{totalMangler}
							</Heading>
							<Detail>Kontrollpunkter uten vurdering</Detail>
						</Link>
						<HelpText title="Om kontrollpunkter uten vurdering">
							Kontrollpunkter som ennå ikke har fått en status, for eksempel fordi nødvendige spørsmål ikke er besvart.
							Ikke implementert er en vurdert status og telles ikke her.
						</HelpText>
					</VStack>
				</Box>
				<Box
					padding="space-6"
					borderRadius="8"
					background={totalRoutinesIkkeGjennomfort > 0 ? "warning-moderate" : "sunken"}
				>
					<VStack align="center" gap="space-8">
						<Link to={`/seksjoner/${seksjon}/team/${team}/rutiner`} style={{ color: "inherit" }}>
							<Heading size="xlarge" level="3">
								{totalRoutinesIkkeGjennomfort}
							</Heading>
							<Detail>Rutiner som må gjennomføres</Detail>
						</Link>
						<HelpText title="Om rutiner som må gjennomføres">
							Periodiske rutiner uten en gjennomgang innenfor rutinens frekvensperiode. Summen teller per applikasjon,
							så samme rutine kan telles flere ganger. Hendelsesbaserte rutiner og seksjonsrutiner er ikke med.
						</HelpText>
					</VStack>
				</Box>
				<Box padding="space-6" borderRadius="8" background={needsFollowUpPoints > 0 ? "warning-moderate" : "sunken"}>
					<VStack align="center" gap="space-8">
						<Link to={`/seksjoner/${seksjon}/team/${team}/oppfolging`} style={{ color: "inherit" }}>
							<Heading size="xlarge" level="3">
								{needsFollowUpPoints}
							</Heading>
							<Detail>Åpne oppfølgingspunkter</Detail>
						</Link>
						<HelpText title="Om åpne oppfølgingspunkter">
							Antall åpne enkeltpunkter i gjennomganger som venter på oppfølging, for teamets applikasjoner og
							seksjonens aktive rutiner. Én gjennomgang kan ha flere punkter.
						</HelpText>
					</VStack>
				</Box>
				<Box padding="space-6" borderRadius="8" background="sunken">
					<VStack align="center" gap="space-8">
						<Link to={`/seksjoner/${seksjon}/team/${team}/arkiverte`} style={{ color: "inherit" }}>
							<Heading size="xlarge" level="3">
								{archivedAppsCount}
							</Heading>
							<Detail>Arkiverte applikasjoner</Detail>
						</Link>
						<HelpText title="Om arkiverte applikasjoner">
							Arkiverte applikasjoner som historisk har tilhørt teamet. De er ikke med i de andre nøkkeltallene eller i
							applikasjonstabellen.
						</HelpText>
					</VStack>
				</Box>
			</HGrid>

			<DeploymentSummaryCards stats={deploymentStats} />

			<HStack align="center" justify="space-between" wrap>
				<Heading size="large" level="3">
					Applikasjoner
				</Heading>
				{canAddApp && availableApps.length > 0 && <AddAppModal availableApps={availableApps} intent="add-app" />}
			</HStack>

			{actionData && "error" in actionData && <Alert variant="error">{actionData.error}</Alert>}

			<ReadMore header="Slik leser du tabellen" size="small">
				<VStack gap="space-12">
					<BodyShort size="small">
						<strong>Økonomisystem:</strong> Applikasjonens klassifisering som økonomisystem. «–» betyr at den ikke er
						klassifisert. <strong>Spørsmål:</strong> Besvarte spørsmål av totalt antall i seksjonens screening.
					</BodyShort>
					<BodyShort size="small">
						<strong>Rutiner gjennomført:</strong> Periodiske rutiner med en gjennomgang innenfor rutinens
						frekvensperiode. Gjennomganger med åpne oppfølgingspunkter teller også som gjennomført.{" "}
						<strong>Rutiner ikke gjennomført:</strong> Periodiske rutiner som mangler en slik gjennomgang.
						Hendelsesbaserte rutiner og seksjonsrutiner inngår ikke i disse tallene.
					</BodyShort>
					<BodyShort size="small">
						<strong>Gjennomganger med åpne punkter:</strong> Antall gjennomganger som venter på oppfølging, også for
						hendelsesbaserte rutiner. Dette er antall gjennomganger, ikke antall enkeltpunkter.
					</BodyShort>
					<BodyShort size="small">
						<strong>Rutiner gjennomført (%):</strong> Gjennomførte periodiske rutiner delt på totalt antall periodiske
						rutiner, avrundet til nærmeste hele prosent. Dette er ikke det samme som kontrolloppfyllelse i kortene over.
						«–» i rutinetallene betyr at applikasjonen ikke har periodiske rutiner; åpne gjennomganger vises likevel
						hvis de finnes.
					</BodyShort>
					<BodyShort size="small">
						<strong>Borte fra Nais:</strong> Applikasjonen kan arkiveres, men er fortsatt aktiv i KISS og inngår i
						tallene frem til den arkiveres.
					</BodyShort>
				</VStack>
			</ReadMore>

			{apps.length > 0 ? (
				/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
				<section className="table-scroll" tabIndex={0} aria-label="Applikasjoner per team">
					<Table sort={sort} onSortChange={handleSort}>
						<Table.Header>
							<Table.Row>
								<Table.ColumnHeader scope="col" sortKey="appName" sortable>
									Applikasjon
								</Table.ColumnHeader>
								<Table.ColumnHeader scope="col" sortKey="economySystem" sortable>
									Økonomisystem
								</Table.ColumnHeader>
								<Table.ColumnHeader scope="col" align="right" sortKey="screening" sortable>
									Spørsmål
								</Table.ColumnHeader>
								<Table.ColumnHeader scope="col" align="right" sortKey="routinesGjennomfort" sortable>
									Rutiner gjennomført
								</Table.ColumnHeader>
								<Table.ColumnHeader scope="col" align="right" sortKey="routinesIkkeGjennomfort" sortable>
									Rutiner ikke gjennomført
								</Table.ColumnHeader>
								<Table.ColumnHeader scope="col" align="right" sortKey="followUp" sortable>
									Gjennomganger med åpne punkter
								</Table.ColumnHeader>
								<Table.ColumnHeader scope="col" align="right" sortKey="statusPct" sortable>
									Rutiner gjennomført (%)
								</Table.ColumnHeader>
								<Table.HeaderCell scope="col" align="right">
									Handlinger
								</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{sortedApps.map((app) => {
								return (
									<Table.Row key={app.appId}>
										<Table.DataCell>
											<HStack align="center" gap="space-4" wrap={false}>
												<Link to={`/seksjoner/${seksjon}/team/${team}/applikasjoner/${app.appId}/detaljer`}>
													{app.appName}
												</Link>
												{app.canArchive && (
													<Tag variant="warning" size="xsmall">
														Borte fra Nais
													</Tag>
												)}
											</HStack>
										</Table.DataCell>
										<Table.DataCell>
											{app.isEconomySystem === null ? (
												"–"
											) : app.isEconomySystem ? (
												<Tag variant="info" size="small">
													{economyTypeLabel(app.economySystemType)}
												</Tag>
											) : (
												"Nei"
											)}
										</Table.DataCell>
										<Table.DataCell align="right">
											{app.screeningProgress.answered}/{app.screeningProgress.total}
										</Table.DataCell>
										<Table.DataCell align="right">
											{app.routineCompliance.routinesTotal === 0 ? "–" : app.routineCompliance.routinesGjennomfort}
										</Table.DataCell>
										<Table.DataCell align="right">
											{app.routineCompliance.routinesTotal === 0 ? "–" : app.routineCompliance.routinesIkkeGjennomfort}
										</Table.DataCell>
										<Table.DataCell align="right">
											{app.routineCompliance.routinesMaaFolgesOpp === 0 && app.routineCompliance.routinesTotal === 0
												? "–"
												: app.routineCompliance.routinesMaaFolgesOpp}
										</Table.DataCell>
										<Table.DataCell align="right">
											{app.routineCompliance.routinesTotal === 0
												? "–"
												: `${Math.round((app.routineCompliance.routinesGjennomfort / app.routineCompliance.routinesTotal) * 100)}%`}
										</Table.DataCell>
										<Table.DataCell align="right">
											<TeamAppActionsCell
												seksjon={seksjon}
												team={team}
												appId={app.appId}
												appName={app.appName}
												canArchive={app.canArchive}
												canArchiveApps={canArchiveApps}
											/>
										</Table.DataCell>
									</Table.Row>
								)
							})}
						</Table.Body>
					</Table>
				</section>
			) : (
				<BodyLong>Ingen applikasjoner er tilknyttet dette teamet.</BodyLong>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
