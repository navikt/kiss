import { BodyLong, Button, Heading, HGrid, HStack, Select, Table, Tag, VStack } from "@navikt/ds-react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import {
	getNaisTeamsForSection,
	getUnassignedAppsForSection,
	getUnlinkedNaisTeams,
	linkNaisTeamToSection,
	unlinkNaisTeamFromSection,
} from "~/db/queries/nais.server"
import { getSectionDetail } from "~/db/queries/sections.server"
import { getAuthenticatedUser } from "~/lib/auth.server"
import { compliancePercent } from "~/lib/utils"

export async function loader({ params }: LoaderFunctionArgs) {
	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })

	const result = await getSectionDetail(seksjon)
	if (!result) throw new Response("Seksjon ikke funnet", { status: 404 })

	const seksjonName = result.section.name
	const teams = result.teams

	const totalApps = teams.reduce((sum, t) => sum + t.apps, 0)
	const totalImplemented = teams.reduce((sum, t) => sum + t.implemented, 0)
	const totalPartial = teams.reduce((sum, t) => sum + t.partial, 0)
	const totalControls = teams.reduce((sum, t) => sum + t.total, 0)
	const overallPercent = compliancePercent(totalImplemented, totalPartial, totalControls)

	const [linkedNaisTeams, unlinkedNaisTeams, unassignedApps] = await Promise.all([
		getNaisTeamsForSection(result.section.id),
		getUnlinkedNaisTeams(),
		getUnassignedAppsForSection(result.section.id),
	])

	return data({
		seksjon,
		seksjonName,
		sectionId: result.section.id,
		teams,
		totalApps,
		totalImplemented,
		totalPartial,
		totalControls,
		overallPercent,
		linkedNaisTeams: linkedNaisTeams.map((t) => ({ slug: t.slug, displayName: t.displayName })),
		unlinkedNaisTeams: unlinkedNaisTeams.map((t) => ({ slug: t.slug, displayName: t.displayName })),
		unassignedApps,
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

	return data({ success: true })
}

export default function SeksjonDashboard() {
	const {
		seksjon,
		seksjonName,
		teams,
		totalApps,
		totalImplemented,
		totalPartial,
		totalControls,
		overallPercent,
		linkedNaisTeams,
		unlinkedNaisTeams,
		unassignedApps,
	} = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-8">
			<Heading size="xlarge" level="2">
				Seksjon: {seksjonName}
			</Heading>
			<BodyLong>Compliance-status for alle team i seksjonen.</BodyLong>

			<div className="dashboard-summary">
				<div className="dashboard-metric">
					<span className="dashboard-metric-value">{overallPercent}%</span>
					<span className="dashboard-metric-label">Total compliance</span>
				</div>
				<div className="dashboard-metric">
					<span className="dashboard-metric-value">{teams.length}</span>
					<span className="dashboard-metric-label">Team</span>
				</div>
				<div className="dashboard-metric">
					<span className="dashboard-metric-value">{totalApps}</span>
					<span className="dashboard-metric-label">Applikasjoner</span>
				</div>
				<div className="dashboard-metric">
					<span className="dashboard-metric-value">{totalImplemented}</span>
					<span className="dashboard-metric-label">Implementert</span>
				</div>
				<div className="dashboard-metric">
					<span className="dashboard-metric-value">{totalPartial}</span>
					<span className="dashboard-metric-label">Delvis implementert</span>
				</div>
				<div className="dashboard-metric">
					<span className="dashboard-metric-value">{totalControls}</span>
					<span className="dashboard-metric-label">Totalt kontroller</span>
				</div>
			</div>

			<Heading size="large" level="3">
				Status per team
			</Heading>

			<HGrid gap="space-6" columns={{ xs: 1, sm: 2 }}>
				{teams.map((team) => {
					const pct = compliancePercent(team.implemented, team.partial, team.total)
					return (
						<Link
							key={team.slug}
							to={`/seksjoner/${seksjon}/team/${team.slug}`}
							style={{ textDecoration: "none", color: "inherit" }}
						>
							<div className="domain-status-card">
								<div className="domain-status-header">
									<Heading size="small" level="4">
										{team.name}
									</Heading>
									<span className="domain-status-pct">{pct}%</span>
								</div>
								<div
									className="domain-status-bar"
									role="progressbar"
									aria-valuenow={pct}
									aria-valuemin={0}
									aria-valuemax={100}
									aria-label={`${team.name} compliance ${pct}%`}
								>
									<div
										className="domain-status-bar-implemented"
										style={{ width: `${team.total > 0 ? (team.implemented / team.total) * 100 : 0}%` }}
									/>
									<div
										className="domain-status-bar-partial"
										style={{ width: `${team.total > 0 ? (team.partial / team.total) * 100 : 0}%` }}
									/>
								</div>
								<div className="domain-status-details">
									<span>{team.implemented} implementert</span>
									<span>{team.partial} delvis</span>
									<span>{team.notImplemented} mangler</span>
									<span>{team.apps} apper</span>
								</div>
							</div>
						</Link>
					)
				})}
			</HGrid>

			<Heading size="large" level="3">
				Nais-team i seksjonen
			</Heading>

			{linkedNaisTeams.length > 0 ? (
				/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
				<section className="table-scroll" tabIndex={0} aria-label="Koblede Nais-team">
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Nais-team</Table.HeaderCell>
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
										<Form method="post">
											<input type="hidden" name="intent" value="unlink-nais-team" />
											<input type="hidden" name="naisTeamSlug" value={nt.slug} />
											<Button type="submit" variant="tertiary-neutral" size="xsmall">
												Fjern
											</Button>
										</Form>
									</Table.DataCell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				</section>
			) : (
				<BodyLong>Ingen Nais-team er koblet til denne seksjonen ennå.</BodyLong>
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

			{unassignedApps.length > 0 && (
				<>
					<Heading size="large" level="3">
						Applikasjoner uten team
					</Heading>
					<BodyLong>
						Disse applikasjonene tilhører Nais-team i seksjonen, men er ikke koblet til et utviklingsteam.
					</BodyLong>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
					<section className="table-scroll" tabIndex={0} aria-label="Applikasjoner uten team">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
									<Table.HeaderCell scope="col">Nais-team</Table.HeaderCell>
									<Table.HeaderCell scope="col">Miljø</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{unassignedApps.map((app) => (
									<Table.Row key={app.appId}>
										<Table.DataCell>{app.appName}</Table.DataCell>
										<Table.DataCell>
											<Tag variant="info" size="small">
												{app.naisTeamSlug}
											</Tag>
										</Table.DataCell>
										<Table.DataCell>{app.environments.join(", ")}</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				</>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
