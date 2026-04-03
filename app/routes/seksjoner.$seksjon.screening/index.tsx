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
	Modal,
	ReadMore,
	Tag,
	VStack,
} from "@navikt/ds-react"
import { useRef, useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import {
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

	if (intent === "deleteQuestion") {
		const questionId = formData.get("questionId") as string
		if (!questionId) throw new Response("Mangler ID", { status: 400 })
		await deleteScreeningQuestion(questionId, authedUser.navIdent)
	}

	return data({ success: true })
}

export default function SectionScreening() {
	const { seksjon, seksjonName, questions, canEdit } = useLoaderData<typeof loader>()
	const deleteModalRef = useRef<HTMLDialogElement>(null)
	const [deleteTarget, setDeleteTarget] = useState<{ id: string; text: string } | null>(null)

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
				<div>
					<Button
						as={Link}
						to={`/seksjoner/${seksjon}/screening/ny/rediger`}
						size="small"
						variant="secondary"
						icon={<PlusIcon aria-hidden />}
					>
						Nytt spørsmål
					</Button>
				</div>
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
											<Button
												size="xsmall"
												variant="tertiary-neutral"
												icon={<TrashIcon aria-hidden />}
												onClick={() => {
													setDeleteTarget({ id: q.id, text: q.questionText })
													deleteModalRef.current?.showModal()
												}}
											>
												Slett
											</Button>
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
							<Button type="submit" size="small" variant="danger">
								Slett
							</Button>
							<Button type="button" size="small" variant="secondary" onClick={() => deleteModalRef.current?.close()}>
								Avbryt
							</Button>
						</HStack>
					</Form>
				</Modal.Footer>
			</Modal>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
