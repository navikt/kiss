import { LinkIcon } from "@navikt/aksel-icons"
import {
	Link as AkselLink,
	Alert,
	BodyLong,
	BodyShort,
	Button,
	Heading,
	HStack,
	Select,
	Table,
	Tag,
	VStack,
} from "@navikt/ds-react"
import { data, Form, Link, redirect, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import {
	acceptLinkSuggestion,
	bulkAcceptLinkSuggestions,
	createParentAndLinkGroup,
	findLinkCandidates,
	getLinkCandidatesForSection,
	getPendingLinkSuggestionsForSection,
	linkApplication,
	persistLinkSuggestions,
	rejectLinkSuggestion,
} from "~/db/queries/nais.server"
import { getSectionDetail } from "~/db/queries/sections.server"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"
import type { Route } from "./+types/index"

export async function loader({ request, params }: Route.LoaderArgs) {
	const authedUser = await requireAuthenticatedUser(request)
	requireAdmin(authedUser)

	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })

	const result = await getSectionDetail(seksjon)
	if (!result) throw new Response("Seksjon ikke funnet", { status: 404 })

	const sectionId = result.section.id

	const [suggestions, linkCandidates] = await Promise.all([
		getPendingLinkSuggestionsForSection(sectionId),
		getLinkCandidatesForSection(sectionId),
	])

	// Union-Find to merge overlapping suggestion groups
	const parent = new Map<string, string>()
	function find(x: string): string {
		if (!parent.has(x)) parent.set(x, x)
		const px = parent.get(x) ?? x
		if (px !== x) parent.set(x, find(px))
		return parent.get(x) ?? x
	}
	function union(a: string, b: string) {
		const ra = find(a)
		const rb = find(b)
		if (ra !== rb) parent.set(ra, rb)
	}

	const appNames = new Map<string, string>()
	for (const s of suggestions) {
		appNames.set(s.primaryAppId, s.primaryAppName)
		appNames.set(s.secondaryAppId, s.secondaryAppName)
		union(s.primaryAppId, s.secondaryAppId)
	}

	const componentMap = new Map<string, { appIds: Set<string>; suggestions: typeof suggestions }>()
	for (const s of suggestions) {
		const root = find(s.primaryAppId)
		let comp = componentMap.get(root)
		if (!comp) {
			comp = { appIds: new Set(), suggestions: [] }
			componentMap.set(root, comp)
		}
		comp.appIds.add(s.primaryAppId)
		comp.appIds.add(s.secondaryAppId)
		comp.suggestions.push(s)
	}

	const groups = [...componentMap.values()].map((comp) => {
		const names = [...comp.appIds].map((id) => appNames.get(id) ?? id)
		const groupName = names.reduce((a, b) => (a.length <= b.length ? a : b))
		return {
			baseName: groupName,
			appIds: [...comp.appIds],
			appNames: Object.fromEntries([...comp.appIds].map((id) => [id, appNames.get(id) ?? id])),
			suggestions: comp.suggestions,
		}
	})

	return data({
		seksjon,
		sectionName: result.section.name,
		groups,
		suggestions,
		linkCandidates: linkCandidates.map((c) => ({
			matchType: c.matchType,
			confidence: c.confidence,
			apps: c.apps,
		})),
	})
}

const matchTypeLabels: Record<string, { label: string; variant: "info" | "success" | "warning" }> = {
	both: { label: "Image + navn", variant: "success" },
	image_match: { label: "Docker image", variant: "info" },
	name_pattern: { label: "Navnemønster", variant: "warning" },
}

export async function action({ request, params }: Route.ActionArgs) {
	const authedUser = await requireAuthenticatedUser(request)
	requireAdmin(authedUser)

	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })

	const formData = await request.formData()
	const intent = formData.get("intent") as string
	const userId = authedUser.navIdent

	if (intent === "accept") {
		const suggestionId = formData.get("suggestionId") as string
		await acceptLinkSuggestion(suggestionId, userId)
	} else if (intent === "reject") {
		const suggestionId = formData.get("suggestionId") as string
		await rejectLinkSuggestion(suggestionId, userId)
	} else if (intent === "createParent") {
		const parentName = formData.get("parentName") as string
		const primaryAppId = formData.get("primaryAppId") as string | null
		const appIds = formData.getAll("appId") as string[]
		if (appIds.length > 0) {
			if (primaryAppId) {
				for (const appId of appIds) {
					if (appId === primaryAppId) continue
					await linkApplication(appId, primaryAppId, userId)
				}
				const { acceptRelatedSuggestions } = await import("~/db/queries/nais.server")
				await acceptRelatedSuggestions(appIds, userId)
			} else if (parentName) {
				await createParentAndLinkGroup(parentName, appIds, userId)
			}
		}
	} else if (intent === "bulkAccept") {
		const minConfidence = Number(formData.get("minConfidence") ?? 0.9)
		await bulkAcceptLinkSuggestions(minConfidence, userId)
	} else if (intent === "refresh") {
		const candidates = await findLinkCandidates()
		await persistLinkSuggestions(candidates)
	} else if (intent === "link-app") {
		const childId = formData.get("childId") as string
		const parentId = formData.get("parentId") as string
		if (!childId || !parentId) throw new Response("Mangler applikasjons-ID", { status: 400 })
		await linkApplication(childId, parentId, userId)
	} else if (intent === "link-all-apps") {
		const parentId = formData.get("parentId") as string
		const childIds = formData.getAll("childId") as string[]
		if (!parentId || childIds.length === 0) throw new Response("Mangler applikasjons-IDer", { status: 400 })
		for (const childId of childIds) {
			await linkApplication(childId, parentId, userId)
		}
	}

	return redirect(`/seksjoner/${seksjon}/koblingsforslag`)
}

export default function SectionLinkSuggestions() {
	const { seksjon, sectionName, groups, suggestions, linkCandidates } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-12">
			<HStack align="center" justify="space-between" wrap>
				<Heading size="xlarge" level="2">
					Koblingsforslag: {sectionName}
				</Heading>
				<Button as={Link} to={`/seksjoner/${seksjon}/rediger`} variant="tertiary" size="small">
					← Tilbake
				</Button>
			</HStack>

			<BodyLong>
				Applikasjoner som er detektert som prod/test-varianter av hverandre basert på Docker image eller navnemønster
				(f.eks. <code>app-name</code> og <code>app-name-q2</code>).
			</BodyLong>

			{/* Pending suggestions from link_suggestions table */}
			<VStack gap="space-6">
				<Heading size="large" level="3">
					Ventende forslag ({suggestions.length})
				</Heading>

				<HStack gap="space-4">
					<Form method="post">
						<input type="hidden" name="intent" value="refresh" />
						<Button type="submit" size="small" variant="secondary">
							Oppdater forslag
						</Button>
					</Form>
					{suggestions.length > 0 && (
						<Form method="post">
							<input type="hidden" name="intent" value="bulkAccept" />
							<input type="hidden" name="minConfidence" value="0.9" />
							<Button type="submit" size="small" variant="primary" icon={<LinkIcon aria-hidden />}>
								Godkjenn alle med høy sikkerhet
							</Button>
						</Form>
					)}
				</HStack>

				{groups.length === 0 ? (
					<Alert variant="info">Ingen ventende koblingsforslag.</Alert>
				) : (
					<VStack gap="space-8">
						{groups.map((group) => (
							<VStack key={group.baseName} gap="space-4">
								<Heading size="small" level="4">
									{group.baseName}
									{group.appIds.length > 2 && ` (${group.appIds.length} applikasjoner)`}
								</Heading>
								<Form method="post">
									<input type="hidden" name="intent" value="createParent" />
									<input type="hidden" name="parentName" value={group.baseName} />
									{group.appIds.map((id) => (
										<input key={id} type="hidden" name="appId" value={id} />
									))}
									<HStack gap="space-4" align="end" wrap>
										<Select label="Hovedapplikasjon" name="primaryAppId" size="small">
											<option value="">Opprett ny «{group.baseName}»</option>
											{group.appIds.map((id) => (
												<option key={id} value={id}>
													{group.appNames[id]}
												</option>
											))}
										</Select>
										<Button type="submit" size="small" variant="primary" icon={<LinkIcon aria-hidden />}>
											Koble {group.appIds.length} applikasjoner
										</Button>
									</HStack>
								</Form>
								{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
								<section className="table-scroll" tabIndex={0} aria-label={`Forslag for ${group.baseName}`}>
									<Table size="small">
										<Table.Header>
											<Table.Row>
												<Table.HeaderCell scope="col">Primær (prod)</Table.HeaderCell>
												<Table.HeaderCell scope="col">Sekundær (test)</Table.HeaderCell>
												<Table.HeaderCell scope="col">Matchtype</Table.HeaderCell>
												<Table.HeaderCell scope="col">Sikkerhet</Table.HeaderCell>
												<Table.HeaderCell scope="col" />
											</Table.Row>
										</Table.Header>
										<Table.Body>
											{group.suggestions.map((s) => {
												const matchInfo = matchTypeLabels[s.matchType] ?? {
													label: s.matchType,
													variant: "neutral" as const,
												}
												return (
													<Table.Row key={s.id}>
														<Table.DataCell>
															<Link to={`/applikasjoner/${s.primaryAppId}/detaljer`}>{s.primaryAppName}</Link>
														</Table.DataCell>
														<Table.DataCell>
															<Link to={`/applikasjoner/${s.secondaryAppId}/detaljer`}>{s.secondaryAppName}</Link>
														</Table.DataCell>
														<Table.DataCell>
															<Tag variant={matchInfo.variant} size="xsmall">
																{matchInfo.label}
															</Tag>
														</Table.DataCell>
														<Table.DataCell>
															<BodyShort size="small">{Math.round(Number(s.confidence) * 100)}%</BodyShort>
														</Table.DataCell>
														<Table.DataCell>
															<HStack gap="space-2">
																<Form method="post">
																	<input type="hidden" name="intent" value="accept" />
																	<input type="hidden" name="suggestionId" value={s.id} />
																	<Button type="submit" size="xsmall" variant="primary">
																		Godkjenn
																	</Button>
																</Form>
																<Form method="post">
																	<input type="hidden" name="intent" value="reject" />
																	<input type="hidden" name="suggestionId" value={s.id} />
																	<Button type="submit" size="xsmall" variant="tertiary-neutral">
																		Avvis
																	</Button>
																</Form>
															</HStack>
														</Table.DataCell>
													</Table.Row>
												)
											})}
										</Table.Body>
									</Table>
								</section>
							</VStack>
						))}
					</VStack>
				)}
			</VStack>

			{/* Link candidates based on Docker image / name pattern matching */}
			{linkCandidates.length > 0 && (
				<VStack gap="space-6">
					<Heading size="large" level="3">
						Mulige koblinger ({linkCandidates.length})
					</Heading>
					<Alert variant="info" size="small">
						Disse applikasjonene har blitt identifisert som mulige paraply-koblinger basert på felles Docker-image eller
						navnemønster.
					</Alert>
					<VStack gap="space-4">
						{linkCandidates.map((candidate) => {
							const prodApp = candidate.apps.find((a) => a.isProd) ?? candidate.apps[0]
							const otherApps = candidate.apps.filter((a) => a.id !== prodApp.id)
							const unlinkedApps = otherApps.filter((a) => !a.alreadyLinked)
							return (
								<div
									key={candidate.apps.map((a) => a.id).join(",")}
									style={{
										border: "1px solid var(--ax-border-default)",
										borderRadius: "var(--ax-border-radius-medium)",
										padding: "var(--ax-space-4)",
									}}
								>
									<VStack gap="space-2">
										<HStack gap="space-4" align="center" wrap>
											<Heading size="small" level="4">
												<AkselLink as={Link} to={`/applikasjoner/${prodApp.id}/detaljer`}>
													{prodApp.name}
												</AkselLink>
											</Heading>
											<Tag
												variant={
													candidate.matchType === "both"
														? "success"
														: candidate.matchType === "image_match"
															? "info"
															: "warning"
												}
												size="xsmall"
											>
												{candidate.matchType === "both"
													? "Image + navnemønster"
													: candidate.matchType === "image_match"
														? "Felles image"
														: "Navnemønster"}
											</Tag>
											<Tag variant="neutral" size="xsmall">
												{Math.round(candidate.confidence * 100)}% sannsynlighet
											</Tag>
											{unlinkedApps.length > 0 && (
												<Form method="post">
													<input type="hidden" name="intent" value="link-all-apps" />
													<input type="hidden" name="parentId" value={prodApp.id} />
													{unlinkedApps.map((app) => (
														<input key={app.id} type="hidden" name="childId" value={app.id} />
													))}
													<Button variant="tertiary" size="xsmall" type="submit">
														Koble alle ({unlinkedApps.length})
													</Button>
												</Form>
											)}
										</HStack>
										<BodyShort size="small">Mulige koblinger ({otherApps.length}):</BodyShort>
										{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
										<section className="table-scroll" tabIndex={0} aria-label="Koblingsforslag">
											<Table size="small">
												<Table.Header>
													<Table.Row>
														<Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
														<Table.HeaderCell scope="col">Miljø</Table.HeaderCell>
														<Table.HeaderCell scope="col">Status</Table.HeaderCell>
														<Table.HeaderCell scope="col" />
													</Table.Row>
												</Table.Header>
												<Table.Body>
													{otherApps.map((app) => (
														<Table.Row key={app.id}>
															<Table.DataCell>
																<AkselLink as={Link} to={`/applikasjoner/${app.id}/detaljer`}>
																	{app.name}
																</AkselLink>
															</Table.DataCell>
															<Table.DataCell>
																<Tag variant="info" size="xsmall">
																	{app.cluster}
																</Tag>
															</Table.DataCell>
															<Table.DataCell>
																{app.alreadyLinked ? (
																	<Tag variant="success" size="xsmall">
																		Allerede koblet
																	</Tag>
																) : (
																	<Tag variant="warning" size="xsmall">
																		Ikke koblet
																	</Tag>
																)}
															</Table.DataCell>
															<Table.DataCell>
																{!app.alreadyLinked && (
																	<Form method="post">
																		<input type="hidden" name="intent" value="link-app" />
																		<input type="hidden" name="childId" value={app.id} />
																		<input type="hidden" name="parentId" value={prodApp.id} />
																		<Button variant="tertiary" size="xsmall" type="submit">
																			Koble
																		</Button>
																	</Form>
																)}
															</Table.DataCell>
														</Table.Row>
													))}
												</Table.Body>
											</Table>
										</section>
									</VStack>
								</div>
							)
						})}
					</VStack>
				</VStack>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
