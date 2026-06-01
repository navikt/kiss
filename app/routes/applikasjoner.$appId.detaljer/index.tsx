import { ExternalLinkIcon } from "@navikt/aksel-icons"
import {
	Link as AkselLink,
	BodyLong,
	BodyShort,
	Box,
	Button,
	Detail,
	Heading,
	HStack,
	Tabs,
	Tag,
	VStack,
} from "@navikt/ds-react"
import { Link, useLoaderData, useSearchParams } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { type EconomySystemType, economySystemTypeLabels } from "~/db/schema/applications"
import { useAppBasePath } from "~/hooks/useAppBasePath"
import { useSectionSlug } from "~/hooks/useSectionSlug"

import type { loader } from "./loader.server"
import { AutentiseringTab } from "./tabs/AutentiseringTab"
import { AutoriserteAppsTab } from "./tabs/AutoriserteAppsTab"
import { DeploymentsTab } from "./tabs/DeploymentsTab"
import { GitHubTilgangerTab } from "./tabs/GitHubTilgangerTab"
import { KontrollerTab } from "./tabs/KontrollerTab"
import { LenkedeAppsTab } from "./tabs/LenkedeAppsTab"
import { MiljoerTab } from "./tabs/MiljoerTab"
import { OppfolgingspunkterTab } from "./tabs/OppfolgingspunkterTab"
import { PersisteringTab } from "./tabs/PersisteringTab"
import { RapporterTab } from "./tabs/RapporterTab"
import { RegelsettTab } from "./tabs/RegelsettTab"
import { RevisjonsbevisTab } from "./tabs/RevisjonsbevisTab"
import { RutinerTab } from "./tabs/RutinerTab"
import { ScreeningerTab } from "./tabs/ScreeningerTab"

export { action } from "./action.server"
export { loader } from "./loader.server"
export { RouteErrorBoundary as ErrorBoundary }

export default function ApplikasjonDetalj() {
	const {
		app,
		environments,
		persistence,
		oracleAuditSummaries,
		deploymentVerifications,
		authIntegrations,
		manualGroups,
		groupNames,
		assessmentsByGroupId,
		naisGroupIds,
		ghostGroupIds,
		rpaUsers,
		accessPolicyRules,
		teams,
		primaryApp,
		linkedApps,
		appElements,
		routineDeadlines,
		completedReviews,
		sectionSlugMap,
		canAdmin,
		canAccessReports,
		knownApps,
		acknowledgments,
		compliance,
		assessments,
		appReports,
		screeningSessions,
		oracleInstances,
		totalOracleInstanceCount,
		inaccessibleOracleGroups,
		oracleRoles,
		instanceSnapshotHistories,
		githubAccess,
		effectiveGitRepository,
		appRulesets,
		economyClassification,
	} = useLoaderData<typeof loader>()

	const [searchParams, setSearchParams] = useSearchParams()
	const rawTab = searchParams.get("fane") ?? "rutiner"
	// Normalize: fall back to default if URL references a tab the user cannot access
	const activeTab = (() => {
		if (rawTab === "rapporter" && !canAccessReports) return "rutiner"
		if (rawTab === "revisjonsbevis" && (!canAccessReports || oracleInstances.length === 0)) return "rutiner"
		return rawTab
	})()
	const appBase = useAppBasePath()
	const sectionSlug = useSectionSlug()

	const isOnPrem = environments.some((e: { cluster: string | null }) => e.cluster?.includes("-fss"))
	const gitHubUrl = effectiveGitRepository
		? effectiveGitRepository.startsWith("http")
			? effectiveGitRepository
			: `https://github.com/${effectiveGitRepository}`
		: `https://github.com/navikt/${app.name}`

	// Flatten follow-up points from finalized reviews (not drafts)
	const followUpPoints = completedReviews
		.filter((r) => r.status === "completed" || r.status === "needs_follow_up")
		.flatMap((r) =>
			r.followUpPoints.map((p) => ({
				id: p.id,
				reviewId: r.id,
				routineId: r.routineId,
				routineName: r.routineName,
				sectionId: r.sectionId,
				reviewTitle: r.title,
				reviewedAt: r.reviewedAt,
				text: p.text,
				description: p.description,
				resolution: p.resolution,
				status: p.status as "needs_follow_up" | "completed" | "not_relevant",
				createdBy: p.createdBy,
				resolvedAt: p.resolvedAt,
				resolvedBy: p.resolvedBy,
			})),
		)
	const openFollowUpCount = followUpPoints.filter((p) => p.status === "needs_follow_up").length

	return (
		<VStack gap="space-24">
			<div>
				<HStack justify="space-between" align="center">
					<Heading size="xlarge" level="2">
						{app.name}
					</Heading>
					{canAdmin && (
						<Button as={Link} to={`${appBase}/rediger`} variant="tertiary" size="small">
							Administrer
						</Button>
					)}
				</HStack>
				{app.description && <BodyLong>{app.description}</BodyLong>}
				<HStack gap="space-4" align="center" style={{ marginTop: "var(--ax-space-2)" }}>
					<AkselLink href={gitHubUrl} target="_blank" rel="noopener noreferrer">
						GitHub <ExternalLinkIcon aria-hidden />
					</AkselLink>
				</HStack>
			</div>

			{economyClassification?.isEconomySystem && (
				<Box background="warning-moderate" padding="space-8" borderRadius="8">
					<HStack gap="space-8" align="center">
						<span aria-hidden="true" style={{ fontSize: "2.5rem" }}>
							💰
						</span>
						<VStack gap="space-2">
							<BodyShort weight="semibold">Klassifisert som økonomisystem</BodyShort>
							{economyClassification.economySystemType && (
								<BodyShort size="small">
									{economySystemTypeLabels[economyClassification.economySystemType as EconomySystemType] ??
										economyClassification.economySystemType}
								</BodyShort>
							)}
						</VStack>
					</HStack>
				</Box>
			)}

			{primaryApp && (
				<Box background="brand-blue-soft" padding="space-8" borderRadius="8">
					<VStack gap="space-2">
						<BodyShort weight="semibold">Dette er en lenket applikasjon</BodyShort>
						<BodyShort>
							Compliance-vurderinger arves fra{" "}
							<Link to={`/applikasjoner/${primaryApp.id}/detaljer`}>{primaryApp.name}</Link>
						</BodyShort>
					</VStack>
				</Box>
			)}

			<Box background="sunken" padding="space-16" borderRadius="8">
				<VStack gap="space-12">
					<HStack gap="space-16" wrap align="center">
						<Tag
							variant={compliance.percent >= 80 ? "success" : compliance.percent >= 50 ? "warning" : "error"}
							size="medium"
						>
							{compliance.percent} % compliance
						</Tag>
						{compliance.screeningProgress.total > 0 && (
							<Tag
								variant={
									compliance.screeningProgress.answered === compliance.screeningProgress.total
										? "success"
										: compliance.screeningProgress.answered > 0
											? "warning"
											: "error"
								}
								size="medium"
							>
								{compliance.screeningProgress.answered} / {compliance.screeningProgress.total} spørsmål besvart
							</Tag>
						)}
					</HStack>

					{(compliance.routinesGjennomfort + compliance.routinesIkkeGjennomfort > 0 ||
						compliance.routinesMaaFolgesOpp > 0) && (
						<VStack gap="space-4">
							<Detail weight="semibold" textColor="subtle">
								Rutineetterlevelse
							</Detail>
							<HStack gap="space-8" wrap>
								<Tag variant="success" size="xsmall">
									{compliance.routinesGjennomfort} gjennomført
								</Tag>
								{compliance.routinesIkkeGjennomfort > 0 && (
									<Tag variant="error" size="xsmall">
										{compliance.routinesIkkeGjennomfort} ikke gjennomført
									</Tag>
								)}
								{compliance.routinesMaaFolgesOpp > 0 && (
									<Tag variant="warning" size="xsmall">
										{compliance.routinesMaaFolgesOpp} må følges opp
									</Tag>
								)}
							</HStack>
						</VStack>
					)}

					{compliance.screeningProgress.answered === 0 && (
						<BodyShort textColor="subtle" size="small">
							⚠️ Ingen screening-svar registrert. Utfør screening for å få mer presis rutinematching.
						</BodyShort>
					)}
				</VStack>
			</Box>

			{teams.length > 0 && (
				<Box>
					<BodyShort weight="semibold" spacing>
						Team
					</BodyShort>
					<HStack gap="space-4" wrap>
						{teams.map((t: { teamId: string; teamName: string; teamSlug: string; sectionId: string | null }) => {
							const sectionSlug = t.sectionId ? sectionSlugMap[t.sectionId] : null
							return sectionSlug ? (
								<Tag key={t.teamId} variant="info" size="small">
									<Link to={`/seksjoner/${sectionSlug}/team/${t.teamSlug}`}>{t.teamName}</Link>
								</Tag>
							) : (
								<Tag key={t.teamId} variant="info" size="small">
									{t.teamName}
								</Tag>
							)
						})}
					</HStack>
				</Box>
			)}

			{appElements.length > 0 && (
				<Box>
					<BodyShort weight="semibold" spacing>
						Teknologielementer
					</BodyShort>
					<HStack gap="space-4" wrap>
						{appElements.map(
							(te: {
								id: string
								name: string
								source: string | null
								confirmedAt: string | Date | null
								rejectedAt: string | Date | null
							}) => (
								<Tag
									key={te.id}
									variant={
										te.rejectedAt ? "neutral" : te.confirmedAt ? "success" : te.source === "auto" ? "warning" : "alt1"
									}
									size="small"
								>
									{te.name}
								</Tag>
							),
						)}
					</HStack>
				</Box>
			)}

			<Tabs
				value={activeTab}
				onChange={(val) => {
					setSearchParams(
						(prev) => {
							const next = new URLSearchParams(prev)
							next.set("fane", val)
							return next
						},
						{ replace: true },
					)
				}}
			>
				<Tabs.List>
					<Tabs.Tab value="rutiner" label="Rutiner" />
					<Tabs.Tab value="screeninger" label="Screeninger" />
					<Tabs.Tab value="regelsett" label="Regelsett" />
					<Tabs.Tab value="kontroller" label="Kontroller" />
					<Tabs.Tab value="autentisering" label="Autentisering" />
					<Tabs.Tab value="autoriserte-applikasjoner" label="Autoriserte applikasjoner" />
					<Tabs.Tab value="miljoer" label="Miljøer" />
					{environments.length > 0 && <Tabs.Tab value="deployments" label="Deployments" />}
					<Tabs.Tab value="persistering" label="Persistering" />
					{oracleInstances.length > 0 && canAccessReports && <Tabs.Tab value="revisjonsbevis" label="Revisjonsbevis" />}
					{linkedApps.length > 0 && <Tabs.Tab value="lenkede-applikasjoner" label="Lenkede applikasjoner" />}
					{effectiveGitRepository && <Tabs.Tab value="github-tilganger" label="GitHub-tilganger" />}
					<Tabs.Tab
						value="oppfolgingspunkter"
						label={openFollowUpCount > 0 ? `Oppfølgingspunkter (${openFollowUpCount})` : "Oppfølgingspunkter"}
					/>
					{canAccessReports && <Tabs.Tab value="rapporter" label="Rapporter" />}
				</Tabs.List>

				<Tabs.Panel value="rutiner" style={{ paddingTop: "var(--ax-space-6)" }}>
					<RutinerTab
						routineDeadlines={routineDeadlines}
						completedReviews={completedReviews}
						sectionSlugMap={sectionSlugMap}
					/>
				</Tabs.Panel>

				<Tabs.Panel value="screeninger" style={{ paddingTop: "var(--ax-space-6)" }}>
					<ScreeningerTab screeningSessions={screeningSessions} appBasePath={appBase} canAdmin={canAdmin} />
				</Tabs.Panel>

				<Tabs.Panel value="regelsett" style={{ paddingTop: "var(--ax-space-6)" }}>
					<RegelsettTab rulesets={appRulesets} />
				</Tabs.Panel>

				<Tabs.Panel value="kontroller" style={{ paddingTop: "var(--ax-space-6)" }}>
					<KontrollerTab
						assessments={assessments}
						compliance={compliance}
						sectionSlug={sectionSlug}
						appBasePath={appBase}
					/>
				</Tabs.Panel>

				<Tabs.Panel value="autentisering" style={{ paddingTop: "var(--ax-space-6)" }}>
					<AutentiseringTab
						authIntegrations={authIntegrations}
						naisGroupIds={naisGroupIds}
						manualGroups={manualGroups}
						ghostGroupIds={ghostGroupIds}
						groupNames={groupNames}
						assessmentsByGroupId={assessmentsByGroupId}
						isOnPrem={isOnPrem}
						rpaUsers={rpaUsers}
					/>
				</Tabs.Panel>

				<Tabs.Panel value="autoriserte-applikasjoner" style={{ paddingTop: "var(--ax-space-6)" }}>
					<AutoriserteAppsTab
						accessPolicyRules={accessPolicyRules}
						knownApps={knownApps}
						acknowledgments={acknowledgments}
					/>
				</Tabs.Panel>

				<Tabs.Panel value="miljoer" style={{ paddingTop: "var(--ax-space-6)" }}>
					<MiljoerTab environments={environments} />
				</Tabs.Panel>

				{environments.length > 0 && (
					<Tabs.Panel value="deployments" style={{ paddingTop: "var(--ax-space-6)" }}>
						<DeploymentsTab deploymentVerifications={deploymentVerifications} />
					</Tabs.Panel>
				)}

				<Tabs.Panel value="persistering" style={{ paddingTop: "var(--ax-space-6)" }}>
					<PersisteringTab
						persistence={persistence}
						oracleAuditSummaries={oracleAuditSummaries}
						oracleRoles={oracleRoles}
						canAdmin={canAdmin}
						inaccessibleOracleGroups={inaccessibleOracleGroups}
					/>
				</Tabs.Panel>

				{oracleInstances.length > 0 && canAccessReports && (
					<Tabs.Panel value="revisjonsbevis" style={{ paddingTop: "var(--ax-space-6)" }}>
						<RevisjonsbevisTab
							oracleInstanceCount={oracleInstances.length}
							totalOracleInstanceCount={totalOracleInstanceCount}
							instanceSnapshotHistories={instanceSnapshotHistories}
							groupNames={groupNames}
						/>
					</Tabs.Panel>
				)}

				{linkedApps.length > 0 && (
					<Tabs.Panel value="lenkede-applikasjoner" style={{ paddingTop: "var(--ax-space-6)" }}>
						<LenkedeAppsTab linkedApps={linkedApps} />
					</Tabs.Panel>
				)}

				{effectiveGitRepository && (
					<Tabs.Panel value="github-tilganger" style={{ paddingTop: "var(--ax-space-6)" }}>
						<GitHubTilgangerTab
							teams={githubAccess.teams}
							collaborators={githubAccess.collaborators}
							changeLog={githubAccess.changeLog}
						/>
					</Tabs.Panel>
				)}

				<Tabs.Panel value="oppfolgingspunkter" style={{ paddingTop: "var(--ax-space-6)" }}>
					<OppfolgingspunkterTab followUpPoints={followUpPoints} sectionSlugMap={sectionSlugMap} />
				</Tabs.Panel>

				{canAccessReports && (
					<Tabs.Panel value="rapporter" style={{ paddingTop: "var(--ax-space-6)" }}>
						<RapporterTab appReports={appReports} completedReviews={completedReviews} />
					</Tabs.Panel>
				)}
			</Tabs>
		</VStack>
	)
}
