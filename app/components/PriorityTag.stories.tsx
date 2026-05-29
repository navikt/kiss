import type { Meta, StoryObj } from "@storybook/react"
import { PriorityTag } from "./PriorityTag"

const meta = {
	title: "Components/PriorityTag",
	component: PriorityTag,
	parameters: {
		layout: "centered",
	},
	tags: ["autodocs"],
	argTypes: {
		priority: {
			control: { type: "select" },
			options: [1, 2, 3],
			description: "Priority level: 1=Kritisk, 2=Høy, 3=Normal",
		},
		size: {
			control: { type: "radio" },
			options: ["small", "medium"],
		},
	},
} satisfies Meta<typeof PriorityTag>

export default meta
type Story = StoryObj<typeof meta>

export const Kritisk: Story = {
	args: {
		priority: 1,
		size: "small",
	},
}

export const Hoy: Story = {
	args: {
		priority: 2,
		size: "small",
	},
}

export const Normal: Story = {
	args: {
		priority: 3,
		size: "small",
	},
}

export const MediumSize: Story = {
	args: {
		priority: 1,
		size: "medium",
	},
}

export const AllPriorities: Story = {
	args: {
		priority: 1,
	},
	render: () => (
		<div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
			<PriorityTag priority={1} />
			<PriorityTag priority={2} />
			<PriorityTag priority={3} />
		</div>
	),
}
