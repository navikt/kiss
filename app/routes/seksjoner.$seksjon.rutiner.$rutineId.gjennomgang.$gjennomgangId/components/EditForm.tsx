import { Link as AkselLink, Alert, BodyShort, Box, Button, HStack, Label, TextField, VStack } from "@navikt/ds-react"
import { Form, Link, useActionData } from "react-router"
import { MarkdownEditor } from "~/components/MarkdownEditor"
import { getFrequencyLabel } from "~/lib/routine-frequencies"
import type { ActionResult } from "../shared"

type EditFormProps = {
	section: { slug: string }
	routine: { id: string; name: string; frequency: string }
	review: {
		title: string
		summary: string | null
		reviewedAt: string
		createdBy: string
		applicationId: string | null
		applicationName: string | null
		participants: Array<{ userIdent: string }>
	}
}

export function EditForm({ section, routine, review }: EditFormProps) {
	const actionData = useActionData<ActionResult>()
	const reviewDate = new Date(review.reviewedAt)
	const defaultDate = reviewDate.toISOString().split("T")[0]
	const defaultTime = reviewDate.toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" })

	return (
		<Form method="post">
			<input type="hidden" name="intent" value="update-review" />
			<VStack gap="space-6">
				<TextField label="Tittel" name="title" size="small" autoComplete="off" defaultValue={review.title} />

				{/* Metadata (read-only info + editable date) */}
				<Box padding="space-8" borderWidth="1" borderColor="neutral-subtle" borderRadius="8">
					<VStack gap="space-4">
						<HStack gap="space-12" wrap>
							<VStack gap="space-2">
								<Label size="small">Rutine</Label>
								<BodyShort>
									<AkselLink as={Link} to={`/seksjoner/${section.slug}/rutiner/${routine.id}`}>
										{routine.name}
									</AkselLink>
								</BodyShort>
							</VStack>
							<VStack gap="space-2">
								<Label size="small">Frekvens</Label>
								<BodyShort>{getFrequencyLabel(routine.frequency)}</BodyShort>
							</VStack>
							{review.applicationId && (
								<VStack gap="space-2">
									<Label size="small">Applikasjon</Label>
									<BodyShort>
										<AkselLink as={Link} to={`/applikasjoner/${review.applicationId}/detaljer`}>
											{review.applicationName ?? review.applicationId}
										</AkselLink>
									</BodyShort>
								</VStack>
							)}
							<VStack gap="space-2">
								<Label size="small">Opprettet av</Label>
								<BodyShort>{review.createdBy}</BodyShort>
							</VStack>
						</HStack>
						<HStack gap="space-6" align="end">
							<div>
								<Label size="small" htmlFor="reviewedAt">
									Dato for gjennomgang
								</Label>
								<input
									type="date"
									id="reviewedAt"
									name="reviewedAt"
									defaultValue={defaultDate}
									className="navds-text-field__input navds-body-short navds-body-short--small"
								/>
							</div>
							<div>
								<Label size="small" htmlFor="reviewedTime">
									Tidspunkt
								</Label>
								<input
									type="time"
									id="reviewedTime"
									name="reviewedTime"
									defaultValue={defaultTime}
									className="navds-text-field__input navds-body-short navds-body-short--small"
								/>
							</div>
						</HStack>
					</VStack>
				</Box>

				<MarkdownEditor label="Oppsummering/referat" name="summary" defaultValue={review.summary ?? ""} />

				<TextField
					label="Deltakere"
					name="participants"
					size="small"
					description="Kommaseparert liste med NAV-identer"
					autoComplete="off"
					defaultValue={review.participants.map((p) => p.userIdent).join(", ")}
				/>

				{actionData?.intent === "update-review" && actionData.success && (
					<Alert variant="success" size="small">
						{actionData.message}
					</Alert>
				)}
				{actionData?.intent === "update-review" && actionData.error && (
					<Alert variant="error" size="small">
						{actionData.error}
					</Alert>
				)}

				<HStack>
					<Button type="submit" variant="primary" size="small">
						Lagre endringer
					</Button>
				</HStack>
			</VStack>
		</Form>
	)
}
