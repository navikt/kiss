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
import { useAppBasePath } from "~/hooks/useAppBasePath"
import { useSectionSlug } from "~/hooks/useSectionSlug"

import type { loader } from "./loader.server"
import { AutentiseringTab } from "./tabs/AutentiseringTab"
import { AutoriserteAppsTab } from "./tabs/AutoriserteAppsTab"
import { DeploymentsTab } from "./tabs/DeploymentsTab"
import { KontrollerTab } from "./tabs/KontrollerTab"
import { LenkedeAppsTab } from "./tabs/LenkedeAppsTab"
import { MiljoerTab } from "./tabs/MiljoerTab"
import { PersisteringTab } from "./tabs/PersisteringTab"
import { RapporterTab } from "./tabs/RapporterTab"
import { RevisjonsbevisTab } from "./tabs/RevisjonsbevisTab"
import { RutinerTab } from "./tabs/RutinerTab"

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
		accessPolicyRules,
		teams,
		primaryApp,
		linkedApps,
		appElements,
		routineDeadlines,
		completedReviews,
		sectionSlugMap,
		canAdmin,
		knownApps,
		acknowledgments,
		compliance,
		assessments,
		appReports,
		oracleInstances,
		totalOracleInstanceCount,
		instanceSnapshotHistories,
	} = useLoaderData<typeof loader>()

	const [searchParams, setSearchParams] = useSearchParams()
	const activeTab = searchParams.get("fane") ?? "kontroller"
	const appBase = useAppBasePath()
	const sectionSlug = useSectionSlug()

	const isOnPrem = environments.some((e: { cluster: string | null }) => e.cluster?.includes("-fss"))
	const gitHubUrl =
		environments.find((e: { gitRepository: string | null }) => e.gitRepository)?.gitRepository ??
		`https://github.com/navikt/${app.name}`

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
					<HStack gap="space-16" wrap justify="space-between" align="center">
						<HStack gap="space-16" wrap align="center">
							<Tag
								variant={compliance.percent >= 80 ? "success" : compliance.percent >= 50 ? "warning" : "error"}
								size="medium"
							>
								{compliance.percent} % compliance
							</Tag>
							<HStack gap="space-12" wrap>
								<VStack align="center">
									<BodyShort size="small" weight="semibold">
										{compliance.implemented}
									</BodyShort>
									<Detail textColor="subtle">Implementert</Detail>
								</VStack>
								<VStack align="center">
									<BodyShort size="small" weight="semibold">
										{compliance.partial}
									</BodyShort>
									<Detail textColor="subtle">Delvis</Detail>
								</VStack>
								<VStack align="center">
									<BodyShort size="small" weight="semibold">
										{compliance.notImplemented}
									</BodyShort>
									<Detail textColor="subtle">Ikke impl.</Detail>
								</VStack>
								<VStack align="center">
									<BodyShort size="small" weight="semibold">
										{compliance.notRelevant}
									</BodyShort>
									<Detail textColor="subtle">Ikke relevant</Detail>
								</VStack>
								<VStack align="center">
									<BodyShort size="small" weight="semibold">
										{compliance.notAssessed}
									</BodyShort>
									<Detail textColor="subtle">Ikke vurdert</Detail>
								</VStack>
							</HStack>
						</HStack>
						<Link to={`${appBase}/compliance`}>
							<Button as="span" size="small" variant="secondary">
								Gå til compliance-screening
							</Button>
						</Link>
					</HStack>

					<HStack gap="space-24" wrap>
						<VStack gap="space-4">
							<Detail weight="semibold" textColor="subtle">
								Rutineetablering
							</Detail>
							<HStack gap="space-8" wrap>
								<Tag variant="success" size="xsmall">
									{compliance.withRoutine} etablert
								</Tag>
								<Tag variant="error" size="xsmall">
									{compliance.withoutRoutine} mangler
								</Tag>
								{compliance.routineNotRelevant > 0 && (
									<Tag variant="neutral" size="xsmall">
										{compliance.routineNotRelevant} ikke relevant
									</Tag>
								)}
							</HStack>
						</VStack>
						{compliance.withRoutine > 0 && (
							<VStack gap="space-4">
								<Detail weight="semibold" textColor="subtle">
									Rutineetterlevelse
								</Detail>
								<HStack gap="space-8" wrap>
									<Tag variant="success" size="xsmall">
										{compliance.routineCompleted} gjennomført
									</Tag>
									{compliance.routineOverdue > 0 && (
										<Tag variant="warning" size="xsmall">
											{compliance.routineOverdue} forfalt
										</Tag>
									)}
									{compliance.routineNeverReviewed > 0 && (
										<Tag variant="error" size="xsmall">
											{compliance.routineNeverReviewed} ikke gjennomført
										</Tag>
									)}
								</HStack>
							</VStack>
						)}
					</HStack>

					{!compliance.hasScreeningAnswers && (
						<BodyShort textColor="subtle" size="small">
							⚠️ Ingen screening-svar registrert. Utfør screening for å få mer presis rutinematching.
						</BodyShort>
					)}
				</VStack>
			</Box>

			{teams.length > 0 && (
				<Box>
					<BodyShort weight="semibold" spacing>
						Nais-team
					</BodyShort>
					<HStack gap="space-4" wrap>
						{teams.map((t: { teamId: string; teamName: string; teamSlug: string }) => (
							<Tag key={t.teamId} variant="info" size="small">
								{t.teamName}
							</Tag>
						))}
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
					<Tabs.Tab value="kontroller" label="Kontroller" />
					<Tabs.Tab value="autentisering" label="Autentisering" />
					<Tabs.Tab value="autoriserte-applikasjoner" label="Autoriserte applikasjoner" />
					<Tabs.Tab value="miljoer" label="Miljøer" />
					{environments.length > 0 && <Tabs.Tab value="deployments" label="Deployments" />}
					<Tabs.Tab value="persistering" label="Persistering" />
					{oracleInstances.length > 0 && <Tabs.Tab value="revisjonsbevis" label="Revisjonsbevis" />}
					<Tabs.Tab value="rutiner" label="Rutiner" />
					{linkedApps.length > 0 && <Tabs.Tab value="lenkede-applikasjoner" label="Lenkede applikasjoner" />}
					<Tabs.Tab value="rapporter" label="Rapporter" />
				</Tabs.List>

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
						canAdmin={canAdmin}
						isOnPrem={isOnPrem}
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
					<PersisteringTab persistence={persistence} oracleAuditSummaries={oracleAuditSummaries} />
				</Tabs.Panel>

				{oracleInstances.length > 0 && (
					<Tabs.Panel value="revisjonsbevis" style={{ paddingTop: "var(--ax-space-6)" }}>
						<RevisjonsbevisTab
							oracleInstanceCount={oracleInstances.length}
							totalOracleInstanceCount={totalOracleInstanceCount}
							instanceSnapshotHistories={instanceSnapshotHistories}
							groupNames={groupNames}
						/>
					</Tabs.Panel>
				)}

				<Tabs.Panel value="rutiner" style={{ paddingTop: "var(--ax-space-6)" }}>
					<RutinerTab
						routineDeadlines={routineDeadlines}
						completedReviews={completedReviews}
						sectionSlugMap={sectionSlugMap}
					/>
				</Tabs.Panel>

				{linkedApps.length > 0 && (
					<Tabs.Panel value="lenkede-applikasjoner" style={{ paddingTop: "var(--ax-space-6)" }}>
						<LenkedeAppsTab linkedApps={linkedApps} />
					</Tabs.Panel>
				)}

				<Tabs.Panel value="rapporter" style={{ paddingTop: "var(--ax-space-6)" }}>
					<RapporterTab appReports={appReports} completedReviews={completedReviews} />
				</Tabs.Panel>
			</Tabs>
		</VStack>
	)
}
