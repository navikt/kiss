import type { Meta, StoryObj } from "@storybook/react"
import { createRoutesStub } from "react-router"
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
	name: "Standard",
	render: () => {
		const Wrapper = () => <PeriodSelector activityId="activity-1" />
		const Stub = createRoutesStub([
			{ path: "/", Component: Wrapper },
			{
				path: "/api/evidence-period-config",
				action: async () => ({ success: true }),
			},
		])
		return <Stub initialEntries={["/"]} />
	},
}
