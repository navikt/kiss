import type { DragEndEvent } from "@dnd-kit/core"
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core"
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { DownloadIcon, PlusIcon } from "@navikt/aksel-icons"
import { Alert, BodyLong, Button, Chips, Heading, HStack, Modal, VStack } from "@navikt/ds-react"
import { useEffect, useRef, useState } from "react"
import { data, Form, Link, useFetcher, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { SortableQuestionCard } from "~/components/screening/SortableQuestionCard"
import {
	archiveScreeningQuestion,
	getChoiceEffects,
	getChoicesForQuestion,
	getScreeningQuestion,
	getScreeningQuestionsByIds,
	getSectionScreeningQuestions,
	reorderScreeningQuestions,
	unarchiveScreeningQuestion,
} from "~/db/queries/screening.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { screeningQuestionStatusConfig } from "~/db/schema/screening"
import { getAuthenticatedUser, requireAuthenticatedUser } from "~/lib/auth.server"
import { hasAnySectionRole, requireAnySectionRole } from "~/lib/authorization.server"
import { renderMarkdown } from "~/lib/markdown.server"
import { requireUuid } from "~/lib/utils"
import type { Route } from "./+types/index"

export async function loader({ request, params }: Route.LoaderArgs) {
	const user = await getAuthenticatedUser(request)

	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })

	const section = await getSectionBySlug(seksjon)
	if (!section) throw new Response("Seksjon ikke funnet", { status: 404 })

	const canEdit = user ? hasAnySectionRole(user, section.id) : false

	const questions = await getSectionScreeningQuestions(section.id, { includeArchived: canEdit })

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

	return data({ questions: questionsWithEffects, seksjon, sectionName: section.name, screeningBasePath, canEdit })
}

export async function action({ request, params }: Route.ActionArgs) {
	const authedUser = await requireAuthenticatedUser(request)

	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })
	const section = await getSectionBySlug(seksjon)
	if (!section) throw new Response("Seksjon ikke funnet", { status: 404 })
	requireAnySectionRole(authedUser, section.id)

	const formData = await request.formData()
	const intent = formData.get("intent") as string

	switch (intent) {
		case "archiveQuestion": {
			const questionId = requireUuid(formData.get("questionId"), "questionId")
			const question = await getScreeningQuestion(questionId)
			if (!question || question.sectionId !== section.id)
				throw new Response("Spørsmålet tilhører ikke denne seksjonen", { status: 403 })
			await archiveScreeningQuestion(questionId, authedUser.navIdent)
			break
		}
		case "unarchiveQuestion": {
			const questionId = requireUuid(formData.get("questionId"), "questionId")
			const question = await getScreeningQuestion(questionId)
			if (!question || question.sectionId !== section.id)
				throw new Response("Spørsmålet tilhører ikke denne seksjonen", { status: 403 })
			await unarchiveScreeningQuestion(questionId, authedUser.navIdent)
			break
		}
		case "reorder": {
			let orderedIds: string[]
			try {
				orderedIds = JSON.parse(formData.get("orderedIds") as string) as string[]
			} catch {
				throw new Response("Ugyldig JSON i orderedIds", { status: 400 })
			}
			if (!Array.isArray(orderedIds)) throw new Response("Ugyldig data", { status: 400 })
			if (new Set(orderedIds).size !== orderedIds.length)
				throw new Response("orderedIds inneholder duplikate IDer", { status: 400 })
			for (const id of orderedIds) requireUuid(id, "orderedIds-element")
			const questions = await getScreeningQuestionsByIds(orderedIds)
			if (questions.length !== orderedIds.length)
				throw new Response("Noen spørsmåls-IDer ble ikke funnet", { status: 400 })
			if (questions.some((q) => q.sectionId !== section.id))
				throw new Response("Noen spørsmål tilhører ikke denne seksjonen", { status: 403 })
			const allSectionQuestions = await getSectionScreeningQuestions(section.id, { includeArchived: true })
			if (orderedIds.length !== allSectionQuestions.length)
				throw new Response("orderedIds må inneholde alle spørsmål i seksjonen", { status: 400 })
			await reorderScreeningQuestions(orderedIds, authedUser.navIdent)
			break
		}
		default:
			throw new Response(`Ukjent intent: ${intent}`, { status: 400 })
	}

	return data({ success: true })
}

export default function SectionScreening() {
	const {
		questions: loaderQuestions,
		seksjon,
		sectionName,
		screeningBasePath,
		canEdit,
	} = useLoaderData<typeof loader>()
	const deleteModalRef = useRef<HTMLDialogElement>(null)
	const [deleteTarget, setDeleteTarget] = useState<{ id: string; text: string } | null>(null)
	const [questions, setQuestions] = useState(loaderQuestions)
	const [answerTypeFilter, setAnswerTypeFilter] = useState<string[]>([])
	const [statusFilter, setStatusFilter] = useState<string[]>([])
	const fetcher = useFetcher()

	useEffect(() => {
		setQuestions(loaderQuestions)
	}, [loaderQuestions])

	const answerTypeLabels: Record<string, string> = {
		boolean: "Ja/Nei",
		single_choice: "Egendefinerte valg",
		persistence: "Persistens",
		entra_id_groups: "Entra ID-grupper",
		ruleset: "Regelsett",
	}

	const availableTypes = [...new Set(questions.map((q) => q.answerType))].sort()
	const getEffectiveStatus = (q: (typeof questions)[number]) => (q.archivedAt ? "archived" : q.status)
	const availableStatuses = [...new Set(questions.map(getEffectiveStatus))].sort()
	const filteredQuestions = questions.filter((q) => {
		if (answerTypeFilter.length > 0 && !answerTypeFilter.includes(q.answerType)) return false
		if (statusFilter.length > 0 && !statusFilter.includes(getEffectiveStatus(q))) return false
		return true
	})

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
						{canEdit && (
							<Button
								as={Link}
								to={`${screeningBasePath}/ny/rediger`}
								size="small"
								variant="secondary"
								icon={<PlusIcon aria-hidden />}
							>
								Nytt spørsmål
							</Button>
						)}
					</HStack>
				</HStack>
				<BodyLong>
					Definer spørsmål som vises før compliance-vurderingen. Svarene kan automatisk sette status på kontrollpunkter.
				</BodyLong>
			</div>

			{availableTypes.length > 1 && (
				<Chips size="small">
					{availableTypes.map((type) => (
						<Chips.Toggle
							key={type}
							selected={answerTypeFilter.includes(type)}
							onClick={() =>
								setAnswerTypeFilter((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]))
							}
						>
							{answerTypeLabels[type] ?? type}
						</Chips.Toggle>
					))}
				</Chips>
			)}

			{availableStatuses.length > 1 && (
				<Chips size="small">
					{availableStatuses.map((s) => (
						<Chips.Toggle
							key={s}
							selected={statusFilter.includes(s)}
							onClick={() => setStatusFilter((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))}
						>
							{screeningQuestionStatusConfig[s as keyof typeof screeningQuestionStatusConfig]?.label ?? s}
						</Chips.Toggle>
					))}
				</Chips>
			)}

			{filteredQuestions.length === 0 ? (
				<Alert variant="info">Ingen innledende spørsmål er definert ennå.</Alert>
			) : (
				<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
					<SortableContext items={filteredQuestions.map((q) => q.id)} strategy={verticalListSortingStrategy}>
						<VStack gap="space-4">
							{filteredQuestions.map((q, index) => (
								<SortableQuestionCard
									key={q.id}
									question={q}
									index={index}
									editPath={screeningBasePath}
									detailBasePath={screeningBasePath}
									canEdit={canEdit}
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

			<Modal ref={deleteModalRef} header={{ heading: "Arkiver spørsmål" }} onClose={() => setDeleteTarget(null)}>
				<Modal.Body>
					<BodyLong>
						Er du sikker på at du vil arkivere spørsmålet «{deleteTarget?.text}»? Spørsmålet vil ikke lenger vises i
						compliance-vurderingen, men kan reaktiveres senere. Eksisterende svar bevares.
					</BodyLong>
				</Modal.Body>
				<Modal.Footer>
					<Form method="post" onSubmit={() => deleteModalRef.current?.close()}>
						<input type="hidden" name="intent" value="archiveQuestion" />
						<input type="hidden" name="questionId" value={deleteTarget?.id ?? ""} />
						<HStack gap="space-4">
							<Button type="button" size="small" variant="secondary" onClick={() => deleteModalRef.current?.close()}>
								Avbryt
							</Button>
							<Button type="submit" size="small" variant="danger">
								Arkiver spørsmål
							</Button>
						</HStack>
					</Form>
				</Modal.Footer>
			</Modal>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
