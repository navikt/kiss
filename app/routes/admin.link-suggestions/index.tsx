import { LinkIcon } from "@navikt/aksel-icons"
import { Alert, BodyLong, BodyShort, Button, Heading, HStack, Table, Tag, VStack } from "@navikt/ds-react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import {
	acceptLinkSuggestion,
	bulkAcceptLinkSuggestions,
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

	return data({ suggestions })
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
	const { suggestions } = useLoaderData<typeof loader>()

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

			{suggestions.length === 0 ? (
				<Alert variant="info">Ingen ventende koblingsforslag.</Alert>
			) : (
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
						{suggestions.map((s) => {
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
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
