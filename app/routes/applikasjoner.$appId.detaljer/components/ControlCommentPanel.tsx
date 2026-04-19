import { BodyShort, Box, Button, Detail, HStack, Label, Textarea, VStack } from "@navikt/ds-react"
import { useRef, useState } from "react"
import { useFetcher } from "react-router"

export function ControlCommentPanel({
	applicationControlId,
	comment,
	commentUpdatedAt,
	commentUpdatedBy,
	startEditing = false,
}: {
	applicationControlId: string | null
	comment: string | null
	commentUpdatedAt: string | null
	commentUpdatedBy: string | null
	startEditing?: boolean
}) {
	const fetcher = useFetcher()
	const [isEditing, setIsEditing] = useState(startEditing)
	const [editValue, setEditValue] = useState(comment ?? "")
	const isSaving = fetcher.state !== "idle"

	const prevStartEditing = useRef(startEditing)
	if (startEditing && !prevStartEditing.current) {
		setIsEditing(true)
	}
	prevStartEditing.current = startEditing

	if (!applicationControlId) {
		return (
			<Box padding="space-4">
				<BodyShort size="small" textColor="subtle">
					Kontroll er ikke synkronisert ennå. Kjør synkronisering for å aktivere kommentarer.
				</BodyShort>
			</Box>
		)
	}

	const handleSave = () => {
		fetcher.submit({ intent: "save-control-comment", applicationControlId, comment: editValue }, { method: "post" })
		setIsEditing(false)
	}

	return (
		<Box padding="space-4" paddingBlock="space-2">
			<VStack gap="space-2">
				<Label size="small">Kommentar</Label>
				{isEditing ? (
					<VStack gap="space-2">
						<Textarea
							label="Kommentar"
							hideLabel
							size="small"
							value={editValue}
							onChange={(e) => setEditValue(e.target.value)}
							maxRows={5}
							minRows={2}
						/>
						<HStack gap="space-2">
							<Button size="xsmall" variant="primary" onClick={handleSave} loading={isSaving}>
								Lagre
							</Button>
							<Button
								size="xsmall"
								variant="tertiary"
								onClick={() => {
									setIsEditing(false)
									setEditValue(comment ?? "")
								}}
							>
								Avbryt
							</Button>
						</HStack>
					</VStack>
				) : (
					<HStack gap="space-4" align="center">
						{comment ? (
							<BodyShort size="small">{comment}</BodyShort>
						) : (
							<BodyShort size="small" textColor="subtle">
								Ingen kommentar
							</BodyShort>
						)}
						<Button size="xsmall" variant="tertiary" onClick={() => setIsEditing(true)}>
							{comment ? "Rediger" : "Legg til"}
						</Button>
					</HStack>
				)}
				{commentUpdatedBy && commentUpdatedAt && (
					<Detail textColor="subtle">
						Sist oppdatert av {commentUpdatedBy},{" "}
						{new Date(commentUpdatedAt).toLocaleDateString("nb-NO", {
							day: "numeric",
							month: "short",
							year: "numeric",
							hour: "2-digit",
							minute: "2-digit",
						})}
					</Detail>
				)}
			</VStack>
		</Box>
	)
}
