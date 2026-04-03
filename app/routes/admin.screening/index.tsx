import type { DragEndEvent } from "@dnd-kit/core"
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core"
import {
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { DragVerticalIcon, PencilIcon, PlusIcon, TrashIcon } from "@navikt/aksel-icons"
import {
	Alert,
	BodyLong,
	BodyShort,
	Box,
	Button,
	Heading,
	HStack,
	Modal,
	ReadMore,
	Tag,
	VStack,
} from "@navikt/ds-react"
import { useRef, useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, useFetcher, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import {
	deleteScreeningQuestion,
	getEffectsForQuestion,
	getScreeningQuestions,
	reorderScreeningQuestions,
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

export default function AdminScreening() {
	const { questions: loaderQuestions } = useLoaderData<typeof loader>()
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
						Innledende spørsmål
					</Heading>
					<Button
						as={Link}
						to="/admin/screening/ny/rediger"
						size="small"
						variant="secondary"
						icon={<PlusIcon aria-hidden />}
					>
						Nytt spørsmål
					</Button>
				</HStack>
				<BodyLong>
					Definer ja/nei-spørsmål som vises før compliance-vurderingen. Svarene kan automatisk sette status på
					kontrollpunkter.
				</BodyLong>
			</div>

			{/* Questions list */}
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
			{/* Delete confirmation modal */}
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

type QuestionItem = {
	id: string
	questionText: string
	displayOrder: number
	descriptionHtml: string | null
	effects: { id: string; controlTextId: string }[]
}

function SortableQuestionCard({
	question: q,
	index,
	onDelete,
}: {
	question: QuestionItem
	index: number
	onDelete: () => void
}) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: q.id })

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
	}

	return (
		<Box
			ref={setNodeRef}
			style={style}
			padding="space-12"
			borderWidth="1"
			borderColor={isDragging ? "brand-blue-strong" : "neutral-subtle"}
			borderRadius="8"
		>
			<VStack gap="space-6">
				{/* Header row */}
				<HStack justify="space-between" align="start" wrap gap="space-4">
					<HStack gap="space-4" align="center">
						<button
							type="button"
							{...attributes}
							{...listeners}
							style={{
								cursor: isDragging ? "grabbing" : "grab",
								background: "none",
								border: "none",
								padding: "4px",
								display: "flex",
								alignItems: "center",
								color: "var(--ax-text-subtle)",
							}}
							aria-label={`Dra for å endre rekkefølge: ${q.questionText}`}
						>
							<DragVerticalIcon aria-hidden fontSize="1.25rem" />
						</button>
						<Tag variant="neutral" size="small">
							#{index + 1}
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
						<Button size="xsmall" variant="tertiary-neutral" icon={<TrashIcon aria-hidden />} onClick={onDelete}>
							Slett
						</Button>
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
	)
}

export { RouteErrorBoundary as ErrorBoundary }
