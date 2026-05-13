import type { Meta, StoryObj } from "@storybook/react"
import { mockOracleEvidenceActivity, mockOracleEvidenceData } from "@storybook-mocks/data"
import type React from "react"
import { createRoutesStub } from "react-router"
import { EvidenceSection } from "../EvidenceSection"

const oracleApiRoutes = [
	{
		path: "/api/evidence-status",
		loader: () => ({
			providerType: "oracle",
			sourceLabel: "Pensjon Prod",
			collectedAt: "2026-03-01T10:00:00Z",
			externalUrl: "https://pensjon-oracle-revisjon.ansatt.nav.no/PENSJON_PROD/audit/review",
			items: [
				{
					id: "audit",
					label: "Oracle Unified Audit-konfigurasjon",
					status: "ok",
					formats: ["excel", "pdf"],
					canDownload: true,
					error: null,
				},
			],
			metadata: { instanceId: "PENSJON_PROD", instanceName: "Pensjon Prod" },
		}),
	},
	{
		path: "/api/evidence-download",
		action: () => ({
			success: true,
			download: {
				id: "dl-new",
				fileName: "oracle-audit-2026-03-01.xlsx",
				sizeBytes: 1_200_000,
				source: "m2m_api",
			},
		}),
	},
]

// biome-ignore lint/suspicious/noExplicitAny: Storybook render prop typing
function renderWithApiRoutes(Component: React.ComponentType<any>, props: Record<string, unknown>) {
	const Wrapper = () => <Component {...props} />
	const Stub = createRoutesStub([{ path: "/", Component: Wrapper }, ...oracleApiRoutes])
	return <Stub initialEntries={["/"]} />
}

const meta = {
	title: "Komponenter/EvidenceSection",
	parameters: {
		layout: "padded",
	},
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const OracleProvider: Story = {
	name: "Oracle-provider",
	render: () =>
		renderWithApiRoutes(EvidenceSection, {
			providerType: "oracle",
			activity: mockOracleEvidenceActivity(),
			evidenceData: mockOracleEvidenceData({ withDownloads: true }),
			isDraft: true,
		}),
}

export const OracleProviderFullfort: Story = {
	name: "Oracle-provider (fullført)",
	render: () =>
		renderWithApiRoutes(EvidenceSection, {
			providerType: "oracle",
			activity: mockOracleEvidenceActivity({ status: "completed", completedAt: "2026-03-05T14:00:00Z" }),
			evidenceData: mockOracleEvidenceData({ withDownloads: true }),
			isDraft: false,
		}),
}

export const DeploymentsPlaceholder: Story = {
	name: "Deployments-placeholder",
	render: () => {
		const Wrapper = () => (
			<EvidenceSection
				providerType="deployments"
				activity={{
					id: "activity-nda-1",
					type: "deployment_evidence_report",
					status: "pending",
					completedAt: null,
					createdAt: "2026-03-01T08:00:00Z",
				}}
				isDraft={true}
			/>
		)
		const Stub = createRoutesStub([{ path: "/", Component: Wrapper }])
		return <Stub initialEntries={["/"]} />
	},
}
