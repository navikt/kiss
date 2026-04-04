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
import { getSectionBySlug } from "~/db/queries/sections.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"
import { getStatusLabel, statusLabels } from "~/lib/compliance-status"
import { renderMarkdown } from "~/lib/markdown.server"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const url = new URL(request.url)
	const seksjonSlug = url.searchParams.get("seksjon")

	let sectionId: string | null = null
	let sectionName: string | null = null

	if (seksjonSlug) {
		const section = await getSectionBySlug(seksjonSlug)
		if (!section) throw new Response("Seksjon ikke funnet", { status: 404 })
		sectionId = section.id
		sectionName = section.name
	}

	const questionId = params.questionId as string
	const isNew = questionId === "ny"

	if (isNew) {
		const controls = await getAllControls()
		return data({
			isNew: true,
			question: {
				id: "ny",
				questionText: "",
				description: null,
				descriptionHtml: "",
				displayOrder: 0,
			},
			effects: [],
			controls,
			seksjon: seksjonSlug,
			sectionId,
			sectionName,
		})
	}

	const question = await getScreeningQuestion(questionId)
	if (!question) throw new Response("Spørsmål ikke funnet", { status: 404 })

	const effects = await getEffectsForQuestion(questionId)
	const controls = await getAllControls()

	return data({
		isNew: false,
		question: {
			...question,
			descriptionHtml: renderMarkdown(question.description),
		},
		effects,
		controls,
		seksjon: seksjonSlug,
		sectionId,
		sectionName,
	})
}

export async function action({ request, params }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const questionId = params.questionId as string
	const formData = await request.formData()
	const intent = formData.get("intent") as string
	const seksjon = formData.get("seksjon") as string | null
	const sectionId = formData.get("sectionId") as string | null
	const seksjonParam = seksjon ? `?seksjon=${seksjon}` : ""

	if (intent === "updateQuestion") {
		const questionText = formData.get("questionText") as string
		const description = (formData.get("description") as string)?.trim() || null
		const displayOrder = Number(formData.get("displayOrder") ?? 0)
		if (!questionText?.trim()) throw new Response("Ugyldig data", { status: 400 })

		if (questionId === "ny") {
			const q = await createScreeningQuestion(
				questionText.trim(),
				description,
				displayOrder,
				authedUser.navIdent,
				sectionId,
			)

			const pendingEffectsJson = formData.get("pendingEffects") as string | null
			if (pendingEffectsJson) {
				const pending = JSON.parse(pendingEffectsJson) as Array<{
					controlTextId: string
					yesEffect: string | null
					noEffect: string | null
				}>
				for (const eff of pending) {
					await addEffect({
						questionId: q.id,
						controlTextId: eff.controlTextId,
						yesEffect: eff.yesEffect,
						noEffect: eff.noEffect,
						yesComment: null,
						noComment: null,
					})
				}
			}

			return redirect(`/admin/screening${seksjonParam}`)
		}

		await updateScreeningQuestion(questionId, questionText.trim(), description, displayOrder, authedUser.navIdent)
		return redirect(`/admin/screening${seksjonParam}`)
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

interface PendingEffect {
	clientId: string
	controlTextId: string
	controlName: string
	yesEffect: string | null
	noEffect: string | null
}

export default function EditScreeningQuestion() {
	const { isNew, question, effects, controls, seksjon, sectionId, sectionName } = useLoaderData<typeof loader>()
	const [descriptionPreview, setDescriptionPreview] = useState(question.description ?? "")
	const [pendingEffects, setPendingEffects] = useState<PendingEffect[]>([])
	const seksjonParam = seksjon ? `?seksjon=${seksjon}` : ""

	const allEffects = isNew ? pendingEffects : effects

	function handleAddPendingEffect(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault()
		const fd = new FormData(e.currentTarget)
		const controlTextId = fd.get("controlTextId") as string
		if (!controlTextId) return
		const control = controls.find((c) => c.controlId === controlTextId)
		setPendingEffects((prev) => [
			...prev,
			{
				clientId: crypto.randomUUID(),
				controlTextId,
				controlName: control?.name ?? "",
				yesEffect: (fd.get("yesEffect") as string) || null,
				noEffect: (fd.get("noEffect") as string) || null,
			},
		])
		e.currentTarget.reset()
	}

	function handleRemovePendingEffect(clientId: string) {
		setPendingEffects((prev) => prev.filter((p) => p.clientId !== clientId))
	}

	return (
		<VStack gap="space-8" style={{ maxWidth: "64rem" }}>
			<Detail>
				<Link to={`/admin/screening${seksjonParam}`}>
					← Tilbake til innledende spørsmål{sectionName ? ` — ${sectionName}` : ""}
				</Link>
			</Detail>

			<Heading size="xlarge" level="2">
				{isNew ? "Nytt spørsmål" : "Rediger spørsmål"}
			</Heading>

			{/* Edit form — padding accommodates Aksel's 6px focus ring (3px outline + 3px offset) */}
			<Form method="post" style={{ padding: "6px" }}>
				<input type="hidden" name="intent" value="updateQuestion" />
				{seksjon && <input type="hidden" name="seksjon" value={seksjon} />}
				{sectionId && <input type="hidden" name="sectionId" value={sectionId} />}
				{isNew && <input type="hidden" name="pendingEffects" value={JSON.stringify(pendingEffects)} />}
				<VStack gap="space-8">
					<TextField label="Spørsmålstekst" name="questionText" size="small" defaultValue={question.questionText} />
					<HStack gap="space-8" align="start" style={{ flexWrap: "wrap" }}>
						<VStack style={{ flex: 1, minWidth: "20rem", padding: "6px", margin: "-6px" }}>
							<Textarea
								label="Beskrivelse"
								name="description"
								size="small"
								defaultValue={question.description ?? ""}
								minRows={5}
								onChange={(e) => setDescriptionPreview(e.target.value)}
							/>
						</VStack>
						<VStack style={{ flex: 1, minWidth: "20rem", alignSelf: "stretch" }}>
							<Label size="small" spacing>
								Forhåndsvisning
							</Label>
							<MarkdownPreview content={descriptionPreview} />
						</VStack>
					</HStack>
					<MarkdownHint />
					<div>
						<Button type="submit" size="small" variant="primary">
							{isNew ? "Opprett spørsmål" : "Lagre endringer"}
						</Button>
					</div>
				</VStack>
			</Form>

			{/* Effects */}
			<Box padding="space-12" borderWidth="1" borderColor="neutral-subtle" borderRadius="8">
				<VStack gap="space-6">
					<Heading size="small" level="3">
						Effekter
					</Heading>

					{allEffects.length > 0 && (
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
								{isNew
									? pendingEffects.map((e) => (
											<Table.Row key={e.clientId}>
												<Table.DataCell>
													<Tag variant="info" size="xsmall">
														{e.controlTextId} – {e.controlName}
													</Tag>
												</Table.DataCell>
												<Table.DataCell>
													{e.yesEffect ? (
														<Tag variant="neutral" size="xsmall">
															{getStatusLabel(e.yesEffect)}
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
															{getStatusLabel(e.noEffect)}
														</Tag>
													) : (
														<BodyShort size="small" textColor="subtle">
															—
														</BodyShort>
													)}
												</Table.DataCell>
												<Table.DataCell>
													<Button
														type="button"
														size="xsmall"
														variant="tertiary-neutral"
														icon={<TrashIcon aria-hidden />}
														onClick={() => handleRemovePendingEffect(e.clientId)}
													/>
												</Table.DataCell>
											</Table.Row>
										))
									: effects.map((e) => (
											<Table.Row key={e.id}>
												<Table.DataCell>
													<Tag variant="info" size="xsmall">
														{e.controlTextId}
														{e.controlName ? ` – ${e.controlName}` : ""}
													</Tag>
												</Table.DataCell>
												<Table.DataCell>
													{e.yesEffect ? (
														<Tag variant="neutral" size="xsmall">
															{getStatusLabel(e.yesEffect)}
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
															{getStatusLabel(e.noEffect)}
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
					{isNew ? (
						<form onSubmit={handleAddPendingEffect}>
							<HStack gap="space-4" align="end" wrap>
								<Select label="Kontroll" name="controlTextId" size="small">
									<option value="">Velg kontroll</option>
									{controls.map((c) => (
										<option key={c.controlId} value={c.controlId}>
											{c.controlId} – {c.name}
										</option>
									))}
								</Select>
								<Select label="Ja-effekt" name="yesEffect" size="small">
									<option value="">Ingen</option>
									{Object.entries(statusLabels).map(([v, l]) => (
										<option key={v} value={v}>
											{l}
										</option>
									))}
								</Select>
								<Select label="Nei-effekt" name="noEffect" size="small">
									<option value="">Ingen</option>
									{Object.entries(statusLabels).map(([v, l]) => (
										<option key={v} value={v}>
											{l}
										</option>
									))}
								</Select>
								<Button type="submit" size="small" variant="secondary-neutral" icon={<PlusIcon aria-hidden />}>
									Legg til effekt
								</Button>
							</HStack>
						</form>
					) : (
						<Form method="post">
							<input type="hidden" name="intent" value="addEffect" />
							<HStack gap="space-4" align="end" wrap>
								<Select label="Kontroll" name="controlTextId" size="small">
									<option value="">Velg kontroll</option>
									{controls.map((c) => (
										<option key={c.controlId} value={c.controlId}>
											{c.controlId} – {c.name}
										</option>
									))}
								</Select>
								<Select label="Ja-effekt" name="yesEffect" size="small">
									<option value="">Ingen</option>
									{Object.entries(statusLabels).map(([v, l]) => (
										<option key={v} value={v}>
											{l}
										</option>
									))}
								</Select>
								<Select label="Nei-effekt" name="noEffect" size="small">
									<option value="">Ingen</option>
									{Object.entries(statusLabels).map(([v, l]) => (
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
			</Box>
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
				flex: 1,
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
