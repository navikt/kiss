import type { Meta, StoryObj } from "@storybook/react"
import { useState } from "react"
import { PrioritySelect } from "./PrioritySelect"
import { PriorityTag } from "./PriorityTag"

const meta = {
	title: "Components/PrioritySelect",
	component: PrioritySelect,
	parameters: {
		layout: "centered",
	},
	tags: ["autodocs"],
	argTypes: {
		size: {
			control: { type: "radio" },
			options: ["small", "medium"],
		},
		disabled: {
			control: "boolean",
		},
		hideLabel: {
			control: "boolean",
		},
	},
} satisfies Meta<typeof PrioritySelect>

export default meta
type Story = StoryObj<typeof meta>

/** Controlled mode — used on the routine detail page. */
export const Default: Story = {
	args: {
		value: 3,
		onChange: (priority) => console.log("Priority changed to:", priority),
	},
}

export const Critical: Story = {
	args: {
		value: 1,
		onChange: (priority) => console.log("Priority changed to:", priority),
	},
}

export const Disabled: Story = {
	args: {
		value: 2,
		disabled: true,
		onChange: (priority) => console.log("Priority changed to:", priority),
	},
}

export const MediumSize: Story = {
	args: {
		value: 3,
		size: "medium",
		onChange: (priority) => console.log("Priority changed to:", priority),
	},
}

export const HiddenLabel: Story = {
	args: {
		value: 2,
		hideLabel: true,
		onChange: (priority) => console.log("Priority changed to:", priority),
	},
}

/**
 * Interactive example showing how PrioritySelect works with state (controlled mode).
 * Select a priority and see the visual indicator update.
 */
export const Interactive: Story = {
	args: {
		value: 3,
		onChange: () => {},
	},
	render: () => {
		const [priority, setPriority] = useState(3)

		return (
			<div style={{ display: "flex", flexDirection: "column", gap: "1rem", minWidth: "200px" }}>
				<PrioritySelect value={priority} onChange={setPriority} />
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
					<span>Valgt prioritet:</span>
					<PriorityTag priority={priority} />
				</div>
			</div>
		)
	},
}

/** Form mode — used in create/edit forms. Uses `name` + `defaultValue` instead of `value`/`onChange`. */
export const FormMode: Story = {
	args: {
		name: "priority",
		defaultValue: 2,
	},
}
