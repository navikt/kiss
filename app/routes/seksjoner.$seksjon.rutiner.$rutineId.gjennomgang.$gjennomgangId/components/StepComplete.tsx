import { CheckmarkCircleFillIcon } from "@navikt/aksel-icons"
import {
	Alert,
	BodyShort,
	Box,
	Button,
	ConfirmationPanel,
	Detail,
	Dialog,
	Heading,
	HStack,
	Label,
	Table,
	Tag,
	VStack,
} from "@navikt/ds-react"
import { useState } from "react"
import { Form, useActionData, useNavigation, useSubmit } from "react-router"

type ActionResult = {
	success: boolean
	message?: string
	error?: string
	intent?: string
}

type Props = {
	review: {
		id: string
		title: string
		status: "draft" | "needs_follow_up" | "completed" | "discarded"
		reviewedAt: string
		summary: string | null
		summaryHtml: string | null
		participants: Array<{ id: string; userIdent: string; userName: string | null }>
		attachments: Array<{ id: string; fileName: string }>
		links: Array<{ id: string; url: string; title: string | null }>
		followUpPoints: Array<{ id: string; text: string; description: string | null; status: string }>
	}
	isDraft: boolean
	requiredViolations?: Array<{ stepTitle: string; componentLabel: string; stepId: string }>
	onNavigateToStep?: (stepId: string) => void
}

export function StepComplete({ review, isDraft, requiredViolations = [], onNavigateToStep }: Props) {
	if (review.status === "completed" || review.status === "needs_follow_up") {
		return <CompletedView status={review.status} />
	}

	if (review.status === "discarded") {
		return <DiscardedView />
	}

	return (
		<VStack gap="space-8">
			{isDraft && <ReviewOverview review={review} />}
			{isDraft && (
				<CompleteSection
					followUpPoints={review.followUpPoints}
					requiredViolations={requiredViolations}
					onNavigateToStep={onNavigateToStep}
				/>
			)}
			{isDraft && <DiscardSection />}
		</VStack>
	)
}

function ReviewOverview({ review }: { review: Props["review"] }) {
	const reviewDate = new Date(review.reviewedAt)

	return (
		<VStack gap="space-6">
			<Heading size="medium" level="3">
				Oppsummering
			</Heading>

			<Box padding="space-6" borderWidth="1" borderColor="neutral-subtle" borderRadius="8">
				<VStack gap="space-6">
					<HStack gap="space-12" wrap>
						<VStack gap="space-1">
							<Label size="small">Tittel</Label>
							<BodyShort size="small">{review.title}</BodyShort>
						</VStack>
						<VStack gap="space-1">
							<Label size="small">Gjennomgangsdato</Label>
							<BodyShort size="small">
								{reviewDate.toLocaleDateString("nb-NO", {
									day: "numeric",
									month: "long",
									year: "numeric",
								})}
							</BodyShort>
						</VStack>
						<VStack gap="space-1">
							<Label size="small">Deltakere</Label>
							<BodyShort size="small">
								{review.participants.length > 0
									? review.participants.map((p) => p.userName ?? p.userIdent).join(", ")
									: "Ingen registrert"}
							</BodyShort>
						</VStack>
					</HStack>

					{review.summaryHtml && (
						<VStack gap="space-1">
							<Label size="small">Sammendrag</Label>
							<div
								className="markdown-content"
								// biome-ignore lint/security/noDangerouslySetInnerHtml: server-sanitized
								dangerouslySetInnerHTML={{ __html: review.summaryHtml }}
							/>
						</VStack>
					)}

					{review.links.length > 0 && (
						<VStack gap="space-1">
							<Label size="small">Lenker</Label>
							<Detail>
								{review.links.length} lenke{review.links.length !== 1 ? "r" : ""}
							</Detail>
						</VStack>
					)}

					{review.attachments.length > 0 && (
						<VStack gap="space-1">
							<Label size="small">Vedlegg</Label>
							<Detail>
								{review.attachments.length} fil{review.attachments.length !== 1 ? "er" : ""}
							</Detail>
						</VStack>
					)}

					{review.followUpPoints.length > 0 && (
						<VStack gap="space-2">
							<Label size="small">Oppfølgingspunkter</Label>
							{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
							<section className="table-scroll" tabIndex={0} aria-label="Oppfølgingspunkter">
								<Table size="small">
									<Table.Header>
										<Table.Row>
											<Table.HeaderCell scope="col">Punkt</Table.HeaderCell>
											<Table.HeaderCell scope="col">Status</Table.HeaderCell>
										</Table.Row>
									</Table.Header>
									<Table.Body>
										{review.followUpPoints.map((p) => (
											<Table.Row key={p.id}>
												<Table.DataCell>{p.text}</Table.DataCell>
												<Table.DataCell>
													<FollowUpStatusTag status={p.status} />
												</Table.DataCell>
											</Table.Row>
										))}
									</Table.Body>
								</Table>
							</section>
						</VStack>
					)}
				</VStack>
			</Box>
		</VStack>
	)
}

const followUpStatusLabels: Record<string, string> = {
	needs_follow_up: "Må følges opp",
	completed: "Fullført",
	not_relevant: "Ikke relevant",
}

const followUpStatusVariants: Record<string, "warning" | "success" | "neutral"> = {
	needs_follow_up: "warning",
	completed: "success",
	not_relevant: "neutral",
}

function FollowUpStatusTag({ status }: { status: string }) {
	return (
		<Tag variant={followUpStatusVariants[status] ?? "neutral"} size="xsmall">
			{followUpStatusLabels[status] ?? status}
		</Tag>
	)
}

function CompletedView({ status }: { status: "completed" | "needs_follow_up" }) {
	return (
		<VStack gap="space-6">
			<HStack gap="space-4" align="center">
				<CheckmarkCircleFillIcon fontSize="2.5rem" color="var(--ax-text-action-success)" aria-hidden />
				<Heading size="medium" level="3">
					{status === "completed" ? "Gjennomgangen er fullført" : "Gjennomgangen er fullført med oppfølgingspunkter"}
				</Heading>
			</HStack>
			<BodyShort>
				{status === "completed"
					? "Alle oppfølgingspunkter er adressert og gjennomgangen er lukket."
					: "Gjennomgangen er fullført, men har oppfølgingspunkter som må adresseres. Når alle punkter er fullført eller markert som ikke relevant, settes gjennomgangen automatisk til fullført."}
			</BodyShort>
		</VStack>
	)
}

function DiscardedView() {
	return (
		<VStack gap="space-6">
			<Heading size="medium" level="3">
				Gjennomgangen er forkastet
			</Heading>
			<BodyShort textColor="subtle">
				Denne gjennomgangen er forkastet og fjernet fra alle oversikter. Dataene er bevart for sporbarhet.
			</BodyShort>
		</VStack>
	)
}

function CompleteSection({
	followUpPoints,
	requiredViolations,
	onNavigateToStep,
}: {
	followUpPoints: Array<{ id: string; text: string; description: string | null }>
	requiredViolations: Array<{ stepTitle: string; componentLabel: string; stepId: string }>
	onNavigateToStep?: (stepId: string) => void
}) {
	const submit = useSubmit()
	const navigation = useNavigation()
	const actionData = useActionData<ActionResult>()
	const [confirmed, setConfirmed] = useState(false)
	const isSubmitting = navigation.state === "submitting"

	const pointsMissingDescription = followUpPoints.filter((p) => !p.description || p.description.trim().length === 0)
	const hasMissingDescriptions = pointsMissingDescription.length > 0
	const hasRequiredViolations = requiredViolations.length > 0
	const cannotComplete = hasMissingDescriptions || hasRequiredViolations

	function handleComplete() {
		if (!confirmed || cannotComplete) return
		const formData = new FormData()
		formData.set("intent", "complete")
		submit(formData, { method: "post" })
	}

	return (
		<Box padding="space-8" borderWidth="1" borderColor="warning" borderRadius="8" background="warning-softA">
			<VStack gap="space-4">
				<Heading size="small" level="4">
					Fullfør gjennomgang
				</Heading>
				<BodyShort>
					Når gjennomgangen er fullført låses oppsummering, referat og deltakerlisten. Eventuelle uadresserte
					oppfølgingspunkter vil føre til at gjennomgangen får status «må følges opp», og du kan fortsatt oppdatere
					status og oppfølging på punktene inntil alle er adressert.
				</BodyShort>

				{hasRequiredViolations && (
					<Alert variant="warning" size="small">
						<BodyShort spacing>Følgende påkrevde komponenter mangler utfylling:</BodyShort>
						<ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
							{requiredViolations.map((v, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: static violation list
								<li key={i}>
									{onNavigateToStep ? (
										<button
											type="button"
											onClick={() => onNavigateToStep(`sjekkliste-steg-${v.stepId}`)}
											style={{
												background: "none",
												border: "none",
												padding: 0,
												cursor: "pointer",
												textDecoration: "underline",
												color: "inherit",
												font: "inherit",
											}}
										>
											«{v.stepTitle}»
										</button>
									) : (
										<>«{v.stepTitle}»</>
									)}
									{": "}
									{v.componentLabel}
								</li>
							))}
						</ul>
					</Alert>
				)}

				{hasMissingDescriptions && (
					<Alert variant="warning" size="small">
						<BodyShort spacing>
							Alle oppfølgingspunkter må ha en beskrivelse før gjennomgangen kan fullføres. Legg til beskrivelse på:
						</BodyShort>
						<ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
							{pointsMissingDescription.map((p) => (
								<li key={p.id}>{p.text}</li>
							))}
						</ul>
					</Alert>
				)}

				{actionData?.intent === "complete" && actionData.error && (
					<Alert variant="error" size="small">
						<span style={{ whiteSpace: "pre-wrap" }}>{actionData.error}</span>
					</Alert>
				)}

				<ConfirmationPanel
					checked={confirmed}
					onChange={() => setConfirmed(!confirmed)}
					label="Jeg bekrefter at gjennomgangen er komplett"
					size="small"
					disabled={cannotComplete}
				/>

				<HStack>
					<Button
						type="button"
						variant="primary"
						size="small"
						onClick={handleComplete}
						disabled={!confirmed || isSubmitting || cannotComplete}
						loading={isSubmitting}
					>
						Fullfør gjennomgang
					</Button>
				</HStack>
			</VStack>
		</Box>
	)
}

function DiscardSection() {
	const [dialogOpen, setDialogOpen] = useState(false)
	const navigation = useNavigation()
	const isSubmitting = navigation.state === "submitting"

	return (
		<HStack gap="space-2" align="center">
			<BodyShort size="small" textColor="subtle">
				Vil du avbryte og forkaste gjennomgangen?
			</BodyShort>
			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<Dialog.Trigger>
					<Button type="button" variant="tertiary-neutral" size="xsmall">
						Forkast gjennomgang
					</Button>
				</Dialog.Trigger>
				<Dialog.Popup width="small" position="center" closeOnOutsideClick aria-label="Bekreft forkasting">
					<Dialog.Header>Forkast gjennomgang?</Dialog.Header>
					<Dialog.Body>
						<VStack gap="space-6">
							<BodyShort>
								Er du sikker på at du vil forkaste denne gjennomgangen? Handlingen kan ikke angres. Dataene beholdes for
								sporbarhet.
							</BodyShort>
							<Form method="post">
								<input type="hidden" name="intent" value="discard-review" />
								<HStack gap="space-4">
									<Button type="submit" variant="danger" size="small" disabled={isSubmitting} loading={isSubmitting}>
										Ja, forkast
									</Button>
									<Button type="button" variant="secondary" size="small" onClick={() => setDialogOpen(false)}>
										Avbryt
									</Button>
								</HStack>
							</Form>
						</VStack>
					</Dialog.Body>
				</Dialog.Popup>
			</Dialog>
		</HStack>
	)
}
