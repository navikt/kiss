import {
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
	Tag,
	VStack,
} from "@navikt/ds-react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, redirect, useLoaderData } from "react-router"
import type { ComplianceStatusValue } from "~/components/ComplianceStatus"
import { ComplianceStatusBadge } from "~/components/ComplianceStatus"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAppAssessments } from "~/db/queries/applications.server"
import { findLinkCandidates, getApplicationDetail, linkApplication, unlinkApplication } from "~/db/queries/nais.server"
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

	const [detail, assessmentsResult, candidates] = await Promise.all([
		getApplicationDetail(appId),
		getAppAssessments(appId),
		findLinkCandidates(),
	])

	if (!detail) throw new Response("Applikasjon ikke funnet", { status: 404 })

	// Find candidates that include this app
	const relevantCandidates = candidates
		.filter((c) => c.apps.some((a) => a.id === appId))
		.flatMap((c) => c.apps.filter((a) => a.id !== appId && !a.alreadyLinked))

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
		linkSuggestions: relevantCandidates,
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

export async function action({ params, request }: ActionFunctionArgs) {
	const appId = params.appId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })

	const formData = await request.formData()
	const intent = formData.get("intent") as string
	const performer = "system"

	if (intent === "link") {
		const linkedId = formData.get("linkedId") as string
		if (!linkedId) throw new Response("Mangler linkedId", { status: 400 })
		await linkApplication(linkedId, appId, performer)
	} else if (intent === "unlink") {
		const unlinkId = formData.get("unlinkId") as string
		if (!unlinkId) throw new Response("Mangler unlinkId", { status: 400 })
		await unlinkApplication(unlinkId, performer)
	}

	return redirect(`/applikasjoner/${appId}/detaljer`)
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
		linkSuggestions,
		compliance,
		assessments,
	} = useLoaderData<typeof loader>()

	const isOnPrem = environments.some((e) => e.cluster?.includes("-fss"))

	return (
		<VStack gap="space-16">
			<div>
				<Heading size="xlarge" level="2">
					{app.name}
				</Heading>
				{app.description && <BodyLong>{app.description}</BodyLong>}
			</div>

			{/* Primary app notice */}
			{primaryApp && (
				<Alert variant="info" size="small">
					Denne applikasjonen er lenket til primærapplikasjonen{" "}
					<Link to={`/applikasjoner/${primaryApp.id}/detaljer`}>{primaryApp.name}</Link>. Compliance-vurderinger arves
					fra primærapplikasjonen.
				</Alert>
			)}

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
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
								<Table.HeaderCell scope="col" />
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{linkedApps.map((la) => (
								<Table.Row key={la.id}>
									<Table.DataCell>
										<Link to={`/applikasjoner/${la.id}/detaljer`}>{la.name}</Link>
									</Table.DataCell>
									<Table.DataCell>
										<Form method="post">
											<input type="hidden" name="intent" value="unlink" />
											<input type="hidden" name="unlinkId" value={la.id} />
											<Button variant="tertiary-neutral" size="xsmall" type="submit">
												Fjern kobling
											</Button>
										</Form>
									</Table.DataCell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				</Box>
			)}

			{/* Link suggestions */}
			{!primaryApp && linkSuggestions.length > 0 && (
				<Box>
					<Heading size="medium" level="3" spacing>
						Foreslåtte koblinger
					</Heading>
					<BodyLong spacing>
						Disse applikasjonene bruker samme Docker image og kan være testdeploymenter av denne applikasjonen.
					</BodyLong>
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
								<Table.HeaderCell scope="col">Miljø</Table.HeaderCell>
								<Table.HeaderCell scope="col" />
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{linkSuggestions.map((s) => (
								<Table.Row key={s.id}>
									<Table.DataCell>
										<Link to={`/applikasjoner/${s.id}/detaljer`}>{s.name}</Link>
									</Table.DataCell>
									<Table.DataCell>
										<Tag variant={s.isProd ? "success" : "neutral"} size="xsmall">
											{s.cluster}
										</Tag>
									</Table.DataCell>
									<Table.DataCell>
										<Form method="post">
											<input type="hidden" name="intent" value="link" />
											<input type="hidden" name="linkedId" value={s.id} />
											<Button variant="tertiary" size="xsmall" type="submit">
												Koble hit
											</Button>
										</Form>
									</Table.DataCell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
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

			{/* Compliance summary */}
			<Box>
				<Heading size="medium" level="3" spacing>
					Compliance
				</Heading>
				<HStack gap="space-6" wrap>
					<VStack gap="space-1">
						<Label size="small">Total</Label>
						<Heading size="large" level="4">
							<Tag variant={compliance.percent >= 80 ? "success" : compliance.percent >= 50 ? "warning" : "error"}>
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
				<div style={{ marginTop: "var(--ax-space-4)" }}>
					<Link to={`/applikasjoner/${app.id}/compliance`}>Gå til compliance-vurdering →</Link>
				</div>
			</Box>

			{/* Controls needing attention */}
			{compliance.notAssessed + compliance.notImplemented > 0 && (
				<Box>
					<Heading size="medium" level="3" spacing>
						Kontroller som trenger oppfølging
					</Heading>
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
							{assessments
								.filter((a) => !a.status || a.status === "not_implemented" || a.status === "partially_implemented")
								.map((a) => (
									<Table.Row key={a.controlUuid}>
										<Table.DataCell>{a.domainName}</Table.DataCell>
										<Table.DataCell>{a.controlId}</Table.DataCell>
										<Table.DataCell>{a.controlName}</Table.DataCell>
										<Table.DataCell>
											{a.status ? (
												<ComplianceStatusBadge status={a.status as ComplianceStatusValue} />
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
				</Box>
			)}

			{/* Auth integrations */}
			{authIntegrations.length > 0 && (
				<Box>
					<Heading size="medium" level="3" spacing>
						Autentisering og autorisasjon
					</Heading>
					<VStack gap="space-4">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Integrasjon</Table.HeaderCell>
									<Table.HeaderCell scope="col">Status</Table.HeaderCell>
									<Table.HeaderCell scope="col">Login proxy</Table.HeaderCell>
									<Table.HeaderCell scope="col">Tilgang</Table.HeaderCell>
									<Table.HeaderCell scope="col">Claims</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{authIntegrations.map((auth) => {
									const claimsExtra = auth.claimsExtra ? (JSON.parse(auth.claimsExtra) as string[]) : null
									const supportsProxy = auth.type === "entra_id" || auth.type === "id_porten"
									return (
										<Table.Row key={auth.id}>
											<Table.DataCell>{authLabels[auth.type] ?? auth.type}</Table.DataCell>
											<Table.DataCell>
												<Tag variant="success" size="xsmall">
													Aktivert
												</Tag>
											</Table.DataCell>
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
													auth.allowAllUsers !== null ? (
														<Tag variant={auth.allowAllUsers ? "warning" : "info"} size="xsmall">
															{auth.allowAllUsers ? "Alle brukere" : "Gruppebasert"}
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

						{/* Entra ID groups — separate full-width section */}
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
													<Table.HeaderCell scope="col" style={{ width: "1px" }} />
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
					</VStack>
				</Box>
			)}

			{/* Environments */}
			<Box>
				<Heading size="medium" level="3" spacing>
					Miljøer
				</Heading>
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
										style={{ wordBreak: "break-all", maxWidth: "300px", fontSize: "var(--ax-font-size-small)" }}
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
			</Box>

			{/* Persistence */}
			<Box>
				<Heading size="medium" level="3" spacing>
					Persistens
				</Heading>
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
												<a href={p.auditLogUrl} target="_blank" rel="noopener noreferrer" className="aksel-link">
													<Tag variant="success" size="xsmall">
														Ja – se logg
													</Tag>
												</a>
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
			</Box>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
