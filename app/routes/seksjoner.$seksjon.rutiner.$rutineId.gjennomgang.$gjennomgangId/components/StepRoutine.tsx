import { Link as AkselLink, BodyShort, Heading, Label, VStack } from "@navikt/ds-react"
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
			<Heading size="medium" level="3">
				Rutine
			</Heading>

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

			{routineDescriptionHtml ? (
				<div
					className="markdown-content"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: server-sanitized
					dangerouslySetInnerHTML={{ __html: routineDescriptionHtml }}
				/>
			) : (
				<BodyShort textColor="subtle">Rutinen har ingen beskrivelse.</BodyShort>
			)}
		</VStack>
	)
}
