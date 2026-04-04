import { DownloadIcon, ExternalLinkIcon } from "@navikt/aksel-icons"
import {
	Link as AkselLink,
	Alert,
	BodyLong,
	BodyShort,
	Box,
	Button,
	CopyButton,
	Heading,
	HStack,
	Label,
	Table,
	Tabs,
	Tag,
	VStack,
} from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData, useSearchParams } from "react-router"
import { ComplianceStatusBadge } from "~/components/ComplianceStatus"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAppAssessments } from "~/db/queries/applications.server"
import { getApplicationDetail } from "~/db/queries/nais.server"
import type { ComplianceStatus } from "~/lib/compliance-status"
import { compliancePercent } from "~/lib/utils"

const persistenceLabels: Record<string, string> = {
	cloud_sql_postgres: "Cloud SQL (PostgreSQL)",
	nais_postgres: "Nais Postgres",
	on_prem_postgres: "On-prem PostgreSQL",
	opensearch: "OpenSearch",
	bucket: "GCS Bucket",
	valkey: "Valkey (cache)",
	oracle: "Oracle",
	other: "Annet",
}

const persistenceVariants: Record<
	string,
	"info" | "success" | "warning" | "error" | "neutral" | "alt1" | "alt2" | "alt3"
> = {
	cloud_sql_postgres: "info",
	nais_postgres: "info",
	on_prem_postgres: "warning",
	opensearch: "alt1",
	bucket: "alt2",
	valkey: "alt3",
	oracle: "warning",
	other: "neutral",
}

const authLabels: Record<string, string> = {
	entra_id: "Entra ID",
	token_x: "TokenX",
	id_porten: "ID-porten",
	maskinporten: "Maskinporten",
}

export async function loader({ params }: LoaderFunctionArgs) {
	const appId = params.appId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })

	const [detail, assessmentsResult] = await Promise.all([getApplicationDetail(appId), getAppAssessments(appId)])

	if (!detail) throw new Response("Applikasjon ikke funnet", { status: 404 })

	const { getApplicationElements } = await import("~/db/queries/technology-elements.server")
	const appElements = await getApplicationElements(appId)

	const assessments = assessmentsResult?.assessments ?? []
	const totalControls = assessments.length
	const implemented = assessments.filter((a) => a.status === "implemented").length
	const partial = assessments.filter((a) => a.status === "partially_implemented").length
	const notImplemented = assessments.filter((a) => a.status === "not_implemented").length
	const notRelevant = assessments.filter((a) => a.status === "not_relevant").length
	const notAssessed = assessments.filter((a) => !a.status).length

	return data({
		app: detail.app,
		environments: detail.environments,
		persistence: detail.persistence,
		authIntegrations: detail.authIntegrations,
		teams: detail.teams,
		primaryApp: detail.primaryApp,
		linkedApps: detail.linkedApps,
		appElements,
		compliance: {
			totalControls,
			implemented,
			partial,
			notImplemented,
			notRelevant,
			notAssessed,
			percent: compliancePercent(implemented, partial, totalControls),
		},
		assessments,
	})
}

export default function ApplikasjonDetalj() {
	const {
		app,
		environments,
		persistence,
		authIntegrations,
		teams,
		primaryApp,
		linkedApps,
		appElements,
		compliance,
		assessments,
	} = useLoaderData<typeof loader>()

	const [searchParams, setSearchParams] = useSearchParams()
	const activeTab = searchParams.get("fane") ?? "oversikt"

	const isOnPrem = environments.some((e) => e.cluster?.includes("-fss"))

	const gitHubUrl = environments.find((e) => e.gitRepository)?.gitRepository ?? `https://github.com/navikt/${app.name}`

	const controlsNeedingAttention = assessments.filter(
		(a) => !a.status || a.status === "not_implemented" || a.status === "partially_implemented",
	)

	return (
		<VStack gap="space-24">
			<div>
				<HStack justify="space-between" align="center">
					<Heading size="xlarge" level="2">
						{app.name}
					</Heading>
					<Button as={Link} to={`/applikasjoner/${app.id}/rediger`} variant="tertiary" size="small">
						Administrer
					</Button>
				</HStack>
				{app.description && <BodyLong>{app.description}</BodyLong>}
				<HStack gap="space-4" align="center" style={{ marginTop: "var(--ax-space-2)" }}>
					<AkselLink href={gitHubUrl} target="_blank" rel="noopener noreferrer">
						GitHub <ExternalLinkIcon aria-hidden />
					</AkselLink>
				</HStack>
			</div>

			{/* Primary app notice */}
			{primaryApp && (
				<Alert variant="info" size="small">
					Denne applikasjonen er lenket til primærapplikasjonen{" "}
					<Link to={`/applikasjoner/${primaryApp.id}/detaljer`}>{primaryApp.name}</Link>. Compliance-vurderinger arves
					fra primærapplikasjonen.
				</Alert>
			)}

			<Tabs value={activeTab} onChange={(tab) => setSearchParams({ fane: tab }, { replace: true })}>
				<Tabs.List>
					<Tabs.Tab value="oversikt" label="Oversikt" />
					<Tabs.Tab value="kontroller" label="Kontroller" />
					<Tabs.Tab value="autentisering" label="Autentisering" />
					<Tabs.Tab value="miljoer" label="Miljøer" />
					<Tabs.Tab value="persistering" label="Persistering" />
				</Tabs.List>

				{/* Oversikt */}
				<Tabs.Panel value="oversikt" style={{ paddingTop: "var(--ax-space-6)" }}>
					<VStack gap="space-24">
						{/* Compliance summary */}
						<Box>
							<Heading size="medium" level="3" spacing>
								Compliance
							</Heading>
							<HStack gap="space-6" wrap>
								<VStack gap="space-1">
									<Label size="small">Total</Label>
									<Heading size="large" level="4">
										<Tag
											variant={compliance.percent >= 80 ? "success" : compliance.percent >= 50 ? "warning" : "error"}
										>
											{compliance.percent} %
										</Tag>
									</Heading>
								</VStack>
								<VStack gap="space-1">
									<Label size="small">Implementert</Label>
									<BodyLong>{compliance.implemented}</BodyLong>
								</VStack>
								<VStack gap="space-1">
									<Label size="small">Delvis</Label>
									<BodyLong>{compliance.partial}</BodyLong>
								</VStack>
								<VStack gap="space-1">
									<Label size="small">Ikke implementert</Label>
									<BodyLong>{compliance.notImplemented}</BodyLong>
								</VStack>
								<VStack gap="space-1">
									<Label size="small">Ikke relevant</Label>
									<BodyLong>{compliance.notRelevant}</BodyLong>
								</VStack>
								<VStack gap="space-1">
									<Label size="small">Ikke vurdert</Label>
									<BodyLong>{compliance.notAssessed}</BodyLong>
								</VStack>
							</HStack>
							<VStack gap="space-4">
								<HStack gap="space-8" align="center">
									<Link to={`/applikasjoner/${app.id}/compliance`}>Gå til compliance-vurdering →</Link>
									<Button
										as="a"
										href={`/api/applikasjoner/${app.id}/export-xlsx`}
										variant="secondary"
										size="small"
										icon={<DownloadIcon aria-hidden />}
									>
										Last ned XLSX
									</Button>
								</HStack>
							</VStack>
						</Box>

						{/* Linked applications */}
						{linkedApps.length > 0 && (
							<Box>
								<Heading size="medium" level="3" spacing>
									Lenkede applikasjoner
								</Heading>
								<BodyLong spacing>
									Disse applikasjonene er testdeploymenter eller varianter som arver compliance-vurderinger fra denne
									applikasjonen.
								</BodyLong>
								<HStack gap="space-4" wrap>
									{linkedApps.map((la) => (
										<Tag key={la.id} variant="neutral" size="small">
											<Link to={`/applikasjoner/${la.id}/detaljer`}>{la.name}</Link>
										</Tag>
									))}
								</HStack>
							</Box>
						)}

						{/* Teams */}
						<Box>
							<Heading size="medium" level="3" spacing>
								Team
							</Heading>
							{teams.length > 0 ? (
								<HStack gap="space-4" wrap>
									{teams.map((t) => (
										<Tag key={t.teamId} variant="info" size="small">
											{t.teamName}
										</Tag>
									))}
								</HStack>
							) : (
								<BodyLong>Ikke tilknyttet noe utviklerteam.</BodyLong>
							)}
						</Box>

						{/* Technology elements */}
						<Box>
							<Heading size="medium" level="3" spacing>
								Teknologielementer
							</Heading>
							{appElements.length > 0 ? (
								<HStack gap="space-4" wrap>
									{appElements.map((el) => (
										<Tag
											key={el.id}
											variant={
												el.rejectedAt
													? "neutral"
													: el.confirmedAt
														? "success"
														: el.source === "auto"
															? "warning"
															: "alt1"
											}
											size="small"
										>
											{el.name}
										</Tag>
									))}
								</HStack>
							) : (
								<BodyLong>Ingen teknologielementer er tilordnet.</BodyLong>
							)}
						</Box>
					</VStack>
				</Tabs.Panel>

				{/* Kontroller */}
				<Tabs.Panel value="kontroller" style={{ paddingTop: "var(--ax-space-6)" }}>
					{controlsNeedingAttention.length > 0 ? (
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Domene</Table.HeaderCell>
									<Table.HeaderCell scope="col">Kontroll-ID</Table.HeaderCell>
									<Table.HeaderCell scope="col">Navn</Table.HeaderCell>
									<Table.HeaderCell scope="col">Status</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{controlsNeedingAttention.map((a) => (
									<Table.Row key={a.controlUuid}>
										<Table.DataCell>{a.domainName}</Table.DataCell>
										<Table.DataCell>{a.controlId}</Table.DataCell>
										<Table.DataCell>{a.controlName}</Table.DataCell>
										<Table.DataCell>
											{a.status ? (
												<ComplianceStatusBadge status={a.status as ComplianceStatus} />
											) : (
												<Tag variant="neutral" size="xsmall">
													Ikke vurdert
												</Tag>
											)}
										</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					) : (
						<BodyLong>Alle kontroller er vurdert.</BodyLong>
					)}
				</Tabs.Panel>

				{/* Autentisering */}
				<Tabs.Panel value="autentisering" style={{ paddingTop: "var(--ax-space-6)" }}>
					{authIntegrations.length > 0 ? (
						<VStack gap="space-4">
							<Table size="small">
								<Table.Header>
									<Table.Row>
										<Table.HeaderCell scope="col">Integrasjon</Table.HeaderCell>
										<Table.HeaderCell scope="col">Login proxy</Table.HeaderCell>
										<Table.HeaderCell scope="col">Brukertilgang</Table.HeaderCell>
										<Table.HeaderCell scope="col">Applikasjonstilgang</Table.HeaderCell>
										<Table.HeaderCell scope="col">Claims</Table.HeaderCell>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{authIntegrations.map((auth) => {
										const claimsExtra = auth.claimsExtra ? (JSON.parse(auth.claimsExtra) as string[]) : null
										const inboundRules = auth.inboundRules
											? (JSON.parse(auth.inboundRules) as Array<{
													application: string
													namespace?: string
													cluster?: string
												}>)
											: null
										const supportsProxy = auth.type === "entra_id" || auth.type === "id_porten"
										return (
											<Table.Row key={auth.id}>
												<Table.DataCell>{authLabels[auth.type] ?? auth.type}</Table.DataCell>
												<Table.DataCell>
													{supportsProxy ? (
														isOnPrem ? (
															<Tag variant="neutral" size="xsmall">
																Ikke tilgjengelig (on-prem)
															</Tag>
														) : auth.sidecarEnabled ? (
															<Tag variant="success" size="xsmall">
																Aktivert
															</Tag>
														) : auth.sidecarEnabled === false ? (
															<Tag variant="neutral" size="xsmall">
																Ikke aktivert
															</Tag>
														) : (
															<BodyShort size="small" textColor="subtle">
																Ukjent
															</BodyShort>
														)
													) : (
														<BodyShort size="small" textColor="subtle">
															—
														</BodyShort>
													)}
												</Table.DataCell>
												<Table.DataCell>
													{auth.type === "entra_id" ? (
														auth.allowAllUsers ? (
															<Tag variant="warning" size="xsmall">
																Alle brukere
															</Tag>
														) : auth.groups ? (
															<Tag variant="info" size="xsmall">
																Gruppebasert
															</Tag>
														) : (
															<Tag variant="neutral" size="xsmall">
																Ikke konfigurert
															</Tag>
														)
													) : auth.type === "id_porten" ? (
														<Tag variant="info" size="xsmall">
															Borgere (ID-porten)
														</Tag>
													) : auth.type === "token_x" ? (
														<Tag variant="info" size="xsmall">
															Via TokenX
														</Tag>
													) : (
														<BodyShort size="small" textColor="subtle">
															—
														</BodyShort>
													)}
												</Table.DataCell>
												<Table.DataCell>
													{auth.type === "entra_id" || auth.type === "maskinporten" ? (
														inboundRules && inboundRules.length > 0 ? (
															<Tag variant="info" size="xsmall">
																{inboundRules.length} {inboundRules.length === 1 ? "applikasjon" : "applikasjoner"}
															</Tag>
														) : (
															<Tag variant="neutral" size="xsmall">
																Ikke konfigurert
															</Tag>
														)
													) : (
														<BodyShort size="small" textColor="subtle">
															—
														</BodyShort>
													)}
												</Table.DataCell>
												<Table.DataCell>
													{claimsExtra && claimsExtra.length > 0 ? (
														<HStack gap="space-1" wrap>
															{claimsExtra.map((claim) => (
																<Tag key={claim} variant="neutral" size="xsmall">
																	{claim}
																</Tag>
															))}
														</HStack>
													) : (
														<BodyShort size="small" textColor="subtle">
															—
														</BodyShort>
													)}
												</Table.DataCell>
											</Table.Row>
										)
									})}
								</Table.Body>
							</Table>

							{/* Entra ID groups */}
							{authIntegrations
								.filter((a) => a.type === "entra_id" && a.groups)
								.map((auth) => {
									const groups = JSON.parse(auth.groups!) as string[]
									if (groups.length === 0) return null
									return (
										<VStack key={`groups-${auth.id}`} gap="space-2">
											<Heading size="xsmall" level="4">
												Entra ID-grupper ({groups.length})
											</Heading>
											<BodyShort size="small" textColor="subtle">
												{auth.allowAllUsers
													? "Alle brukere får utstedt token uavhengig av gruppemedlemskap."
													: "Bruker må være medlem av minst én av gruppene for å få utstedt token. Applikasjonen kan ha ytterligere tilgangskontroll som avgrenser tilgang."}
											</BodyShort>
											<Table size="small">
												<Table.Header>
													<Table.Row>
														<Table.HeaderCell scope="col">Gruppe-ID</Table.HeaderCell>
														<Table.HeaderCell scope="col" style={{ width: "1px" }}>
															<span className="navds-sr-only">Kopier</span>
														</Table.HeaderCell>
													</Table.Row>
												</Table.Header>
												<Table.Body>
													{groups.map((groupId) => (
														<Table.Row key={groupId}>
															<Table.DataCell>
																<code style={{ fontSize: "var(--ax-font-size-sm)" }}>{groupId}</code>
															</Table.DataCell>
															<Table.DataCell>
																<CopyButton copyText={groupId} size="xsmall" />
															</Table.DataCell>
														</Table.Row>
													))}
												</Table.Body>
											</Table>
										</VStack>
									)
								})}

							{/* Inbound access policy rules */}
							{authIntegrations
								.filter((a) => a.type === "entra_id" && a.inboundRules)
								.map((auth) => {
									const rules = JSON.parse(auth.inboundRules!) as Array<{
										application: string
										namespace?: string
										cluster?: string
									}>
									if (rules.length === 0) return null
									return (
										<VStack key={`inbound-${auth.id}`} gap="space-2">
											<Heading size="xsmall" level="4">
												Autoriserte applikasjoner ({rules.length})
											</Heading>
											<BodyShort size="small" textColor="subtle">
												Applikasjoner som har tilgang til å kalle dette API-et via Entra ID (M2M eller on-behalf-of).
											</BodyShort>
											<Table size="small">
												<Table.Header>
													<Table.Row>
														<Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
														<Table.HeaderCell scope="col">Namespace</Table.HeaderCell>
														<Table.HeaderCell scope="col">Kluster</Table.HeaderCell>
													</Table.Row>
												</Table.Header>
												<Table.Body>
													{rules.map((rule) => (
														<Table.Row key={`${rule.application}-${rule.namespace ?? ""}-${rule.cluster ?? ""}`}>
															<Table.DataCell>
																<code style={{ fontSize: "var(--ax-font-size-sm)" }}>{rule.application}</code>
															</Table.DataCell>
															<Table.DataCell>
																{rule.namespace ? (
																	<code style={{ fontSize: "var(--ax-font-size-sm)" }}>{rule.namespace}</code>
																) : (
																	<BodyShort size="small" textColor="subtle">
																		Samme
																	</BodyShort>
																)}
															</Table.DataCell>
															<Table.DataCell>
																{rule.cluster ? (
																	<code style={{ fontSize: "var(--ax-font-size-sm)" }}>{rule.cluster}</code>
																) : (
																	<BodyShort size="small" textColor="subtle">
																		Samme
																	</BodyShort>
																)}
															</Table.DataCell>
														</Table.Row>
													))}
												</Table.Body>
											</Table>
										</VStack>
									)
								})}
						</VStack>
					) : (
						<BodyLong>Ingen autentiseringsintegrasjoner funnet.</BodyLong>
					)}
				</Tabs.Panel>

				{/* Miljøer */}
				<Tabs.Panel value="miljoer" style={{ paddingTop: "var(--ax-space-6)" }}>
					{environments.length > 0 ? (
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Klynge</Table.HeaderCell>
									<Table.HeaderCell scope="col">Namespace</Table.HeaderCell>
									<Table.HeaderCell scope="col">Nais-team</Table.HeaderCell>
									<Table.HeaderCell scope="col">Image</Table.HeaderCell>
									<Table.HeaderCell scope="col">Oppdaget</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{environments.map((env) => (
									<Table.Row key={env.id}>
										<Table.DataCell>
											<Tag variant="neutral" size="xsmall">
												{env.cluster}
											</Tag>
										</Table.DataCell>
										<Table.DataCell>{env.namespace}</Table.DataCell>
										<Table.DataCell>{env.naisTeamSlug ?? "–"}</Table.DataCell>
										<Table.DataCell
											style={{
												wordBreak: "break-all",
												maxWidth: "300px",
												fontSize: "var(--ax-font-size-small)",
											}}
										>
											{env.imageName ?? "–"}
										</Table.DataCell>
										<Table.DataCell>{new Date(env.discoveredAt).toLocaleDateString("nb-NO")}</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					) : (
						<BodyLong>Ingen kjente miljøer.</BodyLong>
					)}
				</Tabs.Panel>

				{/* Persistering */}
				<Tabs.Panel value="persistering" style={{ paddingTop: "var(--ax-space-6)" }}>
					{persistence.length > 0 ? (
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Type</Table.HeaderCell>
									<Table.HeaderCell scope="col">Navn</Table.HeaderCell>
									<Table.HeaderCell scope="col">Versjon</Table.HeaderCell>
									<Table.HeaderCell scope="col">Tier</Table.HeaderCell>
									<Table.HeaderCell scope="col">HA</Table.HeaderCell>
									<Table.HeaderCell scope="col">Audit logging</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{persistence.map((p) => (
									<Table.Row key={p.id}>
										<Table.DataCell>
											<Tag variant={persistenceVariants[p.type] ?? "neutral"} size="xsmall">
												{persistenceLabels[p.type] ?? p.type}
											</Tag>
										</Table.DataCell>
										<Table.DataCell>{p.name}</Table.DataCell>
										<Table.DataCell>{p.version ?? "–"}</Table.DataCell>
										<Table.DataCell>{p.tier ?? "–"}</Table.DataCell>
										<Table.DataCell>
											{p.highAvailability === true ? (
												<Tag variant="success" size="xsmall">
													Ja
												</Tag>
											) : p.highAvailability === false ? (
												<Tag variant="error" size="xsmall">
													Nei
												</Tag>
											) : (
												"–"
											)}
										</Table.DataCell>
										<Table.DataCell>
											{p.auditLogging === true ? (
												p.auditLogUrl ? (
													<AkselLink href={p.auditLogUrl} target="_blank" rel="noopener noreferrer">
														<Tag variant="success" size="xsmall">
															Ja – se logg (åpnes i nytt vindu)
														</Tag>
													</AkselLink>
												) : (
													<Tag variant="success" size="xsmall">
														Ja
													</Tag>
												)
											) : p.auditLogging === false ? (
												<Tag variant="error" size="xsmall">
													Nei
												</Tag>
											) : (
												"–"
											)}
										</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					) : (
						<BodyLong>Ingen kjent persistens fra Nais.</BodyLong>
					)}
				</Tabs.Panel>
			</Tabs>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
