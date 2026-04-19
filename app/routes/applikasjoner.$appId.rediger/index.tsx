import { CheckmarkIcon, DownloadIcon, XMarkIcon } from "@navikt/aksel-icons"
import {
	BodyLong,
	BodyShort,
	Box,
	Button,
	Heading,
	HStack,
	Select,
	Table,
	Tag,
	Textarea,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, redirect, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAvailableTeamsForApp, linkAppToTeam, unlinkAppFromTeam } from "~/db/queries/applications.server"
import {
	configureOracleInstance,
	getOracleInstancesForApp,
	removeOracleInstance,
	saveAuditEvidenceSnapshot,
	setIncludeInReport,
} from "~/db/queries/audit-evidence.server"
import {
	deleteApplication,
	findLinkCandidates,
	getApplicationDetail,
	linkApplication,
	promoteToPrimary,
	renameApplication,
	unlinkApplication,
} from "~/db/queries/nais.server"
import {
	addApplicationElement,
	confirmApplicationElement,
	getAllTechnologyElements,
	getApplicationElements,
	rejectApplicationElement,
	removeApplicationElement,
} from "~/db/queries/technology-elements.server"
import { useAppBasePath } from "~/hooks/useAppBasePath"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"
import { filterInstancesByAccess } from "~/lib/oracle-access.server"
import { getAuditEvidence, getAuditEvidenceExcel, getOracleInstances } from "~/lib/oracle-revisjon.server"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const appId = params.appId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })

	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	// Breadcrumb context for team/section-context routes
	const breadcrumbCtx = await (async () => {
		if (params.seksjon && params.team) {
			const { getTeamBreadcrumbContext } = await import("~/lib/breadcrumb-context.server")
			return getTeamBreadcrumbContext(params.seksjon, params.team)
		}
		if (params.seksjon) {
			const { getSectionBreadcrumbContext } = await import("~/lib/breadcrumb-context.server")
			return getSectionBreadcrumbContext(params.seksjon)
		}
		return {}
	})()

	const [detail, candidates, appElements, allElements, availableTeams, oracleInstances, allOracleInstances] =
		await Promise.all([
			getApplicationDetail(appId),
			findLinkCandidates(),
			getApplicationElements(appId),
			getAllTechnologyElements(),
			getAvailableTeamsForApp(appId),
			getOracleInstancesForApp(appId),
			getOracleInstances(),
		])

	if (!detail) throw new Response("Applikasjon ikke funnet", { status: 404 })

	// Filter Oracle instances by user's Azure AD group membership
	const accessibleInstances = filterInstancesByAccess(allOracleInstances, authedUser.groups)
	const accessibleInstanceIds = new Set(accessibleInstances.map((i) => i.id))
	const filteredOracleInstances = oracleInstances.filter((i) => accessibleInstanceIds.has(i.instanceId))

	const relevantCandidates = [
		...new Map(
			candidates
				.filter((c) => c.apps.some((a) => a.id === appId))
				.flatMap((c) => c.apps.filter((a) => a.id !== appId && !a.alreadyLinked))
				.map((a) => [a.id, a]),
		).values(),
	]

	const configuredIds = new Set(filteredOracleInstances.map((i) => i.instanceId))
	const availableOracleInstances = accessibleInstances.filter((i) => !configuredIds.has(i.id))

	const canDelete = detail.linkedApps.length === 0 && detail.environments.length === 0

	return data({
		...breadcrumbCtx,
		app: detail.app,
		teams: detail.teams,
		primaryApp: detail.primaryApp,
		linkedApps: detail.linkedApps,
		linkSuggestions: relevantCandidates,
		appElements,
		availableElements: allElements.filter((e) => !appElements.some((ae) => ae.id === e.id)),
		availableTeams,
		oracleInstances: filteredOracleInstances,
		availableOracleInstances,
		oraclePersistence: detail.persistence
			.filter((p) => p.type === "oracle")
			.map((p) => ({ id: p.id, name: p.name, oracleInstanceId: p.oracleInstanceId })),
		canDelete,
	})
}

export async function action({ params, request }: ActionFunctionArgs) {
	const appId = params.appId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })

	// Extract the URL prefix for context-aware redirects
	const url = new URL(request.url)
	const marker = `/applikasjoner/${appId}`
	const idx = url.pathname.indexOf(marker)
	const appBase = idx !== -1 ? url.pathname.slice(0, idx + marker.length) : `/applikasjoner/${appId}`

	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const formData = await request.formData()
	const intent = formData.get("intent") as string
	const performer = "system"

	if (intent === "delete") {
		await deleteApplication(appId, performer)
		return redirect("/dashboard")
	} else if (intent === "rename") {
		const newName = (formData.get("name") as string)?.trim()
		if (!newName) throw new Response("Navn kan ikke være tomt", { status: 400 })
		await renameApplication(appId, newName, performer)
	} else if (intent === "promoteToPrimary") {
		const newPrimaryId = formData.get("newPrimaryId") as string
		if (!newPrimaryId) throw new Response("Mangler newPrimaryId", { status: 400 })
		await promoteToPrimary(newPrimaryId, appId, performer)
		return redirect(`/applikasjoner/${newPrimaryId}/rediger`)
	} else if (intent === "promoteThis") {
		// This app is a child, and wants to become primary
		const currentPrimaryId = formData.get("currentPrimaryId") as string
		if (!currentPrimaryId) throw new Response("Mangler currentPrimaryId", { status: 400 })
		await promoteToPrimary(appId, currentPrimaryId, performer)
	} else if (intent === "link") {
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
		await addApplicationElement(appId, elementId)
	} else if (intent === "removeElement") {
		const elementId = formData.get("elementId") as string
		if (!elementId) throw new Response("Mangler elementId", { status: 400 })
		await removeApplicationElement(appId, elementId)
	} else if (intent === "confirmElement") {
		const linkId = formData.get("linkId") as string
		if (!linkId) throw new Response("Mangler linkId", { status: 400 })
		await confirmApplicationElement(linkId, performer)
	} else if (intent === "rejectElement") {
		const linkId = formData.get("linkId") as string
		const reason = (formData.get("reason") as string)?.trim()
		if (!linkId) throw new Response("Mangler linkId", { status: 400 })
		if (!reason) throw new Response("Begrunnelse er påkrevd", { status: 400 })
		await rejectApplicationElement(linkId, reason, performer)
	} else if (intent === "link-team") {
		const devTeamId = formData.get("devTeamId") as string
		if (!devTeamId) throw new Response("Mangler devTeamId", { status: 400 })
		await linkAppToTeam(appId, devTeamId, performer)
	} else if (intent === "unlink-team") {
		const devTeamId = formData.get("devTeamId") as string
		if (!devTeamId) throw new Response("Mangler devTeamId", { status: 400 })
		await unlinkAppFromTeam(appId, devTeamId, performer)
	} else if (intent === "addOracleInstance") {
		const instanceId = formData.get("instanceId") as string
		if (!instanceId) throw new Response("Mangler instanceId", { status: 400 })
		await configureOracleInstance(appId, instanceId, authedUser.navIdent)
	} else if (intent === "removeOracleInstance") {
		const instanceId = formData.get("instanceId") as string
		if (!instanceId) throw new Response("Mangler instanceId", { status: 400 })
		await removeOracleInstance(appId, instanceId)
	} else if (intent === "toggleOracleReport") {
		const instanceId = formData.get("instanceId") as string
		const include = formData.get("include") as string
		if (!instanceId) throw new Response("Mangler instanceId", { status: 400 })
		await setIncludeInReport(appId, instanceId, include === "true")
	} else if (intent === "fetchEvidence") {
		const instanceId = formData.get("instanceId") as string
		if (!instanceId) throw new Response("Mangler instanceId", { status: 400 })
		const [evidence, excel] = await Promise.all([getAuditEvidence(instanceId), getAuditEvidenceExcel(instanceId)])
		await saveAuditEvidenceSnapshot(
			appId,
			instanceId,
			evidence.overallStatus,
			evidence.collectedAt,
			excel,
			authedUser.navIdent,
		)
	} else if (intent === "linkPersistenceToOracle") {
		const persistenceId = formData.get("persistenceId") as string
		const oracleInstanceId = (formData.get("oracleInstanceId") as string) || null
		if (!persistenceId) throw new Response("Mangler persistenceId", { status: 400 })
		const { linkPersistenceToOracleInstance } = await import("~/db/queries/nais.server")
		await linkPersistenceToOracleInstance(persistenceId, oracleInstanceId)
	} else {
		throw new Response("Ugyldig handling", { status: 400 })
	}

	return redirect(`${appBase}/rediger`)
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

function statusVariant(status: string): "success" | "warning" | "error" {
	if (status === "OK") return "success"
	if (status === "PARTIAL") return "warning"
	return "error"
}

export default function ApplikasjonRediger() {
	const {
		app,
		teams,
		primaryApp,
		linkedApps,
		linkSuggestions,
		appElements,
		availableElements,
		availableTeams,
		oracleInstances,
		availableOracleInstances,
		oraclePersistence,
		canDelete,
	} = useLoaderData<typeof loader>()
	const _appBase = useAppBasePath()

	return (
		<VStack gap="space-24">
			<Heading size="xlarge" level="2" spacing>
				Administrer {app.name}
			</Heading>

			{/* Primary app notice */}
			{primaryApp && (
				<Box>
					<BodyLong spacing>
						Denne applikasjonen er lenket til primærapplikasjonen{" "}
						<Link to={`/applikasjoner/${primaryApp.id}/detaljer`}>{primaryApp.name}</Link>.
					</BodyLong>
					<Form method="post">
						<input type="hidden" name="intent" value="promoteThis" />
						<input type="hidden" name="currentPrimaryId" value={primaryApp.id} />
						<Button variant="secondary" size="small" type="submit">
							Gjør denne til hovedapplikasjon
						</Button>
					</Form>
				</Box>
			)}

			{/* Rename */}
			<Box>
				<Heading size="medium" level="3" spacing>
					Navn
				</Heading>
				<Form method="post">
					<input type="hidden" name="intent" value="rename" />
					<HStack gap="space-4" align="end">
						<TextField label="Applikasjonsnavn" name="name" defaultValue={app.name} size="small" />
						<Button variant="secondary" size="small" type="submit">
							Lagre
						</Button>
					</HStack>
				</Form>
			</Box>

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

			{/* Oracle-revisjonsbevis */}
			<Box>
				<Heading size="medium" level="3" spacing>
					Oracle-revisjonsbevis
				</Heading>
				<BodyLong spacing>
					Konfigurer hvilke Oracle-instanser som skal hente revisjonsbevis for denne applikasjonen.
				</BodyLong>

				{oracleInstances.length > 0 ? (
					<VStack gap="space-4">
						{oracleInstances.map((inst) => (
							<Box key={inst.id} borderWidth="1" borderColor="neutral-subtle" padding="space-8" borderRadius="8">
								<VStack gap="space-4">
									<HStack gap="space-4" align="center" wrap>
										<Tag variant="info" size="small">
											{inst.instanceId.toUpperCase()}
										</Tag>
										{inst.latestSnapshot ? (
											<Tag variant={statusVariant(inst.latestSnapshot.overallStatus)} size="xsmall">
												{inst.latestSnapshot.overallStatus}
											</Tag>
										) : (
											<Tag variant="neutral" size="xsmall">
												Ikke hentet
											</Tag>
										)}
										{inst.latestSnapshot && (
											<BodyShort size="small" style={{ color: "var(--ax-text-subtle)" }}>
												Hentet {new Date(inst.latestSnapshot.fetchedAt).toLocaleString("nb-NO")}
											</BodyShort>
										)}
									</HStack>
									<HStack gap="space-2" align="center">
										<Form method="post" style={{ display: "inline" }}>
											<input type="hidden" name="intent" value="fetchEvidence" />
											<input type="hidden" name="instanceId" value={inst.instanceId} />
											<Button variant="secondary" size="xsmall" type="submit">
												Hent bevis
											</Button>
										</Form>
										<Form method="post" style={{ display: "inline" }}>
											<input type="hidden" name="intent" value="toggleOracleReport" />
											<input type="hidden" name="instanceId" value={inst.instanceId} />
											<input type="hidden" name="include" value={inst.includeInReport ? "false" : "true"} />
											<Button variant="tertiary" size="xsmall" type="submit">
												{inst.includeInReport ? "Fjern fra rapport" : "Ta med i rapport"}
											</Button>
										</Form>
										<Form method="post" style={{ display: "inline" }}>
											<input type="hidden" name="intent" value="removeOracleInstance" />
											<input type="hidden" name="instanceId" value={inst.instanceId} />
											<Button variant="tertiary-neutral" size="xsmall" type="submit">
												Fjern
											</Button>
										</Form>
									</HStack>
								</VStack>
							</Box>
						))}
					</VStack>
				) : (
					<BodyLong>Ingen Oracle-instanser er konfigurert.</BodyLong>
				)}

				{availableOracleInstances.length > 0 && (
					<Form method="post" style={{ marginTop: "var(--ax-space-8)" }}>
						<input type="hidden" name="intent" value="addOracleInstance" />
						<HStack gap="space-2" align="end">
							<Select label="Legg til Oracle-instans" name="instanceId" size="small">
								{availableOracleInstances.map((inst) => (
									<option key={inst.id} value={inst.id}>
										{inst.id.toUpperCase()} ({inst.name})
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

			{/* Oracle-databasekobling */}
			{oraclePersistence.length > 0 && oracleInstances.length > 0 && (
				<Box>
					<Heading size="medium" level="3" spacing>
						Oracle-databasekobling
					</Heading>
					<BodyLong spacing>
						Koble Oracle-databaser oppdaget av Nais til riktig Oracle-instans. Dette sikrer at audit
						logging-oppsummeringer hentes for riktig database.
					</BodyLong>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table needs keyboard access */}
					<section className="table-scroll" tabIndex={0} aria-label="Databasekoblinger">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Database (oppdaget)</Table.HeaderCell>
									<Table.HeaderCell scope="col">Koblet Oracle-instans</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{oraclePersistence.map((p) => (
									<Table.Row key={p.id}>
										<Table.DataCell>{p.name}</Table.DataCell>
										<Table.DataCell>
											<Form method="post">
												<input type="hidden" name="intent" value="linkPersistenceToOracle" />
												<input type="hidden" name="persistenceId" value={p.id} />
												<HStack gap="space-2" align="end">
													<Select
														label="Oracle-instans"
														name="oracleInstanceId"
														size="small"
														hideLabel
														defaultValue={p.oracleInstanceId ?? ""}
													>
														<option value="">Bruk databasenavn ({p.name})</option>
														{oracleInstances.map((inst) => (
															<option key={inst.id} value={inst.instanceId}>
																{inst.instanceId.toUpperCase()}
															</option>
														))}
													</Select>
													<Button variant="secondary" size="small" type="submit">
														Lagre
													</Button>
												</HStack>
											</Form>
										</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				</Box>
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
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table needs keyboard access */}
					<section className="table-scroll" tabIndex={0} aria-label="Tilgangsgivende applikasjoner">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
									<Table.HeaderCell scope="col" />
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
												<input type="hidden" name="intent" value="promoteToPrimary" />
												<input type="hidden" name="newPrimaryId" value={la.id} />
												<Button variant="tertiary" size="xsmall" type="submit">
													Gjør til hovedapplikasjon
												</Button>
											</Form>
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
					</section>
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
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table needs keyboard access */}
					<section className="table-scroll" tabIndex={0} aria-label="Tilgangsmottakende applikasjoner">
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
					</section>
				</Box>
			)}

			{/* Export */}
			<Box>
				<Heading size="medium" level="3" spacing>
					Eksport
				</Heading>
				<Button
					as="a"
					href={`/api/applikasjoner/${app.id}/export-xlsx`}
					variant="secondary"
					size="small"
					icon={<DownloadIcon aria-hidden />}
				>
					Last ned compliance-rapport (XLSX)
				</Button>
			</Box>

			{/* Delete application */}
			{canDelete && (
				<Box padding="space-16" borderRadius="8" borderColor="danger-subtle" borderWidth="1">
					<VStack gap="space-8">
						<Heading size="medium" level="3">
							Slett applikasjon
						</Heading>
						<BodyLong>
							Denne applikasjonen finnes ikke på Nais og har ingen lenkede applikasjoner. Du kan slette den permanent.
							Alle tilhørende vurderinger, screening-svar og annen data vil bli fjernet.
						</BodyLong>
						<Form
							method="post"
							onSubmit={(e) => !confirm(`Er du sikker på at du vil slette ${app.name}?`) && e.preventDefault()}
						>
							<input type="hidden" name="intent" value="delete" />
							<Button variant="danger" size="small" type="submit">
								Slett {app.name}
							</Button>
						</Form>
					</VStack>
				</Box>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
