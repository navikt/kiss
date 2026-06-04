import { HStack, Tag } from "@navikt/ds-react"

interface RoutineStatusTagProps {
	overdue: boolean
	lastReviewDate: Date | string | null
	needsFollowUp?: boolean
	draftReviewId?: string | null
}

/**
 * Viser statusmerker for en rutine:
 * - "Pågående" (info) hvis det finnes en aktiv kladdegjennomgang
 * - "Over frist" (error) hvis rutinen er forfalt
 * - "OK" (success) hvis siste gjennomgang er innenfor frist
 * - "Ikke gjennomført" (warning) hvis rutinen aldri er gjennomgått
 * - "Må følges opp" (warning) vises i tillegg hvis rutinen krever oppfølging
 */
export function RoutineStatusTag({ overdue, lastReviewDate, needsFollowUp, draftReviewId }: RoutineStatusTagProps) {
	return (
		<HStack gap="space-2" align="center" wrap>
			{draftReviewId ? (
				<Tag variant="info" size="small">
					Pågående
				</Tag>
			) : overdue ? (
				<Tag variant="error" size="small">
					Over frist
				</Tag>
			) : lastReviewDate ? (
				<Tag variant="success" size="small">
					OK
				</Tag>
			) : (
				<Tag variant="warning" size="small">
					Ikke gjennomført
				</Tag>
			)}
			{needsFollowUp && (
				<Tag variant="warning" size="small">
					Må følges opp
				</Tag>
			)}
		</HStack>
	)
}
