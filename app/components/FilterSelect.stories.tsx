import type { Meta, StoryObj } from "@storybook/react"
import { useState } from "react"
import { FilterSelect } from "./FilterSelect"

const meta = {
	title: "Components/FilterSelect",
	component: FilterSelect,
	parameters: {
		layout: "centered",
	},
	tags: ["autodocs"],
} satisfies Meta<typeof FilterSelect>

export default meta
type Story = StoryObj<typeof meta>

const appOptions: Array<readonly [string, string]> = [
	["app-1", "pensjon-sak"],
	["app-2", "psak-frontend"],
]

export const Default: Story = {
	args: {
		label: "Applikasjon",
		allLabel: "Alle applikasjoner",
		value: "",
		options: appOptions,
		onChange: (value) => console.log("Filter changed to:", value),
	},
}

/** Interactive example showing how FilterSelect works with state (controlled mode). */
export const Interactive: Story = {
	args: {
		label: "Applikasjon",
		allLabel: "Alle applikasjoner",
		value: "",
		options: appOptions,
		onChange: () => {},
	},
	render: () => {
		const [value, setValue] = useState("")

		return (
			<div style={{ display: "flex", flexDirection: "column", gap: "1rem", minWidth: "200px" }}>
				<FilterSelect
					label="Applikasjon"
					allLabel="Alle applikasjoner"
					value={value}
					onChange={setValue}
					options={appOptions}
				/>
				<span>Valgt: {value || "Alle applikasjoner"}</span>
			</div>
		)
	},
}
