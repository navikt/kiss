import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { DragVerticalIcon, PencilIcon, TrashIcon } from "@navikt/aksel-icons"
import { BodyShort, Box, Button, Heading, HStack, ReadMore, Table, Tag, VStack } from "@navikt/ds-react"
import { Link } from "react-router"
import { getStatusLabel } from "~/lib/compliance-status"

export type ChoiceEffect = {
	id: string
	controlTextId: string
	controlName: string | null
	effect: string | null
	comment: string | null
}

export type QuestionChoice = {
	id: string
	label: string
	requiresComment: boolean
	requiresLink: boolean
	effects: ChoiceEffect[]
}

export type QuestionItem = {
	id: string
	questionText: string
	displayOrder: number
	answerType: string
	descriptionHtml: string | null
	choices: QuestionChoice[]
}

export function SortableQuestionCard({
	question: q,
	index,
	editPath,
	onDelete,
}: {
	question: QuestionItem
	index: number
	editPath: string
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
							to={`${editPath}/${q.id}/rediger`}
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

				{/* Choices overview */}
				{q.choices.length > 0 && (
					<VStack gap="space-2">
						<BodyShort size="small" textColor="subtle">
							Valgmuligheter
						</BodyShort>
						<HStack gap="space-4" wrap>
							{q.choices.map((c) => (
								<HStack key={c.id} gap="space-2" align="center">
									<Tag variant="alt3" size="xsmall">
										{c.label}
									</Tag>
									{c.requiresComment && (
										<Tag variant="neutral" size="xsmall">
											Kommentar
										</Tag>
									)}
									{c.requiresLink && (
										<Tag variant="neutral" size="xsmall">
											Lenke
										</Tag>
									)}
								</HStack>
							))}
						</HStack>
					</VStack>
				)}

				{/* Effects table */}
				{q.choices.some((c) => c.effects.length > 0) && (
					<VStack gap="space-2">
						<BodyShort size="small" textColor="subtle">
							Effekter
						</BodyShort>
						{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table needs keyboard access */}
						<section className="table-scroll" tabIndex={0} aria-label="Effekter for valg">
							<Table size="small">
								<Table.Header>
									<Table.Row>
										<Table.HeaderCell scope="col">Valg</Table.HeaderCell>
										<Table.HeaderCell scope="col">Kontroll</Table.HeaderCell>
										<Table.HeaderCell scope="col">Effekt</Table.HeaderCell>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{q.choices.flatMap((c) =>
										c.effects.map((e) => (
											<Table.Row key={e.id}>
												<Table.DataCell>
													<Tag variant="alt3" size="xsmall">
														{c.label}
													</Tag>
												</Table.DataCell>
												<Table.DataCell>
													<Tag variant="info" size="xsmall">
														{e.controlTextId}
														{e.controlName ? ` – ${e.controlName}` : ""}
													</Tag>
												</Table.DataCell>
												<Table.DataCell>
													{e.effect ? (
														<Tag variant="neutral" size="xsmall">
															{getStatusLabel(e.effect)}
														</Tag>
													) : (
														<BodyShort size="small" textColor="subtle">
															—
														</BodyShort>
													)}
												</Table.DataCell>
											</Table.Row>
										)),
									)}
								</Table.Body>
							</Table>
						</section>
					</VStack>
				)}
			</VStack>
		</Box>
	)
}
