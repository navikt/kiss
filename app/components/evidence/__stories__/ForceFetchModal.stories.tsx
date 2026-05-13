import type { Meta, StoryObj } from "@storybook/react"
import { createRoutesStub } from "react-router"
import type { EvidenceItemStatus } from "~/lib/evidence-providers/types"
import { ForceFetchModal } from "../ForceFetchModal"

const meta = {
	title: "Komponenter/Evidence/ForceFetchModal",
	parameters: { layout: "centered" },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

function render(props: { status: EvidenceItemStatus; evidenceTypeLabel: string }) {
	const Wrapper = () => (
		<ForceFetchModal
			open={true}
			onClose={() => {}}
			onConfirm={() => {}}
			evidenceTypeLabel={props.evidenceTypeLabel}
			status={props.status}
		/>
	)
	const Stub = createRoutesStub([{ path: "/", Component: Wrapper }])
	return <Stub initialEntries={["/"]} />
}

export const PartialStatus: Story = {
	render: () => render({ status: "partial", evidenceTypeLabel: "Oracle Unified Audit-konfigurasjon" }),
}

export const FailedStatus: Story = {
	render: () => render({ status: "failed", evidenceTypeLabel: "Periodebasert gjennomgang" }),
}

export const PendingStatus: Story = {
	render: () => render({ status: "pending", evidenceTypeLabel: "Oracle-profiler" }),
}
