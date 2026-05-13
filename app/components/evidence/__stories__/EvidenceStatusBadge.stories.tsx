import type { Meta, StoryObj } from "@storybook/react"
import { EvidenceStatusBadge } from "../EvidenceStatusBadge"

const meta = {
	title: "Komponenter/Evidence/EvidenceStatusBadge",
	component: EvidenceStatusBadge,
	parameters: { layout: "centered" },
} satisfies Meta<typeof EvidenceStatusBadge>
export default meta
type Story = StoryObj<typeof meta>

export const Ok: Story = { args: { status: "ok" } }
export const Partial: Story = { args: { status: "partial" } }
export const Failed: Story = { args: { status: "failed" } }
export const Pending: Story = { args: { status: "pending" } }
export const Processing: Story = { args: { status: "processing" } }
export const NotAvailable: Story = { args: { status: "not_available" } }
