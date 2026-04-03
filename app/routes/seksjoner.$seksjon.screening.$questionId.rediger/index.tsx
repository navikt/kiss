import { PlusIcon, TrashIcon } from "@navikt/aksel-icons"
import {
	BodyShort,
	Box,
	Button,
	Detail,
	Heading,
	HStack,
	Label,
	Select,
	Table,
	Tag,
	Textarea,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { useEffect, useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, redirect, useLoaderData } from "react-router"
import { MarkdownHint } from "~/components/MarkdownHint"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAllControls } from "~/db/queries/framework.server"
import {
	addEffect,
	createScreeningQuestion,
	deleteEffect,
	getEffectsForQuestion,
	getScreeningQuestion,
	updateScreeningQuestion,
} from "~/db/queries/screening.server"
import { getSectionDetail } from "~/db/queries/sections.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { renderMarkdown } from "~/lib/markdown.server"

const effectLabels: Record<string, string> = {
	not_relevant: "Ikke relevant",
	implemented: "Implementert",
	partially_implemented: "Delvis implementert",
	not_implemented: "Ikke implementert",
}

export async function loader({ request, params }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	requireUser(user)

	const seksjon = params.seksjon as string
	const questionId = params.questionId as string
	const isNew = questionId === "ny"

	const result = await getSectionDetail(seksjon)
	if (!result) throw new Response("Seksjon ikke funnet", { status: 404 })

	if (isNew) {
		const controls = await getAllControls()
		return data({
			isNew: true,
			seksjon,
			seksjonName: result.section.name,
			sectionId: result.section.id,
			question: {
				id: "ny",
				questionText: "",
				description: null,
				descriptionHtml: "",
				displayOrder: 0,
			},
			effects: [],
			controls,
		})
	}

	const question = await getScreeningQuestion(questionId)
	if (!question) throw new Response("Spørsmål ikke funnet", { status: 404 })

	const effects = await getEffectsForQuestion(questionId)
	const controls = await getAllControls()

	return data({
		isNew: false,
		seksjon,
		seksjonName: result.section.name,
		sectionId: result.section.id,
		question: {
			...question,
			descriptionHtml: renderMarkdown(question.description),
		},
		effects,
		controls,
	})
}

export async function action({ request, params }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)

	const seksjon = params.seksjon as string
	const questionId = params.questionId as string
	const formData = await request.formData()
	const intent = formData.get("intent") as string

	if (intent === "updateQuestion") {
		const questionText = formData.get("questionText") as string
		const description = (formData.get("description") as string)?.trim() || null
		const displayOrder = Number(formData.get("displayOrder") ?? 0)
		if (!questionText?.trim()) throw new Response("Ugyldig data", { status: 400 })

		if (questionId === "ny") {
			const sectionId = formData.get("sectionId") as string
			const q = await createScreeningQuestion(
				questionText.trim(),
				description,
				displayOrder,
				authedUser.navIdent,
				sectionId,
			)
			return redirect(`/seksjoner/${seksjon}/screening/${q.id}/rediger`)
		}

		await updateScreeningQuestion(questionId, questionText.trim(), description, displayOrder, authedUser.navIdent)
		return redirect(`/seksjoner/${seksjon}/screening`)
	} else if (intent === "addEffect") {
		const controlTextId = formData.get("controlTextId") as string
		const yesEffect = formData.get("yesEffect") as string
		const noEffect = formData.get("noEffect") as string
		const yesComment = formData.get("yesComment") as string
		const noComment = formData.get("noComment") as string
		if (!controlTextId) throw new Response("Mangler data", { status: 400 })
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

export default function EditSectionScreeningQuestion() {
	const { isNew, seksjon, seksjonName, sectionId, question, effects, controls } = useLoaderData<typeof loader>()
	const [descriptionPreview, setDescriptionPreview] = useState(question.description ?? "")

	return (
		<VStack gap="space-8" style={{ maxWidth: "64rem" }}>
			<Detail>
				<Link to={`/seksjoner/${seksjon}/screening`}>← Tilbake til innledende spørsmål — {seksjonName}</Link>
			</Detail>

			<Heading size="xlarge" level="2">
				{isNew ? "Nytt spørsmål" : "Rediger spørsmål"}
			</Heading>

			{/* Edit form — padding accommodates Aksel's 6px focus ring (3px outline + 3px offset) */}
			<Form method="post" style={{ padding: "6px" }}>
				<input type="hidden" name="intent" value="updateQuestion" />
				{isNew && <input type="hidden" name="sectionId" value={sectionId} />}
				<VStack gap="space-8">
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
					<HStack gap="space-8" align="start" style={{ flexWrap: "wrap" }}>
						<VStack gap="space-4" style={{ flex: 1, minWidth: "20rem", padding: "6px", margin: "-6px" }}>
							<Textarea
								label="Beskrivelse (Markdown)"
								name="description"
								size="small"
								defaultValue={question.description ?? ""}
								minRows={5}
								onChange={(e) => setDescriptionPreview(e.target.value)}
							/>
							<MarkdownHint />
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
						<Button type="submit" size="small" variant="primary">
							{isNew ? "Opprett spørsmål" : "Lagre endringer"}
						</Button>
					</div>
				</VStack>
			</Form>

			{/* Effects — only shown for existing questions */}
			{!isNew && (
				<Box padding="space-12" borderWidth="1" borderColor="neutral-subtle" borderRadius="8">
					<VStack gap="space-6">
						<HStack gap="space-2" align="center">
							<Heading size="small" level="3">
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
										<Table.HeaderCell scope="col" />
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
				</Box>
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
				borderRadius: "var(--ax-radius-8)",
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
