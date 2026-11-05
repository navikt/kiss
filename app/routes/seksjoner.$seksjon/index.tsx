import {
	Link as AkselLink,
	Alert,
	BodyLong,
	BodyShort,
	Box,
	Button,
	Detail,
	Heading,
	HGrid,
	HStack,
	ReadMore,
	Switch,
	Tag,
	Tooltip,
	VStack,
} from "@navikt/ds-react"
import { data, Link, useLoaderData, useNavigation, useSearchParams } from "react-router"
import { DeploymentSummaryCards } from "~/components/DeploymentSummaryCards"
import { DomainStatusCard } from "~/components/DomainStatusCard"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getRoutineComplianceSummaries } from "~/db/queries/application-controls.server"
import { getDeploymentVerificationAggregate } from "~/db/queries/deployment-audit.server"
import { countSectionEconomySystems } from "~/db/queries/economy-classification.server"
import { countOpenFollowUpPointsForApps } from "~/db/queries/routines.server"
import { resolveRoleHolder } from "~/db/queries/rulesets.server"
import { getScreeningProgressForApps } from "~/db/queries/screening.server"
import { countSectionRoutinesIncomplete, getSectionDetail } from "~/db/queries/sections.server"
import { getAuthenticatedUser } from "~/lib/auth.server"
import { canManageSection, canViewSectionReports, isAdmin } from "~/lib/authorization.server"
import { compliancePercent } from "~/lib/utils"
import type { Route } from "./+types/index"

/** Compute progress-bar percentage and remaining count for a compliance stats group. */
function complianceFigures(stats: {
	implemented: number
	partial: number
	notImplemented: number
	notRelevant: number
	total: number
}) {
	return {
		pct: compliancePercent(stats.implemented, stats.partial, stats.total, stats.notRelevant),
		mangler: stats.total - stats.implemented - stats.partial - stats.notImplemented - stats.notRelevant,
	}
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })

	const user = await getAuthenticatedUser(request)

	const economyOnly = new URL(request.url).searchParams.get("economyOnly") === "true"
	const result = await getSectionDetail(seksjon, { economyOnly })
	if (!result) throw new Response("Seksjon ikke funnet", { status: 404 })

	const [
		deploymentStats,
		economyStats,
		screeningProgress,
		routineSummaries,
		sectionRoutinesIkkeGjennomfort,
		needsFollowUpPoints,
		seksjonsleder,
		teknologileder,
	] = await Promise.all([
		getDeploymentVerificationAggregate(result.allAppIds),
		countSectionEconomySystems(result.section.id),
		getScreeningProgressForApps(result.allAppIds, [result.section.id]),
		getRoutineComplianceSummaries(result.allAppIds),
		countSectionRoutinesIncomplete(result.allAppIds),
		countOpenFollowUpPointsForApps(result.section.id, result.allAppIds),
		resolveRoleHolder("section_manager", result.section.id),
		resolveRoleHolder("tech_manager", result.section.id),
	])

	// Aggregate screening: count apps where all relevant questions are answered
	const screenedCount = [...screeningProgress.values()].filter((p) => p.total > 0 && p.answered === p.total).length

	// Aggregate routine compliance across all section apps
	let routinesGjennomfort = 0
	let routinesIkkeGjennomfort = 0
	for (const s of routineSummaries.values()) {
		routinesGjennomfort += s.routinesGjennomfort
		routinesIkkeGjennomfort += s.routinesIkkeGjennomfort
	}

	const seksjonName = result.section.name
	const teams = result.teams
	const unassigned = result.unassignedStats
	const st = result.sectionTotals

	const totalApps = st.apps
	const totalImplemented = st.implemented
	const totalPartial = st.partial
	const totalControls = st.total
	const totalNotRelevant = st.notRelevant
	const totalMangler = totalControls - totalImplemented - totalPartial - st.notImplemented - totalNotRelevant
	const overallPercent = compliancePercent(totalImplemented, totalPartial, totalControls, totalNotRelevant)

	const hasUtviklerteam = teams.length > 0
	const hasNaisTeam = result.hasNaisTeam
	const hasNaisMiljo = result.hasNaisMiljo

	return data({
		seksjon,
		seksjonName,
		sectionId: result.section.id,
		teams,
		unassigned,
		totalApps,
		totalImplemented,
		totalPartial,
		totalMangler,
		totalControls,
		overallPercent,
		canAdmin: user ? canManageSection(user, result.section.id) : false,
		isGlobalAdmin: user ? isAdmin(user) : false,
		canViewReports: user ? canViewSectionReports(user, result.section.id) : false,
		deploymentStats,
		economySystemCount: economyStats.totalCount,
		economySystemExpiredCount: economyStats.expiredCount,
		screenedCount,
		routinesGjennomfort,
		routinesIkkeGjennomfort,
		sectionRoutinesIkkeGjennomfort,
		needsFollowUpPoints,
		seksjonsleder,
		teknologileder,
		hasUtviklerteam,
		hasNaisTeam,
		hasNaisMiljo,
	})
}

export default function SeksjonDashboard() {
	const {
		seksjon,
		seksjonName,
		teams,
		unassigned,
		totalApps,
		totalImplemented,
		totalPartial,
		totalMangler,
		overallPercent,
		canAdmin,
		isGlobalAdmin,
		canViewReports,
		deploymentStats,
		economySystemCount,
		economySystemExpiredCount,
		screenedCount,
		routinesGjennomfort,
		routinesIkkeGjennomfort,
		sectionRoutinesIkkeGjennomfort,
		needsFollowUpPoints,
		seksjonsleder,
		teknologileder,
		hasUtviklerteam,
		hasNaisTeam,
		hasNaisMiljo,
	} = useLoaderData<typeof loader>()

	const redigerBase = `/seksjoner/${seksjon}/rediger`
	const [searchParams, setSearchParams] = useSearchParams()
	const navigation = useNavigation()
	const showEconomyOnly = searchParams.get("economyOnly") === "true"

	const visibleTeams = showEconomyOnly ? teams.filter((team) => team.apps > 0) : teams
	const showUnassignedCard = unassigned.apps > 0
	const noEconomyMatches = showEconomyOnly && totalApps === 0

	return (
		<VStack gap="space-8" aria-busy={navigation.state === "loading"}>
			<HStack align="center" justify="space-between" wrap>
				<VStack gap="space-1">
					<Heading size="xlarge" level="2">
						Seksjon: {seksjonName}
					</Heading>
					{(seksjonsleder || teknologileder) && (
						<HStack gap="space-6" wrap>
							{seksjonsleder && (
								<Detail>
									<strong>Seksjonsleder:</strong> {seksjonsleder.name}
								</Detail>
							)}
							{teknologileder && (
								<Detail>
									<strong>Teknologileder:</strong> {teknologileder.name}
								</Detail>
							)}
						</HStack>
					)}
				</VStack>
				{canAdmin && (
					<Button as={Link} to={`/seksjoner/${seksjon}/rediger`} variant="tertiary" size="small">
						Administrer
					</Button>
				)}
			</HStack>
			<VStack gap="space-4">
				<VStack gap="space-2">
					<Detail textColor="subtle">Vurderingsgrunnlag</Detail>
					<HStack gap="space-4" wrap>
						<Button as={Link} to={`/seksjoner/${seksjon}/screening`} variant="secondary" size="small">
							Screening-spørsmål
						</Button>
						<Button as={Link} to={`/seksjoner/${seksjon}/regelsett`} variant="secondary" size="small">
							Regelsett
						</Button>
						<Button as={Link} to={`/seksjoner/${seksjon}/rutiner`} variant="secondary" size="small">
							Rutiner
						</Button>
						<Button as={Link} to={`/seksjoner/${seksjon}/seksjonsrutiner`} variant="secondary" size="small">
							Seksjonsrutiner
						</Button>
					</HStack>
				</VStack>
				<VStack gap="space-2">
					<Detail textColor="subtle">Applikasjonsdata</Detail>
					<HStack gap="space-4" wrap>
						<Button as={Link} to={`/seksjoner/${seksjon}/entra-grupper`} variant="secondary" size="small">
							Entra ID-grupper
						</Button>
						<Button as={Link} to={`/seksjoner/${seksjon}/oracle-roller`} variant="secondary" size="small">
							Oracle-roller
						</Button>
						<Button as={Link} to={`/seksjoner/${seksjon}/rpa-brukere`} variant="secondary" size="small">
							RPA-brukere
						</Button>
						<Button as={Link} to={`/seksjoner/${seksjon}/okonomisystemer`} variant="secondary" size="small">
							Økonomisystemer
						</Button>
						<Button as={Link} to={`/seksjoner/${seksjon}/audit-logging`} variant="secondary" size="small">
							Audit logging
						</Button>
						{canViewReports && (
							<Button as={Link} to={`/seksjoner/${seksjon}/rapporter`} variant="secondary" size="small">
								Rapporter
							</Button>
						)}
						{isGlobalAdmin && (
							<Button as={Link} to={`/seksjoner/${seksjon}/koblingsforslag`} variant="secondary" size="small">
								Koblingsforslag
							</Button>
						)}
					</HStack>
				</VStack>
			</VStack>
			{(!hasUtviklerteam || !hasNaisTeam || !hasNaisMiljo) && (
				<Alert variant="info">
					<VStack gap="space-2">
						<BodyLong weight="semibold">Seksjonen er ikke ferdig konfigurert</BodyLong>
						<BodyLong>Følgende mangler før KISS kan vise compliance-data og applikasjoner for seksjonen:</BodyLong>
						<ul style={{ margin: 0, paddingLeft: "var(--ax-space-5)" }}>
							{!hasNaisMiljo && (
								<li>
									Ingen Nais-miljøer er aktivert for seksjonen.
									{canAdmin && (
										<>
											{" "}
											<AkselLink as={Link} to={`${redigerBase}?fane=nais`}>
												Konfigurer Nais-miljøer
											</AkselLink>
										</>
									)}
								</li>
							)}
							{!hasNaisTeam && (
								<li>
									Ingen Nais-team er koblet til seksjonen.
									{canAdmin && (
										<>
											{" "}
											<AkselLink as={Link} to={`${redigerBase}?fane=nais`}>
												Koble Nais-team
											</AkselLink>
										</>
									)}
								</li>
							)}
							{!hasUtviklerteam && (
								<li>
									Ingen utviklingsteam er registrert for seksjonen.
									{canAdmin && (
										<>
											{" "}
											<AkselLink as={Link} to={`${redigerBase}?fane=team`}>
												Legg til utviklingsteam
											</AkselLink>
										</>
									)}
								</li>
							)}
						</ul>
					</VStack>
				</Alert>
			)}
			<BodyLong>
				{showEconomyOnly
					? "Compliance-status for økonomisystemene i seksjonen."
					: "Compliance-status for alle team i seksjonen."}
			</BodyLong>

			<Switch
				size="small"
				checked={showEconomyOnly}
				onChange={(event) => {
					const nextParams = new URLSearchParams(searchParams)
					if (event.target.checked) {
						nextParams.set("economyOnly", "true")
					} else {
						nextParams.delete("economyOnly")
					}
					setSearchParams(nextParams, { preventScrollReset: true })
				}}
			>
				Vis kun økonomisystemer
			</Switch>

			<HGrid gap="space-6" columns={{ xs: 2, sm: 3, md: 6 }}>
				<Box padding="space-6" borderRadius="8" background="sunken">
					<VStack align="center">
						<Heading size="xlarge" level="3">
							{overallPercent}%
						</Heading>
						<Detail>Total compliance</Detail>
					</VStack>
				</Box>
				<Box padding="space-6" borderRadius="8" background="sunken">
					<VStack align="center">
						<Heading size="xlarge" level="3">
							{visibleTeams.length}
						</Heading>
						<Detail>Team</Detail>
					</VStack>
				</Box>
				<Link to={`/seksjoner/${seksjon}/applikasjoner`} style={{ textDecoration: "none", color: "inherit" }}>
					<Box padding="space-6" borderRadius="8" background="sunken">
						<VStack align="center">
							<Heading size="xlarge" level="3">
								{totalApps}
							</Heading>
							<Detail>Applikasjoner</Detail>
						</VStack>
					</Box>
				</Link>
				<Link to={`/seksjoner/${seksjon}/okonomisystemer`} style={{ textDecoration: "none", color: "inherit" }}>
					<Box padding="space-6" borderRadius="8" background="sunken">
						<VStack align="center">
							<Heading size="xlarge" level="3">
								{economySystemCount}
							</Heading>
							<Detail>Økonomisystemer</Detail>
							{economySystemExpiredCount > 0 && (
								<Tag variant="warning" size="small">
									{economySystemExpiredCount} utløpt
								</Tag>
							)}
						</VStack>
					</Box>
				</Link>
				<Box padding="space-6" borderRadius="8" background="sunken">
					<VStack align="center">
						<Heading size="xlarge" level="3">
							{totalImplemented}
						</Heading>
						<Detail>Implementert</Detail>
					</VStack>
				</Box>
				<Box padding="space-6" borderRadius="8" background="sunken">
					<VStack align="center">
						<Heading size="xlarge" level="3">
							{totalPartial}
						</Heading>
						<Detail>Delvis</Detail>
					</VStack>
				</Box>
				<Box padding="space-6" borderRadius="8" background="sunken">
					<VStack align="center">
						<Heading size="xlarge" level="3">
							{totalMangler}
						</Heading>
						<Detail>Mangler</Detail>
					</VStack>
				</Box>

				<Tooltip content="Antall applikasjoner der alle screening-spørsmål er besvart.">
					<Box padding="space-6" borderRadius="8" background="sunken">
						<VStack align="center">
							<Heading size="xlarge" level="3">
								{screenedCount}
							</Heading>
							<Detail>Ferdig screenet</Detail>
						</VStack>
					</Box>
				</Tooltip>
				<Tooltip content="Antall periodiske rutiner som er gjennomført innenfor fristen, summert for alle applikasjoner i seksjonen.">
					<Box padding="space-6" borderRadius="8" background="sunken">
						<VStack align="center">
							<Heading size="xlarge" level="3">
								{routinesGjennomfort}
							</Heading>
							<Detail>Rutiner gjennomført</Detail>
						</VStack>
					</Box>
				</Tooltip>
				<Tooltip content="Antall periodiske applikasjonsrutiner som mangler gjennomgang i frekvensperioden eller aldri er gjennomført, summert for alle applikasjoner i seksjonen. Seksjonsrutiner er ikke inkludert her.">
					<Link to="rutiner/mangler" style={{ textDecoration: "none", color: "inherit" }}>
						<Box padding="space-6" borderRadius="8" background="sunken">
							<VStack align="center">
								<Heading size="xlarge" level="3">
									{routinesIkkeGjennomfort}
								</Heading>
								<Detail>Apprutiner ikke gjennomført</Detail>
							</VStack>
						</Box>
					</Link>
				</Tooltip>
				<Tooltip content="Antall distinkte seksjonsrutiner som mangler gjennomgang i frekvensperioden eller aldri er gjennomført. Seksjonsrutiner gjelder for hele seksjonen og telles én gang, ikke per applikasjon.">
					<Link to="rutiner/mangler" style={{ textDecoration: "none", color: "inherit" }}>
						<Box padding="space-6" borderRadius="8" background="sunken">
							<VStack align="center">
								<Heading size="xlarge" level="3">
									{sectionRoutinesIkkeGjennomfort}
								</Heading>
								<Detail>Seksjonsrutiner ikke gjennomført</Detail>
							</VStack>
						</Box>
					</Link>
				</Tooltip>
				<Tooltip content="Antall åpne oppfølgingspunkter fra rutinegjennomganger som ble fullført, men der det ble oppdaget forhold som må følges opp videre.">
					<Link to="rutiner/oppfolging" style={{ textDecoration: "none", color: "inherit" }}>
						<Box padding="space-6" borderRadius="8" background="sunken">
							<VStack align="center">
								<Heading size="xlarge" level="3">
									{needsFollowUpPoints}
								</Heading>
								<Detail>Åpne oppfølgingspunkter</Detail>
							</VStack>
						</Box>
					</Link>
				</Tooltip>
			</HGrid>

			<ReadMore header="Hva betyr tallene?">
				<VStack gap="space-4">
					<BodyLong>
						Tallene gjelder applikasjonene i utvalget. Når «Vis kun økonomisystemer» er slått på, vises bare tall for
						økonomisystemene. Arkiverte applikasjoner er ikke med. En applikasjon telles én gang i seksjonstotalene,
						selv om den tilhører flere team. Kontroller og applikasjonsrutiner telles per applikasjon.
					</BodyLong>
					<BodyLong>
						<strong>Total compliance</strong> viser hvor stor andel av kontrollene som er oppfylt. Implementert gir full
						uttelling, delvis implementert gir halv uttelling, og «Ikke relevant» holdes utenfor. Kontroller uten status
						og kontroller som ikke er implementert, gir ingen uttelling, men inngår i beregningen. Prosenten avrundes
						til nærmeste heltall. Uten relevante kontroller vises 0 %.
					</BodyLong>
					<BodyLong>
						Beregning: (implementert + 0,5 × delvis) / relevante kontroller × 100. Eksempel: 6 implementerte og 2 delvis
						implementerte av 10 relevante kontroller gir (6 + 0,5 × 2) / 10 × 100 = 70 %. Dette er ikke et gjennomsnitt
						av teamenes prosenter.
					</BodyLong>
					<BodyLong>
						<strong>Team</strong> viser antall aktive team i seksjonen. Med økonomifilteret på telles bare team med
						minst ett økonomisystem.
					</BodyLong>
					<BodyLong>
						<strong>Applikasjoner</strong> viser antall applikasjoner i utvalget, inkludert applikasjoner uten
						utviklingsteam.
					</BodyLong>
					<BodyLong>
						<strong>Økonomisystemer</strong> viser antall aktive applikasjoner i seksjonen som er klassifisert som
						økonomisystem. Utløpte klassifiseringer telles fortsatt med, men merkes med «utløpt» fordi vurderingen må
						fornyes. Tallet endres ikke når økonomifilteret slås på.
					</BodyLong>
					<BodyLong>
						<strong>Implementert</strong> viser antall kontroller med status «Implementert», ikke antall applikasjoner.
						Statusen beregnes fra screeningsvar og rutiner som dekker kontrollen.
					</BodyLong>
					<BodyLong>
						<strong>Delvis</strong> viser antall kontroller med status «Delvis implementert». Det kan for eksempel
						skyldes at en rutine ikke er gjennomgått ennå eller har forfalt. Hver av disse kontrollene gir halv
						uttelling i «Total compliance».
					</BodyLong>
					<BodyLong>
						<strong>Mangler</strong> viser antall kontroller uten beregnet status, for eksempel fordi screeningsvar
						mangler. Kontroller med status «Ikke implementert» inngår ikke i dette tallet. Beregning: totalt antall
						kontroller − implementert − delvis − ikke implementert − ikke relevant.
					</BodyLong>
					<BodyLong>
						<strong>Ferdig screenet</strong> viser antall applikasjoner der alle gjeldende, godkjente screeningspørsmål
						er besvart. Screeningen avklarer hvilke regler og krav som gjelder for applikasjonen. En utløpt
						økonomiklassifisering regnes som et ubesvart spørsmål. Applikasjoner uten gjeldende spørsmål telles ikke.
					</BodyLong>
					<BodyLong>
						<strong>Rutiner gjennomført</strong> viser antall periodiske applikasjonsrutiner med en gjennomgang som
						fortsatt er gyldig i rutinens frekvensperiode. Samme rutine gjennomført for tre applikasjoner teller tre,
						selv om rutinen dekker flere kontroller for hver applikasjon. Seksjonsrutiner og hendelsesbaserte rutiner er
						ikke med.
					</BodyLong>
					<BodyLong>
						<strong>Apprutiner ikke gjennomført</strong> viser antall periodiske applikasjonsrutiner uten en gyldig
						gjennomgang i frekvensperioden, inkludert rutiner som aldri er gjennomført. Samme rutine for tre
						applikasjoner teller tre. Seksjonsrutiner og hendelsesbaserte rutiner er ikke med.
					</BodyLong>
					<BodyLong>
						<strong>Seksjonsrutiner ikke gjennomført</strong> viser antall periodiske seksjonsrutiner som gjelder minst
						én applikasjon i utvalget, og som mangler en gyldig gjennomgang eller aldri er gjennomført. Hver
						seksjonsrutine telles én gang, uansett hvor mange applikasjoner den gjelder.
					</BodyLong>
					<BodyLong>
						<strong>Åpne oppfølgingspunkter</strong> viser antall åpne punkter fra applikasjonsgjennomganger med status
						«Må følges opp». Det er punktene som telles, ikke applikasjonene eller gjennomgangene. Én gjennomgang med
						tre åpne punkter bidrar med tre. Gjennomgangen er fullført, men oppfølgingsarbeidet gjenstår.
					</BodyLong>
					{deploymentStats.appsWithData > 0 && (
						<>
							<BodyLong>
								<strong>Deployments i år</strong> viser samlet antall deployments i årets innhentede verifiseringsdata
								for utvalget. Bare applikasjoner med synkroniserte data bidrar til tallet.
							</BodyLong>
							<BodyLong>
								<strong>4-øyne-dekning</strong> viser andelen deployments som er registrert som godkjent etter
								fireøyneprinsippet. Beregning: godkjente deployments / totalt antall deployments i datagrunnlaget × 100.
								Eksempel: 8 av 10 gir 80 %.
							</BodyLong>
							<BodyLong>
								<strong>Endringsopphav</strong> viser andelen deployments som er koblet til et endringsopphav i
								verifiseringsdataene. Beregning: koblede deployments / totalt antall deployments i datagrunnlaget for
								endringsopphav × 100. Eksempel: 9 av 10 gir 90 %. De to dekningsprosentene beregnes fra hver sine
								datagrunnlag og avrundes til nærmeste heltall. Når datagrunnlaget er tomt, vises «Ingen data», ikke 0 %.
							</BodyLong>
						</>
					)}
					{visibleTeams.length > 0 && (
						<BodyLong>
							<strong>Teamkortene</strong> viser antall applikasjoner, implementerte kontroller, delvis implementerte
							kontroller og kontroller uten status for hvert team. Prosenten beregnes på samme måte som «Total
							compliance», men bare for teamets applikasjoner i utvalget. En applikasjon som tilhører flere team, inngår
							i hvert teamkort, men bare én gang i seksjonstotalene.
						</BodyLong>
					)}
					{showUnassignedCard && (
						<BodyLong>
							<strong>Uten team</strong> viser samme tall og beregning som teamkortene, men for applikasjoner som er
							knyttet til seksjonen via Nais-team og ikke tilordnet et utviklingsteam.
						</BodyLong>
					)}
				</VStack>
			</ReadMore>

			<DeploymentSummaryCards stats={deploymentStats} />

			<Heading size="large" level="3">
				Team
			</Heading>

			{noEconomyMatches ? (
				<BodyShort>Ingen applikasjoner er klassifisert som økonomisystem.</BodyShort>
			) : (
				<HGrid gap="space-6" columns={{ xs: 1, sm: 2 }}>
					{visibleTeams.map((team) => {
						const stats = team
						const { pct, mangler } = complianceFigures(stats)
						return (
							<DomainStatusCard
								key={team.slug}
								to={`/seksjoner/${seksjon}/team/${team.slug}`}
								title={team.name}
								pct={pct}
								implemented={stats.implemented}
								partial={stats.partial}
								mangler={mangler}
								barTotal={stats.total - stats.notRelevant}
								extraDetails={<BodyShort size="small">{stats.apps} applikasjoner</BodyShort>}
								footer="Se detaljer →"
							/>
						)
					})}
					{showUnassignedCard &&
						(() => {
							const stats = unassigned
							const { pct, mangler } = complianceFigures(stats)
							return (
								<DomainStatusCard
									to={`/seksjoner/${seksjon}/applikasjoner-uten-team`}
									title="Uten team"
									pct={pct}
									implemented={stats.implemented}
									partial={stats.partial}
									mangler={mangler}
									barTotal={stats.total - stats.notRelevant}
									extraDetails={<BodyShort size="small">{stats.apps} applikasjoner</BodyShort>}
									footer="Administrer →"
								/>
							)
						})()}
				</HGrid>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
