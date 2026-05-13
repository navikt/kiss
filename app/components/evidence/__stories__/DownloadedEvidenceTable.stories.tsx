import type { Meta, StoryObj } from "@storybook/react"
import { createRoutesStub } from "react-router"
import type { EvidenceDownload } from "../DownloadedEvidenceTable"
import { DownloadedEvidenceTable } from "../DownloadedEvidenceTable"

const mockDownloads: EvidenceDownload[] = [
	{
		id: "dl-1",
		instanceId: "PENSJON_PROD",
		evidenceType: "audit",
		format: "excel",
		fileName: "oracle-audit-2026-03-01.xlsx",
		sizeBytes: 1_200_000,
		source: "m2m_api",
		apiInstanceName: "Pensjon Prod",
		forceFetchJustification: null,
		performedBy: "A123456",
		performedAt: "2026-03-01T10:30:00Z",
	},
	{
		id: "dl-2",
		instanceId: "PENSJON_PROD",
		evidenceType: "profiles",
		format: "pdf",
		fileName: "oracle-profiles-manual.pdf",
		sizeBytes: 500_000,
		source: "manual_upload",
		apiInstanceName: null,
		forceFetchJustification: null,
		performedBy: "B654321",
		performedAt: "2026-03-02T14:00:00Z",
	},
	{
		id: "dl-3",
		instanceId: "PENSJON_PROD",
		evidenceType: "period",
		format: "excel",
		fileName: "oracle-period-2026-Q1.xlsx",
		sizeBytes: 3_500_000,
		source: "m2m_api",
		apiInstanceName: "Pensjon Prod",
		forceFetchJustification: "Haster med gjennomgangen, godkjent av seksjonsleder",
		performedBy: "A123456",
		performedAt: "2026-03-03T09:15:00Z",
	},
]

const evidenceTypeLabels: Record<string, string> = {
	audit: "Oracle Unified Audit-konfigurasjon",
	profiles: "Oracle-profiler",
	roles: "Oracle-roller",
	users: "Oracle-brukere",
	period: "Periodebasert gjennomgang",
}

const meta = {
	title: "Komponenter/Evidence/DownloadedEvidenceTable",
	parameters: { layout: "padded" },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

function render(downloads: EvidenceDownload[]) {
	const Wrapper = () => (
		<DownloadedEvidenceTable
			downloads={downloads}
			evidenceTypeLabels={evidenceTypeLabels}
			formatInstanceId={(id) => id.toUpperCase()}
		/>
	)
	const Stub = createRoutesStub([{ path: "/", Component: Wrapper }])
	return <Stub initialEntries={["/"]} />
}

export const MedNedlastinger: Story = {
	render: () => render(mockDownloads),
}

export const Tomt: Story = {
	render: () => render([]),
}

export const MedForceFetch: Story = {
	render: () => render(mockDownloads.filter((d) => d.forceFetchJustification)),
}
