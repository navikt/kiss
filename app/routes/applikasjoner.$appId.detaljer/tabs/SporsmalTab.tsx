import { BodyShort, Heading, HStack, Table, Tag, VStack } from "@navikt/ds-react"
import { Link } from "react-router"

interface ScreeningQuestion {
	id: string
	questionText: string
	description: string | null
	sectionId: string | null
	displayOrder: number
	answerType: string
	answer: string | null
	answeredBy: string | null
	answeredAt: string | null
}

export function SporsmalTab({
	questions,
	sectionSlugMap,
	currentSectionSlug,
}: {
	questions: ScreeningQuestion[]
	sectionSlugMap: Record<string, string>
	currentSectionSlug: string | null
}) {
	const answered = questions.filter((q) => q.answeredAt !== null)
	const unanswered = questions.filter((q) => q.answeredAt === null)

	function questionLink(q: ScreeningQuestion): string | null {
		const slug = q.sectionId ? sectionSlugMap[q.sectionId] : currentSectionSlug
		if (!slug) return null
		return `/seksjoner/${slug}/screening/${q.id}`
	}

	return (
		<VStack gap="space-8">
			<HStack justify="space-between" align="center">
				<Heading size="medium" level="3">
					Screening-spørsmål
				</Heading>
				<HStack gap="space-4">
					<Tag variant={answered.length === questions.length ? "success" : answered.length > 0 ? "warning" : "error"}>
						{answered.length} / {questions.length} besvart
					</Tag>
				</HStack>
			</HStack>

			{questions.length === 0 && <BodyShort textColor="subtle">Ingen godkjente spørsmål er tilgjengelige.</BodyShort>}

			{unanswered.length > 0 && (
				<VStack gap="space-4">
					<Heading size="small" level="4">
						Ubesvarte ({unanswered.length})
					</Heading>
					<QuestionsTable questions={unanswered} questionLink={questionLink} />
				</VStack>
			)}

			{answered.length > 0 && (
				<VStack gap="space-4">
					<Heading size="small" level="4">
						Besvarte ({answered.length})
					</Heading>
					<QuestionsTable questions={answered} questionLink={questionLink} />
				</VStack>
			)}
		</VStack>
	)
}

function QuestionsTable({
	questions,
	questionLink,
}: {
	questions: ScreeningQuestion[]
	questionLink: (q: ScreeningQuestion) => string | null
}) {
	return (
		// biome-ignore lint/a11y/noNoninteractiveTabindex: Required for keyboard navigation on scrollable table
		<section className="table-scroll" tabIndex={0} aria-label="Spørsmål-oversikt">
			<Table size="small">
				<Table.Header>
					<Table.Row>
						<Table.HeaderCell>Spørsmål</Table.HeaderCell>
						<Table.HeaderCell>Status</Table.HeaderCell>
						<Table.HeaderCell>Svar</Table.HeaderCell>
						<Table.HeaderCell>Besvart av</Table.HeaderCell>
						<Table.HeaderCell>Besvart</Table.HeaderCell>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{questions.map((q) => {
						const link = questionLink(q)
						return (
							<Table.Row key={q.id}>
								<Table.DataCell>
									{link ? <Link to={link}>{q.questionText}</Link> : <span>{q.questionText}</span>}
								</Table.DataCell>
								<Table.DataCell>
									{q.answeredAt !== null ? (
										<Tag variant="success" size="small">
											Besvart
										</Tag>
									) : (
										<Tag variant="warning" size="small">
											Ubesvart
										</Tag>
									)}
								</Table.DataCell>
								<Table.DataCell>
									<BodyShort size="small">{q.answer ?? "—"}</BodyShort>
								</Table.DataCell>
								<Table.DataCell>
									<BodyShort size="small">{q.answeredBy ?? "—"}</BodyShort>
								</Table.DataCell>
								<Table.DataCell>
									<BodyShort size="small">{q.answeredAt ? formatTimestamp(q.answeredAt) : "—"}</BodyShort>
								</Table.DataCell>
							</Table.Row>
						)
					})}
				</Table.Body>
			</Table>
		</section>
	)
}

function formatTimestamp(dateStr: string) {
	return new Date(dateStr).toLocaleString("nb-NO", {
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	})
}
