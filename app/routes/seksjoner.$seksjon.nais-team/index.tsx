import {
	Link as AkselLink,
	Alert,
	BodyLong,
	Button,
	Heading,
	HStack,
	ReadMore,
	Select,
	Table,
	Tag,
	VStack,
} from "@navikt/ds-react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import {
	getIgnoredAppsForSection,
	getNaisTeamsForSection,
	getUnassignedAppsForSection,
	getUnlinkedNaisTeams,
	ignoreAppForSection,
	linkNaisTeamToSection,
	unignoreAppForSection,
	unlinkNaisTeamFromSection,
} from "~/db/queries/nais.server"
import { getSectionDetail } from "~/db/queries/sections.server"
import { getAuthenticatedUser } from "~/lib/auth.server"

export async function loader({ params }: LoaderFunctionArgs) {
	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })

	const result = await getSectionDetail(seksjon)
	if (!result) throw new Response("Seksjon ikke funnet", { status: 404 })

	const [linkedNaisTeams, unlinkedNaisTeams, unassignedApps, ignoredApps] = await Promise.all([
		getNaisTeamsForSection(result.section.id),
		getUnlinkedNaisTeams(),
		getUnassignedAppsForSection(result.section.id),
		getIgnoredAppsForSection(result.section.id),
	])

	return data({
		seksjon,
		seksjonName: result.section.name,
		sectionId: result.section.id,
		linkedNaisTeams: linkedNaisTeams.map((t) => ({
			slug: t.slug,
			displayName: t.displayName,
			devTeamId: t.devTeamId,
		})),
		unlinkedNaisTeams: unlinkedNaisTeams.map((t) => ({
			slug: t.slug,
			displayName: t.displayName,
		})),
		unassignedApps,
		ignoredApps: ignoredApps.map((a) => ({
			appId: a.appId,
			appName: a.appName,
			reason: a.reason,
			ignoredBy: a.ignoredBy,
			ignoredAt: a.ignoredAt?.toISOString() ?? null,
		})),
	})
}

export async function action({ request, params }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const userName = user?.navIdent ?? "system"
	const formData = await request.formData()
	const intent = formData.get("intent")
	const seksjon = params.seksjon

	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })

	const result = await getSectionDetail(seksjon)
	if (!result) throw new Response("Seksjon ikke funnet", { status: 404 })

	if (intent === "link-nais-team") {
		const naisTeamSlug = formData.get("naisTeamSlug")
		if (typeof naisTeamSlug !== "string" || !naisTeamSlug) {
			throw new Response("Mangler Nais-team", { status: 400 })
		}
		await linkNaisTeamToSection(naisTeamSlug, result.section.id, userName)
	}

	if (intent === "unlink-nais-team") {
		const naisTeamSlug = formData.get("naisTeamSlug")
		if (typeof naisTeamSlug !== "string" || !naisTeamSlug) {
			throw new Response("Mangler Nais-team", { status: 400 })
		}
		await unlinkNaisTeamFromSection(naisTeamSlug, userName)
	}

	if (intent === "ignore-app") {
		const applicationId = formData.get("applicationId")
		if (typeof applicationId !== "string" || !applicationId) {
			throw new Response("Mangler applikasjon", { status: 400 })
		}
		const reason = formData.get("reason")
		await ignoreAppForSection(
			result.section.id,
			applicationId,
			userName,
			typeof reason === "string" ? reason : undefined,
		)
	}

	if (intent === "unignore-app") {
		const applicationId = formData.get("applicationId")
		if (typeof applicationId !== "string" || !applicationId) {
			throw new Response("Mangler applikasjon", { status: 400 })
		}
		await unignoreAppForSection(result.section.id, applicationId, userName)
	}

	return data({ success: true })
}

export default function SeksjonNaisTeam() {
	const { seksjon, seksjonName, linkedNaisTeams, unlinkedNaisTeams, unassignedApps, ignoredApps } =
		useLoaderData<typeof loader>()

	return (
		<VStack gap="space-8">
			<HStack gap="space-4" align="center">
				<Link to={`/seksjoner/${seksjon}`}>← Tilbake til {seksjonName}</Link>
			</HStack>

			<Heading size="xlarge" level="2">
				Nais-team – {seksjonName}
			</Heading>
			<BodyLong>Administrer Nais-team koblet til seksjonen og se applikasjoner som mangler teamtilknytning.</BodyLong>

			<Heading size="large" level="3">
				Koblede Nais-team ({linkedNaisTeams.length})
			</Heading>

			{linkedNaisTeams.length > 0 ? (
				/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
				<section className="table-scroll" tabIndex={0} aria-label="Koblede Nais-team">
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Nais-team</Table.HeaderCell>
								<Table.HeaderCell scope="col">Utviklingsteam</Table.HeaderCell>
								<Table.HeaderCell scope="col">Handling</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{linkedNaisTeams.map((nt) => (
								<Table.Row key={nt.slug}>
									<Table.DataCell>
										{nt.slug}
										{nt.displayName && nt.displayName !== nt.slug && <> ({nt.displayName})</>}
									</Table.DataCell>
									<Table.DataCell>
										{nt.devTeamId ? (
											<Tag variant="success" size="small">
												Tilknyttet
											</Tag>
										) : (
											<Tag variant="warning" size="small">
												Ikke tilknyttet
											</Tag>
										)}
									</Table.DataCell>
									<Table.DataCell>
										<Form method="post">
											<input type="hidden" name="intent" value="unlink-nais-team" />
											<input type="hidden" name="naisTeamSlug" value={nt.slug} />
											<Button type="submit" variant="tertiary-neutral" size="xsmall">
												Fjern fra seksjon
											</Button>
										</Form>
									</Table.DataCell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				</section>
			) : (
				<Alert variant="info">
					Ingen Nais-team er koblet til denne seksjonen ennå. Bruk skjemaet nedenfor for å legge til team.
				</Alert>
			)}

			{unlinkedNaisTeams.length > 0 && (
				<Form method="post">
					<input type="hidden" name="intent" value="link-nais-team" />
					<HStack gap="space-4" align="end">
						<Select label="Legg til Nais-team" name="naisTeamSlug" size="small">
							<option value="">Velg team…</option>
							{unlinkedNaisTeams.map((nt) => (
								<option key={nt.slug} value={nt.slug}>
									{nt.slug}
									{nt.displayName && nt.displayName !== nt.slug ? ` (${nt.displayName})` : ""}
								</option>
							))}
						</Select>
						<Button type="submit" variant="secondary" size="small">
							Legg til
						</Button>
					</HStack>
				</Form>
			)}

			<Heading size="large" level="3">
				Applikasjoner uten team ({unassignedApps.length})
			</Heading>

			{unassignedApps.length > 0 ? (
				<>
					<Alert variant="warning">
						{unassignedApps.length} {unassignedApps.length === 1 ? "applikasjon" : "applikasjoner"} fra seksjonens
						Nais-team er ikke koblet til et utviklingsteam. Disse applikasjonene følges ikke opp for compliance.
					</Alert>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
					<section className="table-scroll" tabIndex={0} aria-label="Applikasjoner uten team">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
									<Table.HeaderCell scope="col">Nais-team</Table.HeaderCell>
									<Table.HeaderCell scope="col">Miljø</Table.HeaderCell>
									<Table.HeaderCell scope="col">Handling</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{unassignedApps.map((app) => (
									<Table.Row key={app.appId}>
										<Table.DataCell>
											<AkselLink as={Link} to={`/applikasjoner/${app.appId}/compliance`}>
												{app.appName}
											</AkselLink>
										</Table.DataCell>
										<Table.DataCell>
											<Tag variant="info" size="small">
												{app.naisTeamSlug}
											</Tag>
										</Table.DataCell>
										<Table.DataCell>{app.environments.join(", ")}</Table.DataCell>
										<Table.DataCell>
											<Form method="post">
												<input type="hidden" name="intent" value="ignore-app" />
												<input type="hidden" name="applicationId" value={app.appId} />
												<Button type="submit" variant="tertiary-neutral" size="xsmall">
													Ignorer
												</Button>
											</Form>
										</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				</>
			) : (
				<Alert variant="success">Alle applikasjoner fra seksjonens Nais-team er tilknyttet et utviklingsteam.</Alert>
			)}

			{ignoredApps.length > 0 && (
				<ReadMore header={`Ignorerte applikasjoner (${ignoredApps.length})`}>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
					<section className="table-scroll" tabIndex={0} aria-label="Ignorerte applikasjoner">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
									<Table.HeaderCell scope="col">Begrunnelse</Table.HeaderCell>
									<Table.HeaderCell scope="col">Ignorert av</Table.HeaderCell>
									<Table.HeaderCell scope="col">Handling</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{ignoredApps.map((app) => (
									<Table.Row key={app.appId}>
										<Table.DataCell>{app.appName}</Table.DataCell>
										<Table.DataCell>{app.reason || "–"}</Table.DataCell>
										<Table.DataCell>{app.ignoredBy}</Table.DataCell>
										<Table.DataCell>
											<Form method="post">
												<input type="hidden" name="intent" value="unignore-app" />
												<input type="hidden" name="applicationId" value={app.appId} />
												<Button type="submit" variant="tertiary-neutral" size="xsmall">
													Gjenopprett
												</Button>
											</Form>
										</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				</ReadMore>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
