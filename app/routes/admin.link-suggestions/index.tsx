import { LinkIcon } from "@navikt/aksel-icons"
import { Alert, BodyLong, BodyShort, Button, Heading, HStack, Table, Tag, VStack } from "@navikt/ds-react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import {
	acceptLinkSuggestion,
	bulkAcceptLinkSuggestions,
	createParentAndLinkGroup,
	extractBaseName,
	findLinkCandidates,
	getPendingLinkSuggestions,
	persistLinkSuggestions,
	rejectLinkSuggestion,
} from "~/db/queries/nais.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"

export async function loader({ request }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const suggestions = await getPendingLinkSuggestions()

	// Group suggestions by base name to enable "create parent" action
	const groupMap = new Map<string, SuggestionGroup>()
	for (const s of suggestions) {
		const baseName = extractBaseName(s.primaryAppName) ?? extractBaseName(s.secondaryAppName) ?? s.primaryAppName
		let group = groupMap.get(baseName)
		if (!group) {
			group = { baseName, appIds: new Set(), appNames: new Map(), suggestions: [] }
			groupMap.set(baseName, group)
		}
		group.appIds.add(s.primaryAppId)
		group.appIds.add(s.secondaryAppId)
		group.appNames.set(s.primaryAppId, s.primaryAppName)
		group.appNames.set(s.secondaryAppId, s.secondaryAppName)
		group.suggestions.push(s)
	}

	const groups = [...groupMap.values()].map((g) => ({
		baseName: g.baseName,
		appIds: [...g.appIds],
		appNames: Object.fromEntries(g.appNames),
		suggestions: g.suggestions,
	}))

	return data({ suggestions, groups })
}

interface SuggestionGroup {
	baseName: string
	appIds: Set<string>
	appNames: Map<string, string>
	suggestions: typeof getPendingLinkSuggestions extends () => Promise<infer R> ? R : never
}

const matchTypeLabels: Record<string, { label: string; variant: "info" | "success" | "warning" }> = {
	both: { label: "Image + navn", variant: "success" },
	image_match: { label: "Docker image", variant: "info" },
	name_pattern: { label: "Navnemønster", variant: "warning" },
}

export async function action({ request }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const formData = await request.formData()
	const intent = formData.get("intent") as string

	if (intent === "accept") {
		const suggestionId = formData.get("suggestionId") as string
		await acceptLinkSuggestion(suggestionId, authedUser.navIdent)
	} else if (intent === "reject") {
		const suggestionId = formData.get("suggestionId") as string
		await rejectLinkSuggestion(suggestionId, authedUser.navIdent)
	} else if (intent === "createParent") {
		const parentName = formData.get("parentName") as string
		const appIds = formData.getAll("appId") as string[]
		if (parentName && appIds.length > 0) {
			await createParentAndLinkGroup(parentName, appIds, authedUser.navIdent)
			return data({ success: true, message: `${parentName} opprettet med ${appIds.length} varianter` })
		}
	} else if (intent === "bulkAccept") {
		const minConfidence = Number(formData.get("minConfidence") ?? 0.9)
		const count = await bulkAcceptLinkSuggestions(minConfidence, authedUser.navIdent)
		return data({ success: true, message: `${count} koblinger godkjent` })
	} else if (intent === "refresh") {
		const candidates = await findLinkCandidates()
		const created = await persistLinkSuggestions(candidates)
		return data({ success: true, message: `${created} nye forslag opprettet` })
	}

	return data({ success: true })
}

export default function AdminLinkSuggestions() {
	const { suggestions, groups } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-12">
			<div>
				<Heading size="xlarge" level="2">
					Foreslåtte koblinger
				</Heading>
				<BodyLong>
					Applikasjoner som er detektert som prod/test-varianter av hverandre basert på Docker image eller navnemønster
					(f.eks. <code>app-name</code> og <code>app-name-q2</code>).
				</BodyLong>
			</div>

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
							<HStack gap="space-4" align="center">
								<Heading size="small" level="3">
									{group.baseName}
								</Heading>
								<Form method="post">
									<input type="hidden" name="intent" value="createParent" />
									<input type="hidden" name="parentName" value={group.baseName} />
									{group.appIds.map((id) => (
										<input key={id} type="hidden" name="appId" value={id} />
									))}
									<Button type="submit" size="xsmall" variant="primary" icon={<LinkIcon aria-hidden />}>
										Opprett «{group.baseName}» og koble {group.appIds.length} varianter
									</Button>
								</Form>
							</HStack>
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
						</VStack>
					))}
				</VStack>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
