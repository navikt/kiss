import { CheckmarkCircleIcon } from "@navikt/aksel-icons"
import { Alert, BodyLong, BodyShort, Box, Heading, HStack, Tag, Textarea, VStack } from "@navikt/ds-react"
import { useRef, useState } from "react"
import { Form, useActionData, useNavigation } from "react-router"
import { MarkdownPreview } from "~/components/MarkdownPreview"
import type { ComponentConfig } from "~/lib/manual-activity-staged-data"
import { StepAttachments } from "./StepAttachments"
import { ReviewLinksSection } from "./StepSummary"

type LinkItem = {
	id: string
	url: string
	title: string | null
	addedBy: string
	addedAt: string
	activityStepId: string | null
}

type Attachment = {
	id: string
	fileName: string
	contentType: string
	sizeBytes: number | null
	sourceType: string
	uploadedBy: string
	uploadedAt: string
	activityStepId: string | null
}

type ActionResult = {
	success: boolean
	error?: string
	intent?: string
}

type Props = {
	stepId: string
	activityId: string
	title: string
	description: string | null
	completedAt: string | null
	completedBy: string | null
	notes: string | null
	isDraft: boolean
	reviewId: string
	links: LinkItem[]
	attachments: Attachment[]
	/** Explicit component configuration. Absent = show all (backward compat with legacy data). */
	componentConfig?: ComponentConfig
}

export function StepManualActivityItem({
	stepId,
	activityId,
	title,
	description,
	completedAt,
	completedBy,
	notes,
	isDraft,
	reviewId,
	links,
	attachments,
	componentConfig,
}: Props) {
	const isCompleted = completedAt !== null

	const stepLinks = links.filter((l) => l.activityStepId === stepId)
	const stepAttachments = attachments.filter((a) => a.activityStepId === stepId)

	// undefined = not configured (legacy data) → show everything for backward compatibility
	// { items: [] } = explicitly configured with no components → show nothing
	const showAll = componentConfig === undefined
	const showNotes = showAll || componentConfig.items.some((c) => c.type === "notater")
	const showLinks = showAll || componentConfig.items.some((c) => c.type === "lenker")
	const showVedlegg = showAll || componentConfig.items.some((c) => c.type === "vedlegg")
	const notesRequired = componentConfig?.items.find((c) => c.type === "notater")?.required ?? false
	const linksRequired = componentConfig?.items.find((c) => c.type === "lenker")?.required ?? false
	const vedleggRequired = componentConfig?.items.find((c) => c.type === "vedlegg")?.required ?? false

	return (
		<VStack gap="space-12">
			<VStack gap="space-6">
				<HStack gap="space-4" align="center">
					<Heading size="medium" level="3">
						{title}
					</Heading>
					{isCompleted && (
						<Tag variant="success" size="small" icon={<CheckmarkCircleIcon aria-hidden />}>
							Fullført
						</Tag>
					)}
				</HStack>

				{description && (
					<Box padding="space-8" background="sunken" borderRadius="8">
						<MarkdownPreview content={description} />
					</Box>
				)}

				{completedAt && completedBy && (
					<BodyLong size="small" textColor="subtle">
						Fullført {new Date(completedAt).toLocaleDateString("nb-NO")} av {completedBy}
					</BodyLong>
				)}
			</VStack>

			{showNotes && (
				<StepNotesSection
					key={stepId}
					activityId={activityId}
					stepId={stepId}
					notes={notes}
					isDraft={isDraft}
					required={notesRequired}
				/>
			)}
			{showLinks && (
				<ReviewLinksSection links={stepLinks} isDraft={isDraft} activityStepId={stepId} required={linksRequired} />
			)}
			{showVedlegg && (
				<StepAttachments
					reviewId={reviewId}
					attachments={stepAttachments}
					isDraft={isDraft}
					activityStepId={stepId}
					required={vedleggRequired}
				/>
			)}
		</VStack>
	)
}

function StepNotesSection({
	activityId,
	stepId,
	notes,
	isDraft,
	required,
}: {
	activityId: string
	stepId: string
	notes: string | null
	isDraft: boolean
	required?: boolean
}) {
	const actionData = useActionData<ActionResult>()
	const navigation = useNavigation()
	const isSubmitting = navigation.state === "submitting"
	const [value, setValue] = useState(notes ?? "")
	const formRef = useRef<HTMLFormElement>(null)

	const heading = (
		<HStack gap="space-2" align="center">
			<Heading size="small" level="4">
				Notater
			</Heading>
			{required && (
				<Tag variant="warning" size="xsmall">
					Påkrevd
				</Tag>
			)}
		</HStack>
	)

	if (!isDraft) {
		if (!notes) {
			return (
				<VStack gap="space-4">
					{heading}
					<Box padding="space-6" borderRadius="8" background="sunken">
						<BodyShort>Ingen notater er skrevet.</BodyShort>
					</Box>
				</VStack>
			)
		}
		return (
			<VStack gap="space-4">
				{heading}
				<Box padding="space-8" borderWidth="1" borderColor="neutral-subtle" borderRadius="8">
					<BodyLong size="small" style={{ whiteSpace: "pre-wrap" }}>
						{notes}
					</BodyLong>
				</Box>
			</VStack>
		)
	}

	return (
		<VStack gap="space-4">
			{heading}
			<Form method="post" data-wizard-form ref={formRef}>
				<input type="hidden" name="intent" value="save-step-notes" />
				<input type="hidden" name="activityId" value={activityId} />
				<input type="hidden" name="stepId" value={stepId} />
				<VStack gap="space-4">
					<Textarea
						label="Notater for dette steget"
						hideLabel
						name="notes"
						value={value}
						onChange={(e) => setValue(e.target.value)}
						onBlur={() => {
							if (!isSubmitting) formRef.current?.requestSubmit()
						}}
						rows={4}
						resize="vertical"
					/>
					{actionData?.intent === "save-step-notes" && actionData.error && (
						<Alert variant="error" size="small">
							{actionData.error}
						</Alert>
					)}
				</VStack>
			</Form>
		</VStack>
	)
}
