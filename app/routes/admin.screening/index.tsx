import { PlusIcon, TrashIcon } from "@navikt/aksel-icons"
import {
	Alert,
	BodyLong,
	BodyShort,
	Button,
	Heading,
	HStack,
	Select,
	Table,
	Tag,
	Textarea,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { useEffect, useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAllControls } from "~/db/queries/framework.server"
import {
	addEffect,
	createScreeningQuestion,
	deleteEffect,
	deleteScreeningQuestion,
	getEffectsForQuestion,
	getScreeningQuestions,
	updateScreeningQuestion,
} from "~/db/queries/screening.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"
import { renderMarkdown } from "~/lib/markdown.server"

export async function loader({ request }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const questions = await getScreeningQuestions()
	const controls = await getAllControls()

	// Load effects for each question
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

	return data({ questions: questionsWithEffects, controls })
}

const effectLabels: Record<string, string> = {
	not_relevant: "Ikke relevant",
	implemented: "Implementert",
	partially_implemented: "Delvis implementert",
	not_implemented: "Ikke implementert",
}

export async function action({ request }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const formData = await request.formData()
	const intent = formData.get("intent") as string

	if (intent === "createQuestion") {
		const questionText = formData.get("questionText") as string
		const description = (formData.get("description") as string)?.trim() || null
		const displayOrder = Number(formData.get("displayOrder") ?? 0)
		if (!questionText?.trim()) throw new Response("Spørsmålstekst mangler", { status: 400 })
		await createScreeningQuestion(questionText.trim(), description, displayOrder, authedUser.navIdent)
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

export default function AdminScreening() {
	const { questions, controls } = useLoaderData<typeof loader>()

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
			<Form method="post">
				<input type="hidden" name="intent" value="createQuestion" />
				<VStack gap="space-4">
					<Heading size="medium" level="3">
						Nytt spørsmål
					</Heading>
					<HStack gap="space-4" align="end" wrap>
						<TextField label="Spørsmålstekst" name="questionText" size="small" style={{ minWidth: "20rem" }} />
						<TextField
							label="Rekkefølge"
							name="displayOrder"
							size="small"
							type="number"
							defaultValue="0"
							style={{ width: "6rem" }}
						/>
					</HStack>
					<Textarea
						label="Beskrivelse (Markdown)"
						name="description"
						size="small"
						description="Støtter **bold**, *kursiv*, - kulepunkter, [lenker](url)"
						minRows={3}
					/>
					<div>
						<Button type="submit" size="small" variant="primary" icon={<PlusIcon aria-hidden />}>
							Legg til
						</Button>
					</div>
				</VStack>
			</Form>

			{/* Questions list */}
			{questions.length === 0 ? (
				<Alert variant="info">Ingen innledende spørsmål er definert ennå.</Alert>
			) : (
				<VStack gap="space-12">
					{questions.map((q) => (
						<VStack
							key={q.id}
							gap="space-6"
							style={{
								padding: "var(--ax-space-16)",
								border: "1px solid var(--ax-border-subtle)",
								borderRadius: "var(--ax-radius-8)",
							}}
						>
							{/* Question header + edit */}
							<HStack justify="space-between" align="start" wrap>
								<VStack gap="space-2" style={{ flex: 1 }}>
									<Heading size="small" level="3">
										{q.questionText}
									</Heading>
									{q.descriptionHtml && (
										// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized with DOMPurify
										<div className="markdown-content" dangerouslySetInnerHTML={{ __html: q.descriptionHtml }} />
									)}
									<BodyShort size="small" textColor="subtle">
										Rekkefølge: {q.displayOrder}
									</BodyShort>
								</VStack>
								<Form method="post">
									<input type="hidden" name="intent" value="deleteQuestion" />
									<input type="hidden" name="questionId" value={q.id} />
									<Button type="submit" size="xsmall" variant="tertiary-neutral" icon={<TrashIcon aria-hidden />}>
										Slett
									</Button>
								</Form>
							</HStack>

							{/* Edit question */}
							<QuestionEditForm question={q} />

							{/* Effects */}
							<VStack gap="space-4">
								<Heading size="xsmall" level="4">
									Effekter ({q.effects.length})
								</Heading>

								{q.effects.length > 0 && (
									<Table size="small">
										<Table.Header>
											<Table.Row>
												<Table.HeaderCell scope="col">Kontroll</Table.HeaderCell>
												<Table.HeaderCell scope="col">Ja-effekt</Table.HeaderCell>
												<Table.HeaderCell scope="col">Nei-effekt</Table.HeaderCell>
												<Table.HeaderCell scope="col" />
											</Table.Row>
										</Table.Header>
										<Table.Body>
											{q.effects.map((e) => (
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
													<Table.DataCell>
														<Form method="post">
															<input type="hidden" name="intent" value="deleteEffect" />
															<input type="hidden" name="effectId" value={e.id} />
															<Button
																type="submit"
																size="xsmall"
																variant="tertiary-neutral"
																icon={<TrashIcon aria-hidden />}
															/>
														</Form>
													</Table.DataCell>
												</Table.Row>
											))}
										</Table.Body>
									</Table>
								)}

								{/* Add effect */}
								<Form method="post">
									<input type="hidden" name="intent" value="addEffect" />
									<input type="hidden" name="questionId" value={q.id} />
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
							</VStack>
						</VStack>
					))}
				</VStack>
			)}
		</VStack>
	)
}

/** Edit form for a screening question with live Markdown preview. */
function QuestionEditForm({
	question,
}: {
	question: { id: string; questionText: string; description: string | null; displayOrder: number }
}) {
	const [descriptionPreview, setDescriptionPreview] = useState(question.description ?? "")

	return (
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
						style={{ minWidth: "20rem" }}
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
					<div style={{ flex: 1, minWidth: "20rem" }}>
						<Textarea
							label="Beskrivelse (Markdown)"
							name="description"
							size="small"
							defaultValue={question.description ?? ""}
							description="Støtter **bold**, *kursiv*, - kulepunkter, [lenker](url)"
							minRows={3}
							onChange={(e) => setDescriptionPreview(e.target.value)}
						/>
					</div>
					{descriptionPreview && (
						<div style={{ flex: 1, minWidth: "20rem" }}>
							<BodyShort size="small" weight="semibold" spacing>
								Forhåndsvisning
							</BodyShort>
							<MarkdownPreview content={descriptionPreview} />
						</div>
					)}
				</HStack>
				<div>
					<Button type="submit" size="small" variant="secondary">
						Oppdater
					</Button>
				</div>
			</VStack>
		</Form>
	)
}

/** Client-side Markdown preview using marked. */
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
