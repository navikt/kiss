import type { Meta, StoryObj } from "@storybook/react"
import { useState } from "react"
import { EventFrequencyCombobox } from "../EventFrequencyCombobox"

function EventFrequencyWrapper({ initialValue = "" }: { initialValue?: string }) {
	const [value, setValue] = useState(initialValue)
	return (
		<div style={{ maxWidth: 400 }}>
			<EventFrequencyCombobox value={value} onChange={setValue} />
			<p style={{ marginTop: "1rem", color: "var(--ax-text-subtle)" }}>
				Verdi: <code>{value || "(tom)"}</code>
			</p>
		</div>
	)
}

const meta = {
	title: "Components/EventFrequencyCombobox",
	component: EventFrequencyWrapper,
} satisfies Meta<typeof EventFrequencyWrapper>

export default meta
type Story = StoryObj<typeof meta>

export const Tom: Story = {
	args: { initialValue: "" },
}

export const ForhåndsdefinertValgt: Story = {
	args: { initialValue: "Ved behov" },
}

export const EgendefinertTekst: Story = {
	args: { initialValue: "Ved endring i trusselbildet" },
}

export const VedEndring: Story = {
	args: { initialValue: "Ved endring" },
}
