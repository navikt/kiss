import { Link as AkselLink, BodyShort, Box, Heading, HStack, Label, VStack } from "@navikt/ds-react"
import { Link } from "react-router"
import { getFrequencyLabel } from "~/lib/routine-frequencies"
import { formatDateTime } from "../shared"

type ReadOnlyHeaderProps = {
	section: { slug: string }
	routine: { id: string; name: string; frequency: string }
	review: {
		reviewedAt: string
		createdAt: string
		createdBy: string
		applicationId: string | null
		applicationName: string | null
		summaryHtml: string | null
	}
}

export function ReadOnlyHeader({ section, routine, review }: ReadOnlyHeaderProps) {
	return (
		<>
			{/* Metadata (read-only) */}
			<Box padding="space-8" borderWidth="1" borderColor="neutral-subtle" borderRadius="8">
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
					<VStack gap="space-2">
						<Label size="small">Gjennomgangsdato</Label>
						<BodyShort>{formatDateTime(review.reviewedAt)}</BodyShort>
					</VStack>
					<VStack gap="space-2">
						<Label size="small">Opprettet av</Label>
						<BodyShort>{review.createdBy}</BodyShort>
					</VStack>
					<VStack gap="space-2">
						<Label size="small">Opprettet</Label>
						<BodyShort>{formatDateTime(review.createdAt)}</BodyShort>
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
				</HStack>
			</Box>

			{/* Summary (read-only) */}
			{review.summaryHtml && (
				<VStack gap="space-2">
					<Heading size="medium" level="3">
						Oppsummering / referat
					</Heading>
					<Box padding="space-8" borderWidth="1" borderColor="neutral-subtle" borderRadius="8">
						<div
							className="markdown-content"
							// biome-ignore lint/security/noDangerouslySetInnerHtml: server-sanitized
							dangerouslySetInnerHTML={{ __html: review.summaryHtml }}
						/>
					</Box>
				</VStack>
			)}
		</>
	)
}
