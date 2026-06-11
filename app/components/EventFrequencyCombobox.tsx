import { Select, TextField, VStack } from "@navikt/ds-react"
import { useEffect, useRef, useState } from "react"
import { EVENT_FREQUENCY_SUGGESTIONS } from "~/lib/routine-frequencies"

export function EventFrequencyCombobox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
	const isPredefined = (EVENT_FREQUENCY_SUGGESTIONS as readonly string[]).includes(value)
	const [selected, setSelected] = useState(isPredefined ? value : value ? "custom" : "")
	const [customText, setCustomText] = useState(isPredefined ? "" : value)
	const lastEmitted = useRef(value)

	// Sync internal state only when parent changes value externally
	useEffect(() => {
		if (value === lastEmitted.current) return

		lastEmitted.current = value
		const predefined = (EVENT_FREQUENCY_SUGGESTIONS as readonly string[]).includes(value)
		if (predefined) {
			setSelected(value)
			setCustomText("")
		} else if (value) {
			setSelected("custom")
			setCustomText(value)
		} else {
			setSelected("")
			setCustomText("")
		}
	}, [value])

	const handleChange = (newSelected: string) => {
		setSelected(newSelected)
		if (newSelected !== "custom") {
			lastEmitted.current = newSelected
			onChange(newSelected)
		} else {
			// Switching to custom — emit current custom text (empty initially)
			lastEmitted.current = customText
			onChange(customText)
		}
	}

	const handleCustomChange = (text: string) => {
		setCustomText(text)
		lastEmitted.current = text
		onChange(text)
	}

	const effectiveValue = selected === "custom" ? customText : selected

	return (
		<VStack gap="space-4" style={{ flex: "1 1 0" }}>
			<input type="hidden" name="eventFrequency" value={effectiveValue} />
			<Select
				label="Hendelsesbasert frekvens"
				size="small"
				value={selected}
				onChange={(e) => handleChange(e.target.value)}
			>
				<option value="">Ingen</option>
				{EVENT_FREQUENCY_SUGGESTIONS.map((opt) => (
					<option key={opt} value={opt}>
						{opt}
					</option>
				))}
				<option value="custom">Annet (egendefinert)</option>
			</Select>
			{selected === "custom" && (
				<TextField
					label="Egendefinert hendelsesfrekvens"
					size="small"
					value={customText}
					onChange={(e) => handleCustomChange(e.target.value)}
				/>
			)}
		</VStack>
	)
}
