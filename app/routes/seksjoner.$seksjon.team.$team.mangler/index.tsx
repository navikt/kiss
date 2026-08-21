import { BodyShort, Box, Heading, HStack, Switch, Table, Tag, VStack } from "@navikt/ds-react"
import { useMemo, useState } from "react"
import { data, Link, useLoaderData } from "react-router"
import { FilterSelect } from "~/components/FilterSelect"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getSectionBySlug, getTeamComplianceGaps } from "~/db/queries/sections.server"
import { economySystemTypeLabels } from "~/db/schema/applications"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import type { Route } from "./+types/index"

export async function loader({ request, params }: Route.LoaderArgs) {
	const seksjon = params.seksjon
	const teamSlug = params.team
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })
	if (!teamSlug) throw new Response("Mangler team", { status: 400 })

	await requireAuthenticatedUser(request)

	const [result, section] = await Promise.all([getTeamComplianceGaps(teamSlug), getSectionBySlug(seksjon)])
	if (!result) throw new Response("Team ikke funnet", { status: 404 })
	if (!section) throw new Response("Seksjon ikke funnet", { status: 404 })
	if (result.team.sectionId !== section.id) throw new Response("Team tilhører ikke denne seksjonen", { status: 404 })

	return data({
		seksjon,
		seksjonName: section.name,
		team: teamSlug,
		teamName: result.team.name,
		gaps: result.gaps,
	})
}

export default function TeamComplianceGaps() {
	const { seksjon, seksjonName, team, teamName, gaps } = useLoaderData<typeof loader>()
	const [showEconomyOnly, setShowEconomyOnly] = useState(false)
	const [appFilter, setAppFilter] = useState("")
	const [controlFilter, setControlFilter] = useState("")

	const appOptions = useMemo(() => {
		const byId = new Map<string, string>()
		for (const gap of gaps) byId.set(gap.appId, gap.appName)
		return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1], "nb"))
	}, [gaps])

	const controlOptions = useMemo(() => {
		const byCode = new Map<string, string>()
		for (const gap of gaps) byCode.set(gap.controlCode, gap.controlName)
		return [...byCode.entries()].sort((a, b) => a[0].localeCompare(b[0], "nb"))
	}, [gaps])

	const visibleGaps = useMemo(() => {
		return gaps.filter((gap) => {
			if (showEconomyOnly && gap.isEconomySystem !== true) return false
			if (appFilter && gap.appId !== appFilter) return false
			if (controlFilter && gap.controlCode !== controlFilter) return false
			return true
		})
	}, [gaps, showEconomyOnly, appFilter, controlFilter])

	const economyGapCount = useMemo(() => gaps.filter((gap) => gap.isEconomySystem === true).length, [gaps])

	return (
		<VStack gap="space-8">
			<VStack gap="space-2">
				<BodyShort size="small">
					<Link to={`/seksjoner/${seksjon}`}>{seksjonName}</Link>
					{" / "}
					<Link to={`/seksjoner/${seksjon}/team/${team}`}>{teamName}</Link>
				</BodyShort>
				<Heading size="xlarge" level="2">
					Mangler
				</Heading>
				<BodyShort textColor="subtle">{gaps.length} kontroller mangler vurdering</BodyShort>
				<BodyShort textColor="subtle">{economyGapCount} kontroller mangler vurderinger på økonomisystemer</BodyShort>
			</VStack>

			<HStack gap="space-4" wrap>
				<FilterSelect
					label="Applikasjon"
					allLabel="Alle applikasjoner"
					value={appFilter}
					onChange={setAppFilter}
					options={appOptions}
					style={{ maxWidth: "20rem" }}
				/>
				<FilterSelect
					label="Kontroll"
					allLabel="Alle kontroller"
					value={controlFilter}
					onChange={setControlFilter}
					options={controlOptions.map(([code, name]) => [code, `${code} – ${name}`] as const)}
					style={{ maxWidth: "20rem" }}
				/>
			</HStack>

			<HStack justify="space-between" align="center" wrap>
				<Heading size="medium" level="3">
					Kontroller
				</Heading>
				<Switch size="small" checked={showEconomyOnly} onChange={(e) => setShowEconomyOnly(e.target.checked)}>
					Vis kun økonomisystemer
				</Switch>
			</HStack>

			{gaps.length === 0 ? (
				<Box padding="space-16" borderRadius="8" background="sunken">
					<BodyShort>Ingen mangler registrert for dette teamet. Bra jobbet! 🎉</BodyShort>
				</Box>
			) : visibleGaps.length === 0 ? (
				<BodyShort>Ingen mangler matcher filteret.</BodyShort>
			) : (
				/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
				<section className="table-scroll" tabIndex={0} aria-label="Mangler per applikasjon">
					<Table>
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
								<Table.HeaderCell scope="col">Kontroll</Table.HeaderCell>
								<Table.HeaderCell scope="col">Teknologielement</Table.HeaderCell>
								<Table.HeaderCell scope="col">Økonomisystem</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{visibleGaps.map((gap) => (
								<Table.Row key={gap.id}>
									<Table.DataCell>
										<Link to={`/seksjoner/${seksjon}/team/${team}/applikasjoner/${gap.appId}/detaljer`}>
											{gap.appName}
										</Link>
									</Table.DataCell>
									<Table.DataCell>
										{gap.controlCode} – {gap.controlName}
									</Table.DataCell>
									<Table.DataCell>{gap.technologyElement ?? "–"}</Table.DataCell>
									<Table.DataCell>
										{gap.isEconomySystem === null ? (
											"–"
										) : gap.isEconomySystem ? (
											<Tag variant="info" size="small">
												{gap.economySystemType ? economySystemTypeLabels[gap.economySystemType] : "Ja"}
											</Tag>
										) : (
											"Nei"
										)}
									</Table.DataCell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				</section>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
