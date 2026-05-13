import type { Meta, StoryObj } from "@storybook/react"
import { createRoutesStub } from "react-router"
import type { EvidenceStatusItem } from "~/lib/evidence-providers/types"
import { EvidenceStatusTable } from "../EvidenceStatusTable"

const mockEvidenceTypes: EvidenceStatusItem[] = [
	{
		id: "audit",
		label: "Oracle Unified Audit-konfigurasjon",
		status: "ok",
		formats: ["excel", "pdf"],
		canDownload: true,
		error: null,
	},
	{
		id: "profiles",
		label: "Oracle-profiler",
		status: "partial",
		formats: ["excel"],
		canDownload: true,
		error: null,
	},
	{
		id: "roles",
		label: "Oracle-roller",
		status: "failed",
		formats: ["excel"],
		canDownload: false,
		error: "Kunne ikke hente data fra databasen",
	},
	{
		id: "users",
		label: "Oracle-brukere",
		status: "pending",
		formats: ["excel"],
		canDownload: false,
		error: null,
	},
]

const meta = {
	title: "Komponenter/Evidence/EvidenceStatusTable",
	parameters: { layout: "padded" },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

function render(props: { showActions: boolean; isDownloading?: boolean }) {
	const Wrapper = () => (
		<EvidenceStatusTable
			evidenceTypes={mockEvidenceTypes}
			showActions={props.showActions}
			isDownloading={props.isDownloading ?? false}
			onDownload={() => {}}
		/>
	)
	const Stub = createRoutesStub([{ path: "/", Component: Wrapper }])
	return <Stub initialEntries={["/"]} />
}

export const MedHandlinger: Story = {
	render: () => render({ showActions: true }),
}

export const UtenHandlinger: Story = {
	render: () => render({ showActions: false }),
}

export const Nedlasting: Story = {
	render: () => render({ showActions: true, isDownloading: true }),
}
