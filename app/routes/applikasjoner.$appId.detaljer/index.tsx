import { DownloadIcon, ExternalLinkIcon, EyeIcon, XMarkOctagonIcon } from "@navikt/aksel-icons"
import {
	Link as AkselLink,
	Alert,
	BodyLong,
	BodyShort,
	Box,
	Button,
	Checkbox,
	CheckboxGroup,
	CopyButton,
	Detail,
	Heading,
	HStack,
	Label,
	Modal,
	ReadMore,
	Table,
	Tabs,
	Tag,
	Textarea,
	VStack,
} from "@navikt/ds-react"
import { useRef, useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import {
	data,
	Link,
	redirect,
	useActionData,
	useLoaderData,
	useNavigation,
	useSearchParams,
	useSubmit,
} from "react-router"
import { ComplianceStatusBadge } from "~/components/ComplianceStatus"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAppAssessments } from "~/db/queries/applications.server"
import { getOracleInstancesForApp, getSnapshotHistory } from "~/db/queries/audit-evidence.server"
import {
	acknowledgeUnknownApp,
	getActiveAcknowledgments,
	getApplicationDetail,
	resolveAppNames,
	revokeAcknowledgment,
} from "~/db/queries/nais.server"
import { generateAppComplianceReport, getReportsForApp } from "~/db/queries/reports.server"
import { createReview, getReviewsForApp, getRoutineDeadlinesForApp } from "~/db/queries/routines.server"
import { getSections } from "~/db/queries/sections.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { isAdmin } from "~/lib/authorization.server"
import type { ComplianceStatus } from "~/lib/compliance-status"
import type { AuditEvidenceSummary } from "~/lib/oracle-revisjon.server"
import { getAuditEvidenceSummary, getOracleInstances } from "~/lib/oracle-revisjon.server"
import { getFrequencyLabel } from "~/lib/routine-frequencies"
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

const conclusionConfig: Record<string, { label: string; variant: "success" | "warning" | "error" | "neutral" }> = {
	FULLSTENDIG: { label: "Fullstendig", variant: "success" },
	MANGELFULL: { label: "Mangelfull", variant: "warning" },
	AV: { label: "Av", variant: "error" },
	UKJENT: { label: "Ukjent", variant: "neutral" },
}

const findingSeverityVariant: Record<string, "error" | "warning" | "info"> = {
	KRITISK: "error",
	ADVARSEL: "warning",
	INFO: "info",
}

export async function loader({ request, params }: LoaderFunctionArgs) {
	const appId = params.appId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })

	const user = await getAuthenticatedUser(request)

	const [detail, assessmentsResult] = await Promise.all([getApplicationDetail(appId), getAppAssessments(appId)])

	if (!detail) throw new Response("Applikasjon ikke funnet", { status: 404 })

	const { getApplicationElements } = await import("~/db/queries/technology-elements.server")
	const [appElements, routineDeadlines, completedReviews, allSections, appReports] = await Promise.all([
		getApplicationElements(appId),
		getRoutineDeadlinesForApp(appId),
		getReviewsForApp(appId),
		getSections(),
		getReportsForApp(appId),
	])

	// Build section ID → slug lookup for routine links
	const sectionSlugMap = Object.fromEntries(allSections.map((s) => [s.id, s.slug]))

	const assessments = assessmentsResult?.assessments ?? []
	const totalControls = assessments.length
	const implemented = assessments.filter((a) => a.status === "implemented").length
	const partial = assessments.filter((a) => a.status === "partially_implemented").length
	const notImplemented = assessments.filter((a) => a.status === "not_implemented").length
	const notRelevant = assessments.filter((a) => a.status === "not_relevant").length
	const notAssessed = assessments.filter((a) => !a.status).length

	// Collect all referenced app names from auth inbound rules and access policy rules
	const referencedAppNames = new Set<string>()
	for (const auth of detail.authIntegrations) {
		if (auth.inboundRules) {
			const rules = JSON.parse(auth.inboundRules) as Array<{ application: string }>
			for (const r of rules) referencedAppNames.add(r.application)
		}
	}
	for (const rule of detail.accessPolicyRules) {
		referencedAppNames.add(rule.ruleApplication)
	}
	const knownApps = await resolveAppNames([...referencedAppNames])

	const acknowledgmentsRaw = await getActiveAcknowledgments(appId)
	const acknowledgments: Record<string, { comment: string; acknowledgedBy: string; acknowledgedAt: string }> = {}
	for (const ack of acknowledgmentsRaw) {
		acknowledgments[ack.ruleApplication] = {
			comment: ack.comment,
			acknowledgedBy: ack.acknowledgedBy,
			acknowledgedAt: ack.acknowledgedAt.toISOString(),
		}
	}

	const oracleInstances = await getOracleInstancesForApp(appId)

	// Fetch full snapshot history for configured instances
	const snapshotHistoryPromises = oracleInstances.map(async (inst) => {
		const history = await getSnapshotHistory(appId, inst.instanceId)
		return { instanceId: inst.instanceId, history }
	})
	const instanceSnapshotHistories = await Promise.all(snapshotHistoryPromises)

	// Fetch audit evidence summaries for Oracle persistence entries
	const oraclePersistence = detail.persistence.filter((p) => p.type === "oracle")
	const allOracleInstances = oraclePersistence.length > 0 ? await getOracleInstances() : []
	const knownInstanceIds = new Set(allOracleInstances.map((i) => i.id))

	const summaryResults = await Promise.allSettled(
		oraclePersistence
			.filter((p) => knownInstanceIds.has(p.name))
			.map(async (p) => {
				const summary = await getAuditEvidenceSummary(p.name)
				return { persistenceId: p.id, summary }
			}),
	)

	const oracleAuditSummaries: Record<string, AuditEvidenceSummary> = {}
	for (const result of summaryResults) {
		if (result.status === "fulfilled" && result.value.summary) {
			oracleAuditSummaries[result.value.persistenceId] = result.value.summary
		}
	}

	return data({
		app: detail.app,
		environments: detail.environments,
		persistence: detail.persistence,
		oracleAuditSummaries,
		authIntegrations: detail.authIntegrations,
		accessPolicyRules: detail.accessPolicyRules,
		teams: detail.teams,
		primaryApp: detail.primaryApp,
		linkedApps: detail.linkedApps,
		appElements,
		routineDeadlines,
		completedReviews,
		sectionSlugMap,
		canAdmin: user ? isAdmin(user) : false,
		knownApps,
		acknowledgments,
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
		appReports: appReports.map((r) => ({
			id: r.id,
			name: r.name,
			createdAt: r.createdAt.toISOString(),
			createdBy: r.createdBy,
			reportBucketPath: r.reportBucketPath,
		})),
		oracleInstances: oracleInstances.map((inst) => ({
			...inst,
			configuredAt: inst.configuredAt.toISOString(),
			latestSnapshot: inst.latestSnapshot
				? {
						...inst.latestSnapshot,
						fetchedAt: inst.latestSnapshot.fetchedAt.toISOString(),
					}
				: null,
		})),
		instanceSnapshotHistories: instanceSnapshotHistories.map(({ instanceId, history }) => ({
			instanceId,
			snapshots: history.map((s) => ({
				id: s.id,
				overallStatus: s.overallStatus,
				collectedAt: s.collectedAt.toISOString(),
				fetchedAt: s.fetchedAt.toISOString(),
				fetchedBy: s.fetchedBy,
			})),
		})),
	})
}

export async function action({ request, params }: ActionFunctionArgs) {
	const appId = params.appId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })

	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)

	const formData = await request.formData()
	const intent = formData.get("intent")

	if (intent === "create-draft") {
		const routineId = formData.get("routineId") as string
		const sectionSlug = formData.get("sectionSlug") as string
		if (!routineId || !sectionSlug) {
			return data({ success: false, message: null, error: "Mangler rutine-ID" })
		}
		const { getRoutine } = await import("~/db/queries/routines.server")
		const routine = await getRoutine(routineId)
		if (!routine) {
			return data({ success: false, message: null, error: "Fant ikke rutine" })
		}
		const now = new Date()
		const title = `${routine.name} — ${now.toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" })}`
		const review = await createReview({
			routineId,
			applicationId: appId,
			title,
			summary: null,
			routineSnapshotPath: null,
			reviewedAt: now,
			createdBy: authedUser.navIdent,
			participants: [],
		})
		return redirect(`/seksjoner/${sectionSlug}/rutiner/${routineId}/gjennomgang/${review.id}`)
	}

	if (intent === "generate-report") {
		const includeReviews = formData.get("includeReviews") === "true"
		const includeAttachments = formData.get("includeAttachments") === "true"
		const includeRoutineDescription = formData.get("includeRoutineDescription") === "true"
		const reviewIdsRaw = formData.get("reviewIds")
		const reviewIds = reviewIdsRaw != null ? String(reviewIdsRaw).split(",").filter(Boolean) : undefined
		try {
			await generateAppComplianceReport({
				applicationId: appId,
				createdBy: authedUser.navIdent,
				includeReviews,
				includeAttachments,
				includeRoutineDescription,
				reviewIds: includeReviews ? reviewIds : undefined,
			})
			return data({ success: true, message: "Rapport generert.", error: null })
		} catch (err) {
			return data({
				success: false,
				message: null,
				error: err instanceof Error ? err.message : "Feil ved generering av rapport.",
			})
		}
	}

	if (intent === "acknowledge-app") {
		const ruleApplication = formData.get("ruleApplication") as string
		const comment = (formData.get("comment") as string)?.trim()
		if (!ruleApplication) throw new Response("Mangler applikasjonsnavn", { status: 400 })
		if (!comment) return data({ success: false, message: null, error: "Kommentar er obligatorisk" })
		await acknowledgeUnknownApp(appId, ruleApplication, comment, authedUser.navIdent)
		return data({ success: true, message: `${ruleApplication} er kvittert ut.`, error: null })
	}

	if (intent === "revoke-acknowledgment") {
		const ruleApplication = formData.get("ruleApplication") as string
		if (!ruleApplication) throw new Response("Mangler applikasjonsnavn", { status: 400 })
		await revokeAcknowledgment(appId, ruleApplication, authedUser.navIdent)
		return data({ success: true, message: `Kvittering for ${ruleApplication} er trukket tilbake.`, error: null })
	}

	return data({ success: false, message: null, error: "Ukjent handling" })
}

export default function ApplikasjonDetalj() {
	const {
		app,
		environments,
		persistence,
		oracleAuditSummaries,
		authIntegrations,
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
		instanceSnapshotHistories,
	} = useLoaderData<typeof loader>()

	const [searchParams, setSearchParams] = useSearchParams()
	const activeTab = searchParams.get("fane") ?? "oversikt"
	const submit = useSubmit()

	const [ackTarget, setAckTarget] = useState<string | null>(null)
	const [ackComment, setAckComment] = useState("")
	const ackModalRef = useRef<HTMLDialogElement>(null)

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
					{canAdmin && (
						<Button as={Link} to={`/applikasjoner/${app.id}/rediger`} variant="tertiary" size="small">
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
					<Tabs.Tab value="tilgangspolicy" label="Tilgangspolicy" />
					<Tabs.Tab value="miljoer" label="Miljøer" />
					<Tabs.Tab value="persistering" label="Persistering" />
					{oracleInstances.length > 0 && <Tabs.Tab value="revisjonsbevis" label="Revisjonsbevis" />}
					<Tabs.Tab value="rutiner" label="Rutiner" />
					<Tabs.Tab value="rapporter" label="Rapporter" />
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
									const groups = JSON.parse(auth.groups ?? "[]") as string[]
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
						</VStack>
					) : (
						<BodyLong>Ingen autentiseringsintegrasjoner funnet.</BodyLong>
					)}
				</Tabs.Panel>

				{/* Tilgangspolicy */}
				<Tabs.Panel value="tilgangspolicy" style={{ paddingTop: "var(--ax-space-6)" }}>
					<VStack gap="space-4">
						<Alert variant="info" size="small">
							Tilgangspolicyen definerer hvilke applikasjoner som har nettverkstilgang til å kalle denne applikasjonen,
							og som kan utstede tokens via TokenX eller Entra ID. Policyen hentes automatisk fra{" "}
							<code>spec.accessPolicy.inbound.rules</code> i Nais-manifestet.
						</Alert>

						{(() => {
							const inboundRules = accessPolicyRules.filter((r) => r.direction === "inbound")
							if (inboundRules.length === 0) {
								return (
									<BodyLong>
										Ingen tilgangspolicyregler funnet. Applikasjonen har enten ikke definert{" "}
										<code>accessPolicy.inbound.rules</code> i sitt Nais-manifest, eller den har ikke blitt synkronisert
										ennå.
									</BodyLong>
								)
							}
							return (
								<VStack gap="space-2">
									<Heading size="xsmall" level="4">
										Innkommende tilgang ({inboundRules.length}{" "}
										{inboundRules.length === 1 ? "applikasjon" : "applikasjoner"})
									</Heading>
									<BodyShort size="small" textColor="subtle">
										Disse applikasjonene har tillatelse til å kalle dette API-et over nettverket.
									</BodyShort>
									<Table size="small">
										<Table.Header>
											<Table.Row>
												<Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
												<Table.HeaderCell scope="col">Namespace</Table.HeaderCell>
												<Table.HeaderCell scope="col">Kluster</Table.HeaderCell>
												<Table.HeaderCell scope="col">Status</Table.HeaderCell>
												<Table.HeaderCell scope="col">Handling</Table.HeaderCell>
											</Table.Row>
										</Table.Header>
										<Table.Body>
											{inboundRules.map((rule) => {
												const resolution = knownApps[rule.ruleApplication]
												const ack = acknowledgments[rule.ruleApplication]
												const isUnknown = !resolution || resolution.status === "unknown"
												return (
													<Table.Row key={rule.id}>
														<Table.DataCell>
															{resolution?.status === "monitored" ? (
																<Link to={`/applikasjoner/${resolution.appId}/detaljer`}>
																	<code style={{ fontSize: "var(--ax-font-size-sm)" }}>{rule.ruleApplication}</code>
																</Link>
															) : (
																<code style={{ fontSize: "var(--ax-font-size-sm)" }}>{rule.ruleApplication}</code>
															)}
														</Table.DataCell>
														<Table.DataCell>
															{rule.ruleNamespace ? (
																<code style={{ fontSize: "var(--ax-font-size-sm)" }}>{rule.ruleNamespace}</code>
															) : (
																<BodyShort size="small" textColor="subtle">
																	Samme
																</BodyShort>
															)}
														</Table.DataCell>
														<Table.DataCell>
															{rule.ruleCluster ? (
																<code style={{ fontSize: "var(--ax-font-size-sm)" }}>{rule.ruleCluster}</code>
															) : (
																<BodyShort size="small" textColor="subtle">
																	Samme
																</BodyShort>
															)}
														</Table.DataCell>
														<Table.DataCell>
															{resolution?.status === "monitored" ? (
																<Tag variant="success" size="xsmall">
																	Overvåket
																</Tag>
															) : resolution?.status === "discovered" ? (
																<Tag variant="info" size="xsmall">
																	Nais
																</Tag>
															) : ack ? (
																<VStack gap="space-1">
																	<HStack gap="space-2" align="center">
																		<Tag variant="neutral" size="xsmall">
																			Kvittert
																		</Tag>
																	</HStack>
																	<BodyShort size="small" textColor="subtle">
																		{ack.comment}
																	</BodyShort>
																	<Detail textColor="subtle">
																		{ack.acknowledgedBy}, {new Date(ack.acknowledgedAt).toLocaleDateString("nb-NO")}
																	</Detail>
																</VStack>
															) : (
																<HStack gap="space-1" align="center">
																	<XMarkOctagonIcon
																		aria-hidden
																		fontSize="1rem"
																		style={{ color: "var(--ax-text-warning)" }}
																	/>
																	<Tag variant="warning" size="xsmall">
																		Ukjent
																	</Tag>
																</HStack>
															)}
														</Table.DataCell>
														<Table.DataCell>
															{isUnknown &&
																(ack ? (
																	<Button
																		variant="tertiary-neutral"
																		size="xsmall"
																		onClick={() =>
																			submit(
																				{
																					intent: "revoke-acknowledgment",
																					ruleApplication: rule.ruleApplication,
																				},
																				{ method: "POST" },
																			)
																		}
																	>
																		Trekk tilbake
																	</Button>
																) : (
																	<Button
																		variant="tertiary"
																		size="xsmall"
																		onClick={() => {
																			setAckTarget(rule.ruleApplication)
																			setAckComment("")
																			ackModalRef.current?.showModal()
																		}}
																	>
																		Kvitter ut
																	</Button>
																))}
														</Table.DataCell>
													</Table.Row>
												)
											})}
										</Table.Body>
									</Table>
								</VStack>
							)
						})()}

						<Modal ref={ackModalRef} header={{ heading: `Kvitter ut ${ackTarget}` }} onClose={() => setAckTarget(null)}>
							<Modal.Body>
								<Textarea
									label="Kommentar (obligatorisk)"
									description="Beskriv hvorfor denne applikasjonen er reell selv om den er ukjent i KISS"
									value={ackComment}
									onChange={(e) => setAckComment(e.target.value)}
									minRows={3}
								/>
							</Modal.Body>
							<Modal.Footer>
								<Button
									onClick={() => {
										if (!ackTarget || !ackComment.trim()) return
										submit(
											{ intent: "acknowledge-app", ruleApplication: ackTarget, comment: ackComment },
											{ method: "POST" },
										)
										ackModalRef.current?.close()
										setAckTarget(null)
										setAckComment("")
									}}
									disabled={!ackComment.trim()}
								>
									Bekreft
								</Button>
								<Button
									variant="secondary"
									onClick={() => {
										ackModalRef.current?.close()
										setAckTarget(null)
										setAckComment("")
									}}
								>
									Avbryt
								</Button>
							</Modal.Footer>
						</Modal>
					</VStack>
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
											{p.type === "oracle" && oracleAuditSummaries[p.id] ? (
												<VStack gap="space-2">
													<Tag
														variant={conclusionConfig[oracleAuditSummaries[p.id].conclusion]?.variant ?? "neutral"}
														size="xsmall"
													>
														{conclusionConfig[oracleAuditSummaries[p.id].conclusion]?.label ??
															oracleAuditSummaries[p.id].conclusion}
													</Tag>
													<Detail style={{ color: "var(--ax-text-subtle)" }}>
														{oracleAuditSummaries[p.id].reason}
													</Detail>
													{oracleAuditSummaries[p.id].findings.length > 0 && (
														<ReadMore header="Funn" size="small" defaultOpen={false}>
															<VStack gap="space-2">
																{oracleAuditSummaries[p.id].findings.map((f, i) => (
																	// biome-ignore lint/suspicious/noArrayIndexKey: static findings list
																	<HStack key={i} gap="space-2" align="center" wrap>
																		<Tag variant={findingSeverityVariant[f.severity] ?? "info"} size="xsmall">
																			{f.severity}
																		</Tag>
																		<Detail>{f.message}</Detail>
																	</HStack>
																))}
															</VStack>
														</ReadMore>
													)}
												</VStack>
											) : p.auditLogging === true ? (
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

				{/* Revisjonsbevis */}
				{oracleInstances.length > 0 && (
					<Tabs.Panel value="revisjonsbevis" style={{ paddingTop: "var(--ax-space-6)" }}>
						<VStack gap="space-12">
							{instanceSnapshotHistories.map(({ instanceId, snapshots }) => (
								<Box key={instanceId} borderWidth="1" borderColor="neutral-subtle" padding="space-8" borderRadius="8">
									<VStack gap="space-6">
										<Heading size="small" level="3">
											{instanceId.toUpperCase()}
										</Heading>
										{snapshots.length > 0 ? (
											// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1
											<section className="table-scroll" tabIndex={0} aria-label={`Revisjonsbevis for ${instanceId}`}>
												<Table size="small">
													<Table.Header>
														<Table.Row>
															<Table.HeaderCell scope="col">Status</Table.HeaderCell>
															<Table.HeaderCell scope="col">Innsamlet</Table.HeaderCell>
															<Table.HeaderCell scope="col">Hentet</Table.HeaderCell>
															<Table.HeaderCell scope="col">Hentet av</Table.HeaderCell>
															<Table.HeaderCell scope="col" />
														</Table.Row>
													</Table.Header>
													<Table.Body>
														{snapshots.map((s) => (
															<Table.Row key={s.id}>
																<Table.DataCell>
																	<Tag
																		variant={
																			s.overallStatus === "OK"
																				? "success"
																				: s.overallStatus === "PARTIAL"
																					? "warning"
																					: "error"
																		}
																		size="xsmall"
																	>
																		{s.overallStatus}
																	</Tag>
																</Table.DataCell>
																<Table.DataCell>{new Date(s.collectedAt).toLocaleString("nb-NO")}</Table.DataCell>
																<Table.DataCell>{new Date(s.fetchedAt).toLocaleString("nb-NO")}</Table.DataCell>
																<Table.DataCell>{s.fetchedBy}</Table.DataCell>
																<Table.DataCell>
																	<a href={`/api/revisjonsbevis/${s.id}/excel`}>
																		<Button
																			variant="tertiary"
																			size="xsmall"
																			as="span"
																			icon={<DownloadIcon aria-hidden />}
																		>
																			Excel
																		</Button>
																	</a>
																</Table.DataCell>
															</Table.Row>
														))}
													</Table.Body>
												</Table>
											</section>
										) : (
											<BodyShort>Ingen revisjonsbevis er hentet ennå.</BodyShort>
										)}
									</VStack>
								</Box>
							))}
						</VStack>
					</Tabs.Panel>
				)}

				{/* Rutiner */}
				<Tabs.Panel value="rutiner" style={{ paddingTop: "var(--ax-space-6)" }}>
					<VStack gap="space-8">
						{/* Manglende rutiner */}
						<Heading size="medium" level="3">
							Rutinestatus
						</Heading>
						{routineDeadlines.length === 0 ? (
							<BodyShort>Ingen rutiner er knyttet til denne applikasjonen.</BodyShort>
						) : (
							<Table size="small">
								<Table.Header>
									<Table.Row>
										<Table.HeaderCell>Rutine</Table.HeaderCell>
										<Table.HeaderCell>Frekvens</Table.HeaderCell>
										<Table.HeaderCell>Siste gjennomgang</Table.HeaderCell>
										<Table.HeaderCell>Frist</Table.HeaderCell>
										<Table.HeaderCell>Status</Table.HeaderCell>
										<Table.HeaderCell />
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{routineDeadlines.map((dl) => (
										<Table.Row key={dl.routine?.id ?? "unknown"}>
											<Table.DataCell>
												{dl.routine?.sectionId && sectionSlugMap[dl.routine.sectionId] ? (
													<Link to={`/seksjoner/${sectionSlugMap[dl.routine.sectionId]}/rutiner/${dl.routine.id}`}>
														{dl.routine?.name ?? "—"}
													</Link>
												) : (
													(dl.routine?.name ?? "—")
												)}
											</Table.DataCell>
											<Table.DataCell>{getFrequencyLabel(dl.routine?.frequency)}</Table.DataCell>
											<Table.DataCell>
												{dl.lastReviewDate ? new Date(dl.lastReviewDate).toLocaleDateString("nb-NO") : "Aldri"}
											</Table.DataCell>
											<Table.DataCell>{new Date(dl.deadline).toLocaleDateString("nb-NO")}</Table.DataCell>
											<Table.DataCell>
												{dl.overdue ? (
													<Tag variant="error" size="small">
														Over frist
													</Tag>
												) : dl.lastReviewDate ? (
													<Tag variant="success" size="small">
														OK
													</Tag>
												) : (
													<Tag variant="warning" size="small">
														Ikke gjennomført
													</Tag>
												)}
											</Table.DataCell>
											<Table.DataCell>
												{dl.routine?.sectionId && sectionSlugMap[dl.routine.sectionId] && (
													<form method="post" style={{ display: "inline" }}>
														<input type="hidden" name="intent" value="create-draft" />
														<input type="hidden" name="routineId" value={dl.routine.id} />
														<input type="hidden" name="sectionSlug" value={sectionSlugMap[dl.routine.sectionId]} />
														<Button type="submit" variant="tertiary" size="xsmall">
															Ny gjennomgang
														</Button>
													</form>
												)}
											</Table.DataCell>
										</Table.Row>
									))}
								</Table.Body>
							</Table>
						)}

						{/* Gjennomførte rutinegjennomganger */}
						{completedReviews.length > 0 && (
							<>
								<Heading size="medium" level="3">
									Gjennomførte gjennomganger
								</Heading>
								<Table size="small">
									<Table.Header>
										<Table.Row>
											<Table.HeaderCell>Dato</Table.HeaderCell>
											<Table.HeaderCell>Rutine</Table.HeaderCell>
											<Table.HeaderCell>Tittel</Table.HeaderCell>
											<Table.HeaderCell>Status</Table.HeaderCell>
											<Table.HeaderCell>Opprettet av</Table.HeaderCell>
											<Table.HeaderCell>Deltakere</Table.HeaderCell>
										</Table.Row>
									</Table.Header>
									<Table.Body>
										{completedReviews.map((review) => {
											const confirmed = review.participants.filter((p) => p.confirmedAt).length
											const slug = review.sectionId ? sectionSlugMap[review.sectionId] : null
											return (
												<Table.Row key={review.id}>
													<Table.DataCell>{new Date(review.reviewedAt).toLocaleDateString("nb-NO")}</Table.DataCell>
													<Table.DataCell>{review.routineName}</Table.DataCell>
													<Table.DataCell>
														{slug ? (
															<Link to={`/seksjoner/${slug}/rutiner/${review.routineId}/gjennomgang/${review.id}`}>
																{review.title}
															</Link>
														) : (
															review.title
														)}
													</Table.DataCell>
													<Table.DataCell>
														{review.status === "completed" ? (
															<Tag variant="success" size="xsmall">
																Fullført
															</Tag>
														) : (
															<Tag variant="warning" size="xsmall">
																Utkast
															</Tag>
														)}
													</Table.DataCell>
													<Table.DataCell>{review.createdBy}</Table.DataCell>
													<Table.DataCell>
														{review.participants.length} ({confirmed} bekreftet)
													</Table.DataCell>
												</Table.Row>
											)
										})}
									</Table.Body>
								</Table>
							</>
						)}
					</VStack>
				</Tabs.Panel>

				{/* Rapporter */}
				<Tabs.Panel value="rapporter" style={{ paddingTop: "var(--ax-space-6)" }}>
					<ReportsPanel appReports={appReports} completedReviews={completedReviews} />
				</Tabs.Panel>
			</Tabs>
		</VStack>
	)
}

function ReportsPanel({
	appReports,
	completedReviews,
}: {
	appReports: Array<{
		id: string
		name: string
		createdAt: string
		createdBy: string
		reportBucketPath: string | null
	}>
	completedReviews: Array<{
		id: string
		title: string
		routineName: string
		reviewedAt: Date | string
		status: string
		createdBy: string
	}>
}) {
	const submit = useSubmit()
	const navigation = useNavigation()
	const actionData = useActionData<typeof action>()
	const isGenerating = navigation.state === "submitting"
	const [reportOptions, setReportOptions] = useState<string[]>([
		"includeReviews",
		"includeRoutineDescription",
		"includeAttachments",
	])
	const includeReviews = reportOptions.includes("includeReviews")

	const completed = completedReviews.filter((r) => r.status === "completed")
	const [selectedReviewIds, setSelectedReviewIds] = useState<string[]>(() => completed.map((r) => r.id))

	const toggleReview = (reviewId: string) => {
		setSelectedReviewIds((prev) =>
			prev.includes(reviewId) ? prev.filter((id) => id !== reviewId) : [...prev, reviewId],
		)
	}

	const allSelected = completed.length > 0 && selectedReviewIds.length === completed.length
	const toggleAll = () => {
		setSelectedReviewIds(allSelected ? [] : completed.map((r) => r.id))
	}

	return (
		<VStack gap="space-8">
			{/* Generate report section */}
			<Box background="sunken" padding="space-6" borderRadius="8">
				<Heading size="medium" level="3" spacing>
					Generer rapport
				</Heading>
				<VStack gap="space-4">
					<BodyShort>
						Generer en compliance-rapport for denne applikasjonen som PDF. Rapporten lagres og kan lastes ned eller
						vises senere.
					</BodyShort>
					<CheckboxGroup
						legend="Inkluder i rapporten"
						size="small"
						value={reportOptions}
						onChange={(val) => setReportOptions(val)}
					>
						<Checkbox value="includeReviews">Rutinegjennomganger</Checkbox>
						<Checkbox value="includeRoutineDescription">Rutinebeskrivelse (vises på gjennomgangssider)</Checkbox>
						<Checkbox value="includeAttachments">Vedlegg fra gjennomganger (flettes som sider i PDF)</Checkbox>
					</CheckboxGroup>

					{/* Review selection */}
					{includeReviews && completed.length > 0 && (
						<Box padding="space-4" borderWidth="1" borderColor="neutral" borderRadius="8">
							<VStack gap="space-2">
								<HStack justify="space-between" align="center">
									<Label size="small">
										Velg gjennomganger ({selectedReviewIds.length} av {completed.length})
									</Label>
									<Button variant="tertiary" size="xsmall" onClick={toggleAll}>
										{allSelected ? "Fjern alle" : "Velg alle"}
									</Button>
								</HStack>
								<Table size="small">
									<Table.Header>
										<Table.Row>
											<Table.HeaderCell style={{ width: "2rem" }} />
											<Table.HeaderCell>Tittel</Table.HeaderCell>
											<Table.HeaderCell>Rutine</Table.HeaderCell>
											<Table.HeaderCell>Dato</Table.HeaderCell>
											<Table.HeaderCell>Av</Table.HeaderCell>
										</Table.Row>
									</Table.Header>
									<Table.Body>
										{completed.map((review) => (
											<Table.Row key={review.id} onClick={() => toggleReview(review.id)} style={{ cursor: "pointer" }}>
												<Table.DataCell>
													<Checkbox
														size="small"
														hideLabel
														checked={selectedReviewIds.includes(review.id)}
														onChange={() => toggleReview(review.id)}
														onClick={(e) => e.stopPropagation()}
													>
														Velg
													</Checkbox>
												</Table.DataCell>
												<Table.DataCell>{review.title}</Table.DataCell>
												<Table.DataCell>{review.routineName}</Table.DataCell>
												<Table.DataCell>{new Date(review.reviewedAt).toLocaleDateString("nb-NO")}</Table.DataCell>
												<Table.DataCell>{review.createdBy}</Table.DataCell>
											</Table.Row>
										))}
									</Table.Body>
								</Table>
							</VStack>
						</Box>
					)}

					{includeReviews && completed.length === 0 && (
						<BodyShort size="small" textColor="subtle">
							Ingen fullførte gjennomganger tilgjengelig.
						</BodyShort>
					)}

					{actionData?.success && (
						<Alert variant="success" size="small">
							{actionData.message}
						</Alert>
					)}
					{actionData && !actionData.success && actionData.error && (
						<Alert variant="error" size="small">
							{actionData.error}
						</Alert>
					)}
					<div>
						<Button
							type="button"
							variant="primary"
							size="small"
							loading={isGenerating}
							onClick={() => {
								const fd = new FormData()
								fd.set("intent", "generate-report")
								fd.set("includeReviews", String(includeReviews))
								fd.set("includeAttachments", String(reportOptions.includes("includeAttachments")))
								fd.set("includeRoutineDescription", String(reportOptions.includes("includeRoutineDescription")))
								if (includeReviews) {
									fd.set("reviewIds", selectedReviewIds.join(","))
								}
								submit(fd, { method: "post" })
							}}
						>
							Generer compliance-rapport
						</Button>
					</div>
				</VStack>
			</Box>

			{/* Generated reports list */}
			<Box>
				<Heading size="medium" level="3" spacing>
					Genererte rapporter
				</Heading>
				{appReports.length === 0 ? (
					<BodyShort>Ingen rapporter er generert ennå.</BodyShort>
				) : (
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell>Rapport</Table.HeaderCell>
								<Table.HeaderCell>Generert</Table.HeaderCell>
								<Table.HeaderCell>Av</Table.HeaderCell>
								<Table.HeaderCell>Vis</Table.HeaderCell>
								<Table.HeaderCell>Last ned</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{appReports.map((r) => (
								<Table.Row key={r.id}>
									<Table.DataCell>{r.name}</Table.DataCell>
									<Table.DataCell>
										{new Date(r.createdAt).toLocaleString("nb-NO", {
											day: "numeric",
											month: "short",
											year: "numeric",
											hour: "2-digit",
											minute: "2-digit",
										})}
									</Table.DataCell>
									<Table.DataCell>{r.createdBy}</Table.DataCell>
									<Table.DataCell>
										{r.reportBucketPath && (
											<Button
												as="a"
												href={`/api/rapporter/${r.id}/pdf`}
												target="_blank"
												rel="noopener noreferrer"
												variant="tertiary"
												size="xsmall"
												icon={<EyeIcon aria-hidden />}
											>
												Vis
											</Button>
										)}
									</Table.DataCell>
									<Table.DataCell>
										{r.reportBucketPath && (
											<Button
												as="a"
												href={`/api/rapporter/${r.id}/pdf?download=true`}
												variant="tertiary"
												size="xsmall"
												icon={<DownloadIcon aria-hidden />}
											>
												Last ned
											</Button>
										)}
									</Table.DataCell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				)}
			</Box>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
