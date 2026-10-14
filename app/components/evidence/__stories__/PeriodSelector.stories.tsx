import { BodyShort, VStack } from "@navikt/ds-react"
import type { Meta, StoryObj } from "@storybook/react"
import { useState } from "react"
import { PeriodSelector } from "../PeriodSelector"

const meta = {
	title: "Komponenter/PeriodSelector",
	parameters: {
		layout: "padded",
	},
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	name: "Standard (årlig)",
	render: () => <PeriodSelector onSelectPeriod={() => {}} />,
}

export const MedValgtPeriode: Story = {
	name: "Sender valgt periode videre",
	render: () => {
		const Wrapper = () => {
			const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null)
			return (
				<VStack gap="space-16">
					<PeriodSelector
						onSelectPeriod={({ periodType, periodStart }) => setSelectedPeriod(`${periodType}: ${periodStart}`)}
					/>
					{selectedPeriod && <BodyShort>Valgt periode: {selectedPeriod}</BodyShort>}
				</VStack>
			)
		}
		return <Wrapper />
	},
}
