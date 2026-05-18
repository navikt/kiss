import { Link as AkselLink, BodyShort, Box, Heading, Label, VStack } from "@navikt/ds-react"
import { Link } from "react-router"
import { FrequencyDisplay } from "~/components/FrequencyDisplay"

type Props = {
	routine: {
		id: string
		name: string
		description: string | null
		frequency: string | null
		eventFrequency: string | null
		responsibleRole: string | null
	}
	routineDescriptionHtml: string | null
	sectionSlug: string
}

export function StepRoutine({ routine, routineDescriptionHtml, sectionSlug }: Props) {
	return (
		<VStack gap="space-6">
			<div>
				<Heading size="medium" level="3" spacing>
					Rutine
				</Heading>
				<BodyShort size="small" textColor="subtle">
					Les gjennom rutinebeskrivelsen. Vurder om rutinen er oppdatert og relevant.
				</BodyShort>
			</div>

			<Box padding="space-8" borderWidth="1" borderColor="neutral-subtle" borderRadius="8">
				<VStack gap="space-4">
					<Heading size="small" level="4">
						<AkselLink as={Link} to={`/seksjoner/${sectionSlug}/rutiner/${routine.id}`}>
							{routine.name}
						</AkselLink>
					</Heading>

					{routine.frequency && (
						<div>
							<Label size="small">Frekvens</Label>
							<FrequencyDisplay frequency={routine.frequency} eventFrequency={routine.eventFrequency} />
						</div>
					)}

					{routine.responsibleRole && (
						<div>
							<Label size="small">Ansvarlig rolle</Label>
							<BodyShort>{routine.responsibleRole}</BodyShort>
						</div>
					)}
				</VStack>
			</Box>

			{routineDescriptionHtml ? (
				<Box padding="space-8" borderWidth="1" borderColor="neutral-subtle" borderRadius="8">
					<div
						className="markdown-content"
						// biome-ignore lint/security/noDangerouslySetInnerHtml: server-sanitized
						dangerouslySetInnerHTML={{ __html: routineDescriptionHtml }}
					/>
				</Box>
			) : (
				<BodyShort textColor="subtle">Rutinen har ingen beskrivelse.</BodyShort>
			)}
		</VStack>
	)
}
