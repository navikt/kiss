import { PencilIcon, PlusIcon, TrashIcon } from "@navikt/aksel-icons"
import {
	Alert,
	BodyLong,
	BodyShort,
	Box,
	Button,
	Heading,
	HStack,
	ReadMore,
	Table,
	Tag,
	Textarea,
	TextField,
	VStack,
} from "@navikt/ds-react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, redirect, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import {
	createScreeningQuestion,
	deleteScreeningQuestion,
	getEffectsForQuestion,
	getScreeningQuestions,
} from "~/db/queries/screening.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"
import { renderMarkdown } from "~/lib/markdown.server"

const effectLabels: Record<string, string> = {
	not_relevant: "Ikke relevant",
	implemented: "Implementert",
	partially_implemented: "Delvis implementert",
	not_implemented: "Ikke implementert",
}

export async function loader({ request }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const questions = await getScreeningQuestions()

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

	return data({ questions: questionsWithEffects })
}

export async function action({ request }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const formData = await request.formData()
	const intent = formData.get("intent") as string

	if (intent === "createQuestion") {
		const questionText = formData.get("questionText") as string
		if (!questionText?.trim()) throw new Response("Spørsmålstekst mangler", { status: 400 })
		const q = await createScreeningQuestion(questionText.trim(), null, 0, authedUser.navIdent)
		return redirect(`/admin/screening/${q.id}/rediger`)
	} else if (intent === "deleteQuestion") {
		const questionId = formData.get("questionId") as string
		if (!questionId) throw new Response("Mangler ID", { status: 400 })
		await deleteScreeningQuestion(questionId, authedUser.navIdent)
	}

	return data({ success: true })
}

export default function AdminScreening() {
	const { questions } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-12">
			<div>
				<Heading size="xlarge" level="2">
					Innledende spørsmål
				</Heading>
				<BodyLong>
					Definer ja/nei-spørsmål som vises før compliance-vurderingen. Svarene kan automatisk sette status på
					kontrollpunkter.
				</BodyLong>
			</div>

			{/* Create new question */}
			<Box padding="space-12" borderWidth="1" borderColor="neutral-subtle" borderRadius="8" background="sunken">
				<Form method="post">
					<input type="hidden" name="intent" value="createQuestion" />
					<HStack gap="space-4" align="end" wrap>
						<TextField label="Nytt spørsmål" name="questionText" size="small" style={{ flex: 1, minWidth: "20rem" }} />
						<Button type="submit" size="small" variant="primary" icon={<PlusIcon aria-hidden />}>
							Legg til
						</Button>
					</HStack>
				</Form>
			</Box>

			{/* Questions list */}
			{questions.length === 0 ? (
				<Alert variant="info">Ingen innledende spørsmål er definert ennå.</Alert>
			) : (
				<VStack gap="space-8">
					{questions.map((q) => (
						<Box key={q.id} padding="space-12" borderWidth="1" borderColor="neutral-subtle" borderRadius="8">
							<VStack gap="space-6">
								{/* Header row */}
								<HStack justify="space-between" align="start" wrap gap="space-4">
									<HStack gap="space-4" align="center">
										<Tag variant="neutral" size="small">
											#{q.displayOrder}
										</Tag>
										<Heading size="small" level="3">
											{q.questionText}
										</Heading>
									</HStack>
									<HStack gap="space-2">
										<Button
											as={Link}
											to={`/admin/screening/${q.id}/rediger`}
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
								</HStack>

								{/* Description */}
								{q.descriptionHtml && (
									<ReadMore header="Beskrivelse" defaultOpen={false} size="small">
										{/* biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized with DOMPurify */}
										<div className="markdown-content" dangerouslySetInnerHTML={{ __html: q.descriptionHtml }} />
									</ReadMore>
								)}

								{/* Effects summary */}
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
