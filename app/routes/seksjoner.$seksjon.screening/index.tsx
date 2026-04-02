import { PencilIcon, PlusIcon, TrashIcon } from "@navikt/aksel-icons"
import {
	Alert,
	BodyLong,
	BodyShort,
	Box,
	Button,
	Detail,
	Heading,
	HStack,
	ReadMore,
	Tag,
	Textarea,
	TextField,
	VStack,
} from "@navikt/ds-react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, useLoaderData } from "react-router"
import { MarkdownHint } from "~/components/MarkdownHint"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import {
	createScreeningQuestion,
	deleteScreeningQuestion,
	getEffectsForQuestion,
	getSectionScreeningQuestions,
} from "~/db/queries/screening.server"
import { getSectionDetail } from "~/db/queries/sections.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { isAdmin } from "~/lib/authorization.server"
import { renderMarkdown } from "~/lib/markdown.server"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })

	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	const canEdit = isAdmin(authedUser)

	const result = await getSectionDetail(seksjon)
	if (!result) throw new Response("Seksjon ikke funnet", { status: 404 })

	const questions = await getSectionScreeningQuestions(result.section.id)

	const questionsWithEffects = await Promise.all(
		questions.map(async (q) => {
			const effects = await getEffectsForQuestion(q.id)
			return {
				...q,
				effects,
				descriptionHtml: renderMarkdown(q.description),
			}
		}),
	)

	return data({
		seksjon,
		seksjonName: result.section.name,
		sectionId: result.section.id,
		questions: questionsWithEffects,
		canEdit,
	})
}

export async function action({ request, params }: ActionFunctionArgs) {
	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })

	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	if (!isAdmin(authedUser)) throw new Response("Ikke tilgang", { status: 403 })

	const result = await getSectionDetail(seksjon)
	if (!result) throw new Response("Seksjon ikke funnet", { status: 404 })

	const formData = await request.formData()
	const intent = formData.get("intent") as string

	if (intent === "createQuestion") {
		const questionText = formData.get("questionText") as string
		const description = (formData.get("description") as string)?.trim() || null
		const displayOrder = Number(formData.get("displayOrder") ?? 0)
		if (!questionText?.trim()) throw new Response("Spørsmålstekst mangler", { status: 400 })
		await createScreeningQuestion(
			questionText.trim(),
			description,
			displayOrder,
			authedUser.navIdent,
			result.section.id,
		)
	} else if (intent === "deleteQuestion") {
		const questionId = formData.get("questionId") as string
		if (!questionId) throw new Response("Mangler ID", { status: 400 })
		await deleteScreeningQuestion(questionId, authedUser.navIdent)
	}

	return data({ success: true })
}

export default function SectionScreening() {
	const { seksjon, seksjonName, questions, canEdit } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-12">
			<VStack gap="space-2">
				<Detail>
					<Link to={`/seksjoner/${seksjon}`}>← Tilbake til {seksjonName}</Link>
				</Detail>
				<Heading size="xlarge" level="2">
					Innledende spørsmål — {seksjonName}
				</Heading>
				<BodyLong>
					Definer ja/nei-spørsmål som gjelder spesifikt for denne seksjonen. Svarene kan automatisk sette status på
					kontrollpunkter for applikasjoner i seksjonen.
				</BodyLong>
			</VStack>

			{canEdit && (
				<Box padding="space-12" borderWidth="1" borderColor="neutral-subtle" borderRadius="8" background="sunken">
					<Form method="post">
						<input type="hidden" name="intent" value="createQuestion" />
						<VStack gap="space-4">
							<Heading size="small" level="3">
								Nytt spørsmål
							</Heading>
							<HStack gap="space-4" align="end" wrap>
								<TextField
									label="Spørsmålstekst"
									name="questionText"
									size="small"
									style={{ flex: 1, minWidth: "20rem" }}
								/>
								<TextField
									label="Rekkefølge"
									name="displayOrder"
									size="small"
									type="number"
									defaultValue="0"
									htmlSize={6}
								/>
							</HStack>
							<Textarea label="Beskrivelse (Markdown)" name="description" size="small" minRows={3} />
							<MarkdownHint />
							<div>
								<Button type="submit" size="small" variant="primary" icon={<PlusIcon aria-hidden />}>
									Legg til
								</Button>
							</div>
						</VStack>
					</Form>
				</Box>
			)}

			{questions.length === 0 ? (
				<Alert variant="info">Ingen innledende spørsmål er definert for denne seksjonen.</Alert>
			) : (
				<VStack gap="space-8">
					{questions.map((q) => (
						<Box key={q.id} padding="space-12" borderWidth="1" borderColor="neutral-subtle" borderRadius="8">
							<VStack gap="space-6">
								<HStack justify="space-between" align="start" wrap gap="space-4">
									<HStack gap="space-4" align="center">
										<Tag variant="neutral" size="small">
											#{q.displayOrder}
										</Tag>
										<Heading size="small" level="3">
											{q.questionText}
										</Heading>
									</HStack>
									{canEdit && (
										<HStack gap="space-2">
											<Button
												as={Link}
												to={`/seksjoner/${seksjon}/screening/${q.id}/rediger`}
												size="xsmall"
												variant="tertiary-neutral"
												icon={<PencilIcon aria-hidden />}
											>
												Rediger
											</Button>
											<Form method="post">
												<input type="hidden" name="intent" value="deleteQuestion" />
												<input type="hidden" name="questionId" value={q.id} />
												<Button type="submit" size="xsmall" variant="tertiary-neutral" icon={<TrashIcon aria-hidden />}>
													Slett
												</Button>
											</Form>
										</HStack>
									)}
								</HStack>

								{q.descriptionHtml && (
									<ReadMore header="Beskrivelse" defaultOpen={false} size="small">
										{/* biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized server-side */}
										<div className="markdown-content" dangerouslySetInnerHTML={{ __html: q.descriptionHtml }} />
									</ReadMore>
								)}

								{q.effects.length > 0 && (
									<HStack gap="space-2" align="center" wrap>
										<BodyShort size="small" textColor="subtle">
											Effekter:
										</BodyShort>
										{q.effects.map((e) => (
											<Tag key={e.id} variant="info" size="xsmall">
												{e.controlTextId}
											</Tag>
										))}
									</HStack>
								)}
							</VStack>
						</Box>
					))}
				</VStack>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
