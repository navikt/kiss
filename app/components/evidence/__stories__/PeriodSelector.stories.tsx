import type { Meta, StoryObj } from "@storybook/react"
import { useState } from "react"
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
	name: "Standard (årlig)",
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

export const MedOnSaved: Story = {
	name: "Med onSaved callback",
	render: () => {
		const Wrapper = () => {
			const [savedCount, setSavedCount] = useState(0)
			return (
				<div>
					<PeriodSelector activityId="activity-1" onSaved={() => setSavedCount((c) => c + 1)} />
					{savedCount > 0 && (
						<p style={{ marginTop: "1rem", color: "var(--ax-text-success)" }}>
							✓ onSaved kalt {savedCount} gang{savedCount > 1 ? "er" : ""}
						</p>
					)}
				</div>
			)
		}
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

export const ValideringsfeilFraApi: Story = {
	name: "Valideringsfeil fra API",
	render: () => {
		const Wrapper = () => <PeriodSelector activityId="activity-1" />
		const Stub = createRoutesStub([
			{ path: "/", Component: Wrapper },
			{
				path: "/api/evidence-period-config",
				action: async () => ({ error: "Perioden er ikke avsluttet ennå" }),
			},
		])
		return <Stub initialEntries={["/"]} />
	},
}
