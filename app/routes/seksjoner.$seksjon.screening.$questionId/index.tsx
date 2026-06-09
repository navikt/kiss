import { BodyShort, Box, Button, Heading, HStack, ReadMore, Table, Tag, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getChoiceEffects, getChoicesForQuestion, getScreeningQuestion } from "~/db/queries/screening.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { screeningEffectLabels, screeningQuestionStatusConfig } from "~/db/schema/screening"
import { getAuthenticatedUser } from "~/lib/auth.server"
import { hasAnySectionRole } from "~/lib/authorization.server"
import { getStatusLabel } from "~/lib/compliance-status"
import { renderMarkdown } from "~/lib/markdown.server"
import { requireUuid } from "~/lib/utils"

const answerTypeLabels: Record<string, string> = {
	boolean: "Ja/Nei",
	single_choice: "Egendefinerte valg",
	persistence: "Persistens",
	entra_id_groups: "Entra ID-grupper",
	ruleset: "Regelsett",
	economy_system: "Økonomisystem",
}

export async function loader({ request, params }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)

	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })

	const section = await getSectionBySlug(seksjon)
	if (!section) throw new Response("Seksjon ikke funnet", { status: 404 })

	const questionId = requireUuid(params.questionId, "questionId")

	const question = await getScreeningQuestion(questionId)
	if (!question) throw new Response("Spørsmål ikke funnet", { status: 404 })
	if (question.sectionId !== section.id) throw new Response("Spørsmålet tilhører ikke denne seksjonen", { status: 403 })

	const canEdit = user ? hasAnySectionRole(user, section.id) : false

	// Only show archived questions to users with edit access
	if (question.archivedAt && !canEdit) throw new Response("Spørsmål ikke funnet", { status: 404 })

	const choices = await getChoicesForQuestion(questionId)
	const choicesWithEffects = await Promise.all(
		choices.map(async (c) => {
			const effects = await getChoiceEffects(c.id)
			return { ...c, effects }
		}),
	)

	return data({
		question: {
			...question,
			descriptionHtml: renderMarkdown(question.description),
		},
		choices: choicesWithEffects,
		seksjon,
		sectionName: section.name,
		canEdit,
	})
}

export default function ScreeningQuestionView() {
	const { question, choices, seksjon, sectionName, canEdit } = useLoaderData<typeof loader>()

	const returnPath = `/seksjoner/${seksjon}/screening`
	const editPath = `${returnPath}/${question.id}/rediger`

	const isArchived = !!question.archivedAt
	const effectiveStatus = isArchived ? "archived" : question.status
	const statusCfg = screeningQuestionStatusConfig[effectiveStatus]
	const descriptionHtml = question.descriptionHtml ?? ""

	return (
		<VStack gap="space-8">
			<VStack gap="space-2">
				<BodyShort size="small">
					<Link to={returnPath}>← Innledende spørsmål — {sectionName}</Link>
				</BodyShort>
				<HStack justify="space-between" align="start" wrap gap="space-4">
					<HStack gap="space-4" align="center" wrap>
						<Heading size="xlarge" level="2">
							{question.questionText}
						</Heading>
						<Tag variant={statusCfg?.variant ?? "neutral"} size="small">
							{statusCfg?.label ?? effectiveStatus}
						</Tag>
					</HStack>
					{canEdit && !isArchived && (
						<Button as={Link} to={editPath} size="small" variant="secondary">
							Rediger
						</Button>
					)}
				</HStack>
			</VStack>

			<Box padding="space-8" borderWidth="1" borderColor="neutral-subtle" borderRadius="8">
				<VStack gap="space-6">
					<VStack gap="space-1">
						<BodyShort size="small" textColor="subtle">
							Svartype
						</BodyShort>
						<BodyShort>{answerTypeLabels[question.answerType] ?? question.answerType}</BodyShort>
					</VStack>

					{question.description && (
						<VStack gap="space-1">
							<BodyShort size="small" textColor="subtle">
								Beskrivelse
							</BodyShort>
							<ReadMore header="Vis beskrivelse" defaultOpen size="small">
								{/* biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized with DOMPurify */}
								<div className="markdown-content" dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
							</ReadMore>
						</VStack>
					)}

					{choices.length > 0 && (
						<VStack gap="space-2">
							<BodyShort size="small" textColor="subtle">
								Valgmuligheter
							</BodyShort>
							<HStack gap="space-4" wrap>
								{choices.map((c) => (
									<HStack key={c.id} gap="space-2" align="center">
										<Tag variant="alt3" size="small">
											{c.label}
										</Tag>
										{c.requiresComment && (
											<Tag variant="neutral" size="xsmall">
												Kommentar påkrevd
											</Tag>
										)}
										{c.requiresLink && (
											<Tag variant="neutral" size="xsmall">
												Lenke påkrevd
											</Tag>
										)}
									</HStack>
								))}
							</HStack>
						</VStack>
					)}

					{choices.some((c) => c.effects.length > 0) && (
						<VStack gap="space-2">
							<BodyShort size="small" textColor="subtle">
								Effekter
							</BodyShort>
							<Table size="small">
								<Table.Header>
									<Table.Row>
										<Table.HeaderCell scope="col">Valg</Table.HeaderCell>
										<Table.HeaderCell scope="col">Kontroll</Table.HeaderCell>
										<Table.HeaderCell scope="col">Effekt</Table.HeaderCell>
										{choices.some((c) => c.effects.some((e) => e.comment)) && (
											<Table.HeaderCell scope="col">Kommentar</Table.HeaderCell>
										)}
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{choices.flatMap((c) =>
										c.effects.map((e) => (
											<Table.Row key={e.id}>
												<Table.DataCell>
													<Tag variant="alt3" size="xsmall">
														{c.label}
													</Tag>
												</Table.DataCell>
												<Table.DataCell>
													<Tag variant="info" size="xsmall">
														{e.controlTextId}
														{e.controlName ? ` – ${e.controlName}` : ""}
													</Tag>
												</Table.DataCell>
												<Table.DataCell>
													{e.effect ? (
														<Tag variant="neutral" size="xsmall">
															{screeningEffectLabels[e.effect] ?? getStatusLabel(e.effect)}
														</Tag>
													) : (
														<BodyShort size="small" textColor="subtle">
															—
														</BodyShort>
													)}
												</Table.DataCell>
												{choices.some((c2) => c2.effects.some((e2) => e2.comment)) && (
													<Table.DataCell>
														<BodyShort size="small" textColor="subtle">
															{e.comment ?? "—"}
														</BodyShort>
													</Table.DataCell>
												)}
											</Table.Row>
										)),
									)}
								</Table.Body>
							</Table>
						</VStack>
					)}
				</VStack>
			</Box>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
