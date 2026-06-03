import { BodyShort, Tag } from "@navikt/ds-react"
import { getCompositeFrequencyLabel, getFrequencyLabel } from "~/lib/routine-frequencies"

/**
 * Consistent display of routine frequency (periodic and/or event-based).
 * Use this everywhere frequency is shown in the UI.
 */
export function FrequencyDisplay({
	frequency,
	eventFrequency,
	size = "small",
}: {
	frequency: string | null | undefined
	eventFrequency?: string | null | undefined
	size?: "small" | "medium"
}) {
	const tagSize = size === "medium" ? "small" : "xsmall"

	if (!frequency && !eventFrequency) {
		return <BodyShort size={size}>—</BodyShort>
	}

	if (!frequency) {
		return (
			<Tag variant="alt3" size={tagSize}>
				{eventFrequency}
			</Tag>
		)
	}

	if (!eventFrequency) {
		return <BodyShort size={size}>{getFrequencyLabel(frequency)}</BodyShort>
	}

	return (
		<BodyShort size={size}>
			{getFrequencyLabel(frequency)}{" "}
			<Tag variant="alt3" size={tagSize}>
				Også {eventFrequency.toLowerCase()}
			</Tag>
		</BodyShort>
	)
}

/**
 * Plain-text version for contexts where Tags don't fit (e.g. exports, PDFs).
 */
export function frequencyDisplayText(frequency: string | null | undefined, eventFrequency: string | null | undefined) {
	return getCompositeFrequencyLabel(frequency, eventFrequency)
}
