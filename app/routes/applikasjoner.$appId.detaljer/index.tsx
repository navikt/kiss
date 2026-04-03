import { CheckmarkIcon, DownloadIcon, XMarkIcon } from "@navikt/aksel-icons"
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
	Select,
	Table,
	Tag,
	Textarea,
	VStack,
} from "@navikt/ds-react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, redirect, useLoaderData } from "react-router"
import type { ComplianceStatusValue } from "~/components/ComplianceStatus"
import { ComplianceStatusBadge } from "~/components/ComplianceStatus"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import {
	getAppAssessments,
	getAvailableTeamsForApp,
	linkAppToTeam,
	unlinkAppFromTeam,
} from "~/db/queries/applications.server"
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

	// Get technology elements and available teams
	const { getApplicationElements, getAllTechnologyElements } = await import("~/db/queries/technology-elements.server")
	const [appElements, allElements, availableTeams] = await Promise.all([
		getApplicationElements(appId),
		getAllTechnologyElements(),
		getAvailableTeamsForApp(appId),
	])

	// Find candidates that include this app, deduplicate by app ID
	const relevantCandidates = [
		...new Map(
			candidates
				.filter((c) => c.apps.some((a) => a.id === appId))
				.flatMap((c) => c.apps.filter((a) => a.id !== appId && !a.alreadyLinked))
				.map((a) => [a.id, a]),
		).values(),
	]

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
		appElements,
		availableElements: allElements.filter((e) => !appElements.some((ae) => ae.id === e.id)),
		availableTeams,
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
	} else if (intent === "addElement") {
		const elementId = formData.get("elementId") as string
		if (!elementId) throw new Response("Mangler elementId", { status: 400 })
		const { addApplicationElement } = await import("~/db/queries/technology-elements.server")
		await addApplicationElement(appId, elementId)
	} else if (intent === "removeElement") {
		const elementId = formData.get("elementId") as string
		if (!elementId) throw new Response("Mangler elementId", { status: 400 })
		const { removeApplicationElement } = await import("~/db/queries/technology-elements.server")
		await removeApplicationElement(appId, elementId)
	} else if (intent === "confirmElement") {
		const linkId = formData.get("linkId") as string
		if (!linkId) throw new Response("Mangler linkId", { status: 400 })
		const { confirmApplicationElement } = await import("~/db/queries/technology-elements.server")
		await confirmApplicationElement(linkId, performer)
	} else if (intent === "rejectElement") {
		const linkId = formData.get("linkId") as string
		const reason = (formData.get("reason") as string)?.trim()
		if (!linkId) throw new Response("Mangler linkId", { status: 400 })
		if (!reason) throw new Response("Begrunnelse er påkrevd", { status: 400 })
		const { rejectApplicationElement } = await import("~/db/queries/technology-elements.server")
		await rejectApplicationElement(linkId, reason, performer)
	} else if (intent === "link-team") {
		const devTeamId = formData.get("devTeamId") as string
		if (!devTeamId) throw new Response("Mangler devTeamId", { status: 400 })
		await linkAppToTeam(appId, devTeamId, performer)
	} else if (intent === "unlink-team") {
		const devTeamId = formData.get("devTeamId") as string
		if (!devTeamId) throw new Response("Mangler devTeamId", { status: 400 })
		await unlinkAppFromTeam(appId, devTeamId, performer)
	}

	return redirect(`/applikasjoner/${appId}/detaljer`)
}

type AppElement = {
	id: string
	name: string
	slug: string
	source: string
	linkId: string
	confirmedAt: Date | string | null
	confirmedBy: string | null
	rejectedAt: Date | string | null
	rejectedBy: string | null
	rejectionReason: string | null
}

function TechnologyElementRow({ element: el }: { element: AppElement }) {
	const [rejecting, setRejecting] = useState(false)

	const isAuto = el.source === "auto"
	const isConfirmed = !!el.confirmedAt
	const isRejected = !!el.rejectedAt
	const isPending = isAuto && !isConfirmed && !isRejected

	const variant = isRejected ? "neutral" : isConfirmed ? "success" : isPending ? "warning" : "alt1"

	return (
		<Box
			borderWidth="1"
			borderColor={isRejected ? "danger-subtle" : isPending ? "warning-subtle" : "neutral-subtle"}
			padding="space-8"
			borderRadius="8"
		>
			<VStack gap="space-4">
				<HStack gap="space-4" align="center" wrap>
					<Tag variant={variant} size="small">
						{el.name}
					</Tag>
					{isAuto && (
						<Tag variant="neutral" size="xsmall">
							Automatisk oppdaget
						</Tag>
					)}
					{isConfirmed && (
						<Tag variant="success" size="xsmall">
							Bekreftet{el.confirmedBy ? ` av ${el.confirmedBy}` : ""}
						</Tag>
					)}
					{isRejected && (
						<Tag variant="error" size="xsmall">
							Avvist{el.rejectedBy ? ` av ${el.rejectedBy}` : ""}
						</Tag>
					)}
					{!isAuto && (
						<Tag variant="info" size="xsmall">
							Manuelt lagt til
						</Tag>
					)}
				</HStack>

				{isRejected && el.rejectionReason && (
					<BodyShort size="small" style={{ color: "var(--ax-text-subtle)" }}>
						Begrunnelse: {el.rejectionReason}
					</BodyShort>
				)}

				<HStack gap="space-2" align="center">
					{isPending && (
						<>
							<Form method="post" style={{ display: "inline" }}>
								<input type="hidden" name="intent" value="confirmElement" />
								<input type="hidden" name="linkId" value={el.linkId} />
								<Button variant="primary" size="xsmall" type="submit" icon={<CheckmarkIcon aria-hidden />}>
									Bekreft
								</Button>
							</Form>
							<Button
								variant="danger"
								size="xsmall"
								onClick={() => setRejecting(true)}
								icon={<XMarkIcon aria-hidden />}
							>
								Avvis
							</Button>
						</>
					)}
					{isRejected && (
						<Form method="post" style={{ display: "inline" }}>
							<input type="hidden" name="intent" value="confirmElement" />
							<input type="hidden" name="linkId" value={el.linkId} />
							<Button variant="secondary" size="xsmall" type="submit">
								Angre avvisning og bekreft
							</Button>
						</Form>
					)}
					{isConfirmed && isAuto && (
						<Button variant="tertiary" size="xsmall" onClick={() => setRejecting(true)}>
							Avvis likevel
						</Button>
					)}
					<Form method="post" style={{ display: "inline" }}>
						<input type="hidden" name="intent" value="removeElement" />
						<input type="hidden" name="elementId" value={el.id} />
						<Button variant="tertiary-neutral" size="xsmall" type="submit">
							Fjern
						</Button>
					</Form>
				</HStack>

				{rejecting && (
					<Form method="post">
						<input type="hidden" name="intent" value="rejectElement" />
						<input type="hidden" name="linkId" value={el.linkId} />
						<VStack gap="space-4">
							<Textarea label="Begrunnelse for avvisning" name="reason" size="small" minRows={2} autoFocus />
							<HStack gap="space-2">
								<Button variant="danger" size="xsmall" type="submit">
									Avvis
								</Button>
								<Button variant="tertiary" size="xsmall" type="button" onClick={() => setRejecting(false)}>
									Avbryt
								</Button>
							</HStack>
						</VStack>
					</Form>
				)}
			</VStack>
		</Box>
	)
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
		appElements,
		availableElements,
		availableTeams,
		compliance,
		assessments,
	} = useLoaderData<typeof loader>()

	const isOnPrem = environments.some((e) => e.cluster?.includes("-fss"))

	const gitHubUrl = environments.find((e) => e.gitRepository)?.gitRepository ?? `https://github.com/navikt/${app.name}`

	return (
		<VStack gap="space-24">
			<div>
				<Heading size="xlarge" level="2">
					{app.name}
				</Heading>
				{app.description && <BodyLong>{app.description}</BodyLong>}
				<HStack gap="space-4" align="center" style={{ marginTop: "var(--ax-space-2)" }}>
					<AkselLink href={gitHubUrl} target="_blank" rel="noopener noreferrer">
						GitHub
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
							<Form key={t.teamId} method="post" style={{ display: "inline" }}>
								<input type="hidden" name="intent" value="unlink-team" />
								<input type="hidden" name="devTeamId" value={t.teamId} />
								<Tag variant="info" size="small">
									{t.teamName}
									<Button
										variant="tertiary-neutral"
										size="xsmall"
										type="submit"
										icon={<XMarkIcon aria-hidden />}
										title={`Fjern ${t.teamName}`}
										style={{ marginLeft: "var(--ax-space-2)", marginRight: "calc(-1 * var(--ax-space-2))" }}
									/>
								</Tag>
							</Form>
						))}
					</HStack>
				) : (
					<BodyLong>Ikke tilknyttet noe utviklerteam.</BodyLong>
				)}
				{availableTeams.length > 0 && (
					<Form method="post" style={{ marginTop: "var(--ax-space-8)" }}>
						<input type="hidden" name="intent" value="link-team" />
						<HStack gap="space-2" align="end">
							<Select label="Legg til team" name="devTeamId" size="small">
								{availableTeams.map((t) => (
									<option key={t.id} value={t.id}>
										{t.name}
									</option>
								))}
							</Select>
							<Button variant="secondary" size="small" type="submit">
								Legg til
							</Button>
						</HStack>
					</Form>
				)}
			</Box>

			{/* Technology elements */}
			<Box>
				<Heading size="medium" level="3" spacing>
					Teknologielementer
				</Heading>
				<BodyLong spacing>
					Teknologielementer bestemmer hvilke kontroller som er relevante for denne applikasjonen.
				</BodyLong>
				{appElements.length > 0 ? (
					<VStack gap="space-4">
						{appElements.map((el) => (
							<TechnologyElementRow key={el.id} element={el} />
						))}
					</VStack>
				) : (
					<BodyLong>Ingen teknologielementer er tilordnet.</BodyLong>
				)}
				{availableElements.length > 0 && (
					<VStack gap="space-4">
						<Form method="post">
							<input type="hidden" name="intent" value="addElement" />
							<HStack gap="space-2" align="end">
								<Select label="Legg til element" name="elementId" size="small">
									{availableElements.map((el) => (
										<option key={el.id} value={el.id}>
											{el.name}
										</option>
									))}
								</Select>
								<Button variant="secondary" size="small" type="submit">
									Legg til
								</Button>
							</HStack>
						</Form>
					</VStack>
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
			</Box>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
