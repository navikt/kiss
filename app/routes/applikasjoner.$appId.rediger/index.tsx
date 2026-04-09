import { CheckmarkIcon, XMarkIcon } from "@navikt/aksel-icons"
import {
	Link as AkselLink,
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
import { findLinkCandidates, getApplicationDetail, linkApplication, unlinkApplication } from "~/db/queries/nais.server"
import {
	addApplicationElement,
	confirmApplicationElement,
	getAllTechnologyElements,
	getApplicationElements,
	rejectApplicationElement,
	removeApplicationElement,
} from "~/db/queries/technology-elements.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"
import { getAuditEvidence, getAuditEvidenceExcel, getOracleInstances } from "~/lib/oracle-revisjon.server"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const appId = params.appId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })

	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

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

	const relevantCandidates = [
		...new Map(
			candidates
				.filter((c) => c.apps.some((a) => a.id === appId))
				.flatMap((c) => c.apps.filter((a) => a.id !== appId && !a.alreadyLinked))
				.map((a) => [a.id, a]),
		).values(),
	]

	const configuredIds = new Set(oracleInstances.map((i) => i.instanceId))
	const availableOracleInstances = allOracleInstances.filter((i) => !configuredIds.has(i.id))

	return data({
		app: detail.app,
		teams: detail.teams,
		primaryApp: detail.primaryApp,
		linkedApps: detail.linkedApps,
		linkSuggestions: relevantCandidates,
		appElements,
		availableElements: allElements.filter((e) => !appElements.some((ae) => ae.id === e.id)),
		availableTeams,
		oracleInstances,
		availableOracleInstances,
	})
}

export async function action({ params, request }: ActionFunctionArgs) {
	const appId = params.appId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })

	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

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
	} else {
		throw new Response("Ugyldig handling", { status: 400 })
	}

	return redirect(`/applikasjoner/${appId}/rediger`)
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
	} = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-24">
			<div>
				<AkselLink as={Link} to={`/applikasjoner/${app.id}/detaljer`}>
					← Tilbake til detaljer
				</AkselLink>
				<Heading size="xlarge" level="2" spacing>
					Administrer {app.name}
				</Heading>
			</div>

			{/* Primary app notice */}
			{primaryApp && (
				<BodyLong>
					Denne applikasjonen er lenket til primærapplikasjonen{" "}
					<Link to={`/applikasjoner/${primaryApp.id}/detaljer`}>{primaryApp.name}</Link>.
				</BodyLong>
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
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
