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
	Label,
	ReadMore,
	Select,
	Table,
	Tag,
	Textarea,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { useEffect, useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAllControls } from "~/db/queries/framework.server"
import {
	addEffect,
	createScreeningQuestion,
	deleteEffect,
	deleteScreeningQuestion,
	getEffectsForQuestion,
	getSectionScreeningQuestions,
	updateScreeningQuestion,
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
	const controls = await getAllControls()

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
		controls,
		canEdit,
	})
}

const effectLabels: Record<string, string> = {
	not_relevant: "Ikke relevant",
	implemented: "Implementert",
	partially_implemented: "Delvis implementert",
	not_implemented: "Ikke implementert",
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
	} else if (intent === "updateQuestion") {
		const questionId = formData.get("questionId") as string
		const questionText = formData.get("questionText") as string
		const description = (formData.get("description") as string)?.trim() || null
		const displayOrder = Number(formData.get("displayOrder") ?? 0)
		if (!questionId || !questionText?.trim()) throw new Response("Ugyldig data", { status: 400 })
		await updateScreeningQuestion(questionId, questionText.trim(), description, displayOrder, authedUser.navIdent)
	} else if (intent === "deleteQuestion") {
		const questionId = formData.get("questionId") as string
		if (!questionId) throw new Response("Mangler ID", { status: 400 })
		await deleteScreeningQuestion(questionId, authedUser.navIdent)
	} else if (intent === "addEffect") {
		const questionId = formData.get("questionId") as string
		const controlTextId = formData.get("controlTextId") as string
		const yesEffect = formData.get("yesEffect") as string
		const noEffect = formData.get("noEffect") as string
		const yesComment = formData.get("yesComment") as string
		const noComment = formData.get("noComment") as string
		if (!questionId || !controlTextId) throw new Response("Mangler data", { status: 400 })
		await addEffect({
			questionId,
			controlTextId,
			yesEffect: yesEffect || null,
			noEffect: noEffect || null,
			yesComment: yesComment || null,
			noComment: noComment || null,
		})
	} else if (intent === "deleteEffect") {
		const effectId = formData.get("effectId") as string
		if (!effectId) throw new Response("Mangler effect-ID", { status: 400 })
		await deleteEffect(effectId)
	}

	return data({ success: true })
}

export default function SectionScreening() {
	const { seksjon, seksjonName, questions, controls, canEdit } = useLoaderData<typeof loader>()

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
							<BodyShort size="small" textColor="subtle">
								Støtter **bold**, *kursiv*, - kulepunkter, [lenker](url)
							</BodyShort>
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
						<SectionQuestionCard key={q.id} question={q} controls={controls} canEdit={canEdit} />
					))}
				</VStack>
			)}
		</VStack>
	)
}

type QuestionData = {
	id: string
	questionText: string
	description: string | null
	descriptionHtml: string | null
	displayOrder: number
	effects: Array<{
		id: string
		controlTextId: string
		yesEffect: string | null
		noEffect: string | null
	}>
}

type ControlOption = { controlId: string }

function SectionQuestionCard({
	question: q,
	controls,
	canEdit,
}: {
	question: QuestionData
	controls: ControlOption[]
	canEdit: boolean
}) {
	const [editing, setEditing] = useState(false)

	return (
		<Box padding="space-12" borderWidth="1" borderColor="neutral-subtle" borderRadius="8">
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
					{canEdit && (
						<HStack gap="space-2">
							<Button
								size="xsmall"
								variant={editing ? "secondary" : "tertiary-neutral"}
								icon={<PencilIcon aria-hidden />}
								onClick={() => setEditing(!editing)}
							>
								{editing ? "Skjul redigering" : "Rediger"}
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

				{/* Description (collapsible when long) */}
				{q.descriptionHtml && (
					<ReadMore header="Beskrivelse" defaultOpen={false} size="small">
						{/* biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized server-side */}
						<div className="markdown-content" dangerouslySetInnerHTML={{ __html: q.descriptionHtml }} />
					</ReadMore>
				)}

				{/* Edit form (collapsible) */}
				{editing && canEdit && <SectionQuestionEditForm question={q} />}

				{/* Effects section */}
				<SectionEffectsSection questionId={q.id} effects={q.effects} controls={controls} canEdit={canEdit} />
			</VStack>
		</Box>
	)
}

function SectionQuestionEditForm({
	question,
}: {
	question: { id: string; questionText: string; description: string | null; displayOrder: number }
}) {
	const [descriptionPreview, setDescriptionPreview] = useState(question.description ?? "")

	return (
		<Box padding="space-8" borderWidth="1" borderColor="neutral-subtle" borderRadius="4" background="sunken">
			<Form method="post">
				<input type="hidden" name="intent" value="updateQuestion" />
				<input type="hidden" name="questionId" value={question.id} />
				<VStack gap="space-4">
					<HStack gap="space-4" align="end" wrap>
						<TextField
							label="Spørsmålstekst"
							name="questionText"
							size="small"
							defaultValue={question.questionText}
							style={{ flex: 1, minWidth: "20rem" }}
						/>
						<TextField
							label="Rekkefølge"
							name="displayOrder"
							size="small"
							type="number"
							defaultValue={String(question.displayOrder)}
							style={{ width: "6rem" }}
						/>
					</HStack>
					<HStack gap="space-4" align="start" style={{ flexWrap: "wrap" }}>
						<VStack gap="space-2" style={{ flex: 1, minWidth: "20rem" }}>
							<Textarea
								label="Beskrivelse (Markdown)"
								name="description"
								size="small"
								defaultValue={question.description ?? ""}
								minRows={3}
								onChange={(e) => setDescriptionPreview(e.target.value)}
							/>
							<BodyShort size="small" textColor="subtle">
								Støtter **bold**, *kursiv*, - kulepunkter, [lenker](url)
							</BodyShort>
						</VStack>
						{descriptionPreview && (
							<VStack style={{ flex: 1, minWidth: "20rem" }}>
								<Label size="small" spacing>
									Forhåndsvisning
								</Label>
								<MarkdownPreview content={descriptionPreview} />
							</VStack>
						)}
					</HStack>
					<div>
						<Button type="submit" size="small" variant="secondary">
							Oppdater
						</Button>
					</div>
				</VStack>
			</Form>
		</Box>
	)
}

function SectionEffectsSection({
	questionId,
	effects,
	controls,
	canEdit,
}: {
	questionId: string
	effects: QuestionData["effects"]
	controls: ControlOption[]
	canEdit: boolean
}) {
	return (
		<VStack gap="space-4">
			<HStack gap="space-2" align="center">
				<Heading size="xsmall" level="4">
					Effekter
				</Heading>
				<Tag variant="neutral" size="xsmall">
					{effects.length}
				</Tag>
			</HStack>

			{effects.length > 0 && (
				<Table size="small">
					<Table.Header>
						<Table.Row>
							<Table.HeaderCell scope="col">Kontroll</Table.HeaderCell>
							<Table.HeaderCell scope="col">Ja-effekt</Table.HeaderCell>
							<Table.HeaderCell scope="col">Nei-effekt</Table.HeaderCell>
							{canEdit && <Table.HeaderCell scope="col" />}
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{effects.map((e) => (
							<Table.Row key={e.id}>
								<Table.DataCell>
									<Tag variant="info" size="xsmall">
										{e.controlTextId}
									</Tag>
								</Table.DataCell>
								<Table.DataCell>
									{e.yesEffect ? (
										<Tag variant="neutral" size="xsmall">
											{effectLabels[e.yesEffect] ?? e.yesEffect}
										</Tag>
									) : (
										<BodyShort size="small" textColor="subtle">
											—
										</BodyShort>
									)}
								</Table.DataCell>
								<Table.DataCell>
									{e.noEffect ? (
										<Tag variant="neutral" size="xsmall">
											{effectLabels[e.noEffect] ?? e.noEffect}
										</Tag>
									) : (
										<BodyShort size="small" textColor="subtle">
											—
										</BodyShort>
									)}
								</Table.DataCell>
								{canEdit && (
									<Table.DataCell>
										<Form method="post">
											<input type="hidden" name="intent" value="deleteEffect" />
											<input type="hidden" name="effectId" value={e.id} />
											<Button type="submit" size="xsmall" variant="tertiary-neutral" icon={<TrashIcon aria-hidden />} />
										</Form>
									</Table.DataCell>
								)}
							</Table.Row>
						))}
					</Table.Body>
				</Table>
			)}

			{canEdit && (
				<Form method="post">
					<input type="hidden" name="intent" value="addEffect" />
					<input type="hidden" name="questionId" value={questionId} />
					<HStack gap="space-4" align="end" wrap>
						<Select label="Kontroll" name="controlTextId" size="small">
							<option value="">Velg kontroll</option>
							{controls.map((c) => (
								<option key={c.controlId} value={c.controlId}>
									{c.controlId}
								</option>
							))}
						</Select>
						<Select label="Ja-effekt" name="yesEffect" size="small">
							<option value="">Ingen</option>
							{Object.entries(effectLabels).map(([v, l]) => (
								<option key={v} value={v}>
									{l}
								</option>
							))}
						</Select>
						<Select label="Nei-effekt" name="noEffect" size="small">
							<option value="">Ingen</option>
							{Object.entries(effectLabels).map(([v, l]) => (
								<option key={v} value={v}>
									{l}
								</option>
							))}
						</Select>
						<Button type="submit" size="small" variant="secondary-neutral" icon={<PlusIcon aria-hidden />}>
							Legg til effekt
						</Button>
					</HStack>
				</Form>
			)}
		</VStack>
	)
}

function MarkdownPreview({ content }: { content: string }) {
	const [html, setHtml] = useState("")

	useEffect(() => {
		void renderPreview(content, setHtml)
	}, [content])

	return (
		<div
			className="markdown-content"
			style={{
				padding: "var(--ax-space-8)",
				border: "1px solid var(--ax-border-subtle)",
				borderRadius: "var(--ax-radius-4)",
				background: "var(--ax-bg-sunken)",
				minHeight: "4rem",
			}}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: client-side preview only
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	)
}

async function renderPreview(content: string, setHtml: (html: string) => void) {
	const { marked } = await import("marked")
	setHtml(marked.parse(content, { async: false }) as string)
}

export { RouteErrorBoundary as ErrorBoundary }
