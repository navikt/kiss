import type { DragEndEvent } from "@dnd-kit/core"
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core"
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { DownloadIcon, PlusIcon } from "@navikt/aksel-icons"
import { Alert, BodyLong, Button, Heading, HStack, Modal, VStack } from "@navikt/ds-react"
import { useRef, useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, useFetcher, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { SortableQuestionCard } from "~/components/screening/SortableQuestionCard"
import {
	deleteScreeningQuestion,
	getChoiceEffects,
	getChoicesForQuestion,
	getSectionScreeningQuestions,
	reorderScreeningQuestions,
} from "~/db/queries/screening.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"
import { renderMarkdown } from "~/lib/markdown.server"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })

	const section = await getSectionBySlug(seksjon)
	if (!section) throw new Response("Seksjon ikke funnet", { status: 404 })

	const questions = await getSectionScreeningQuestions(section.id)

	const questionsWithEffects = await Promise.all(
		questions.map(async (q) => {
			const choices = await getChoicesForQuestion(q.id)
			const choicesWithEffects = await Promise.all(
				choices.map(async (c) => {
					const effects = await getChoiceEffects(c.id)
					return { ...c, effects }
				}),
			)
			return {
				...q,
				choices: choicesWithEffects,
				descriptionHtml: renderMarkdown(q.description),
			}
		}),
	)

	const screeningBasePath = `/seksjoner/${seksjon}/screening`

	return data({ questions: questionsWithEffects, seksjon, sectionName: section.name, screeningBasePath })
}

export async function action({ request, params }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const formData = await request.formData()
	const intent = formData.get("intent") as string

	if (intent === "deleteQuestion") {
		const questionId = formData.get("questionId") as string
		if (!questionId) throw new Response("Mangler ID", { status: 400 })
		await deleteScreeningQuestion(questionId, authedUser.navIdent)
	} else if (intent === "reorder") {
		const orderedIds = JSON.parse(formData.get("orderedIds") as string) as string[]
		if (!Array.isArray(orderedIds)) throw new Response("Ugyldig data", { status: 400 })
		await reorderScreeningQuestions(orderedIds, authedUser.navIdent)
	}

	return data({ success: true })
}

export default function SectionScreening() {
	const { questions: loaderQuestions, seksjon, sectionName, screeningBasePath } = useLoaderData<typeof loader>()
	const deleteModalRef = useRef<HTMLDialogElement>(null)
	const [deleteTarget, setDeleteTarget] = useState<{ id: string; text: string } | null>(null)
	const [questions, setQuestions] = useState(loaderQuestions)
	const fetcher = useFetcher()

	const sensors = useSensors(
		useSensor(PointerSensor),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	)

	function handleDragEnd(event: DragEndEvent) {
		const { active, over } = event
		if (!over || active.id === over.id) return

		const oldIndex = questions.findIndex((q) => q.id === active.id)
		const newIndex = questions.findIndex((q) => q.id === over.id)
		if (oldIndex === -1 || newIndex === -1) return

		const reordered = [...questions]
		const [moved] = reordered.splice(oldIndex, 1)
		reordered.splice(newIndex, 0, moved)
		setQuestions(reordered)

		fetcher.submit({ intent: "reorder", orderedIds: JSON.stringify(reordered.map((q) => q.id)) }, { method: "post" })
	}

	return (
		<VStack gap="space-12">
			<div>
				<HStack justify="space-between" align="center" wrap gap="space-4">
					<Heading size="xlarge" level="2">
						Innledende spørsmål — {sectionName}
					</Heading>
					<HStack gap="space-2">
						<Button
							as="a"
							href={`/api/seksjoner/${seksjon}/eksport?type=screening`}
							size="small"
							variant="tertiary"
							icon={<DownloadIcon aria-hidden />}
						>
							Eksporter
						</Button>
						<Button
							as={Link}
							to={`${screeningBasePath}/ny/rediger`}
							size="small"
							variant="secondary"
							icon={<PlusIcon aria-hidden />}
						>
							Nytt spørsmål
						</Button>
					</HStack>
				</HStack>
				<BodyLong>
					Definer spørsmål som vises før compliance-vurderingen. Svarene kan automatisk sette status på kontrollpunkter.
				</BodyLong>
			</div>

			{questions.length === 0 ? (
				<Alert variant="info">Ingen innledende spørsmål er definert ennå.</Alert>
			) : (
				<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
					<SortableContext items={questions.map((q) => q.id)} strategy={verticalListSortingStrategy}>
						<VStack gap="space-4">
							{questions.map((q, index) => (
								<SortableQuestionCard
									key={q.id}
									question={q}
									index={index}
									editPath={screeningBasePath}
									onDelete={() => {
										setDeleteTarget({ id: q.id, text: q.questionText })
										deleteModalRef.current?.showModal()
									}}
								/>
							))}
						</VStack>
					</SortableContext>
				</DndContext>
			)}

			<Modal ref={deleteModalRef} header={{ heading: "Slett spørsmål" }} onClose={() => setDeleteTarget(null)}>
				<Modal.Body>
					<BodyLong>
						Er du sikker på at du vil slette spørsmålet «{deleteTarget?.text}»? Dette kan ikke angres.
					</BodyLong>
				</Modal.Body>
				<Modal.Footer>
					<Form method="post" onSubmit={() => deleteModalRef.current?.close()}>
						<input type="hidden" name="intent" value="deleteQuestion" />
						<input type="hidden" name="questionId" value={deleteTarget?.id ?? ""} />
						<HStack gap="space-4">
							<Button type="button" size="small" variant="secondary" onClick={() => deleteModalRef.current?.close()}>
								Avbryt
							</Button>
							<Button type="submit" size="small" variant="danger">
								Slett spørsmål
							</Button>
						</HStack>
					</Form>
				</Modal.Footer>
			</Modal>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
