import type { Meta, StoryObj } from "@storybook/react"
import { mockGjennomgangDetaljData, mockGjennomgangDetaljOracleEvidenceData } from "@storybook-mocks/data"
import type { ComponentType } from "react"
import { createRoutesStub } from "react-router"
import GjennomgangDetalj from "../index"

// Mock API routes for Oracle evidence fetchers
const oracleApiRoutes = [
	{
		path: "api/oracle-evidence-status",
		loader: () => ({
			instanceId: "PENSJON_PROD",
			instanceName: "Pensjon Prod",
			collectedAt: "2026-03-01T10:00:00Z",
			reviewUrl: "https://pensjon-oracle-revisjon.ansatt.nav.no/PENSJON_PROD/audit/review",
			evidenceTypes: [
				{
					type: "audit",
					title: "Oracle Unified Audit",
					status: "OK",
					formats: ["EXCEL", "PDF"],
					available: true,
					error: null,
					review: null,
				},
			],
		}),
	},
	{
		path: "api/oracle-evidence-download",
		action: () => ({
			success: true,
			download: { id: "dl-new", fileName: "evidence.xlsx", sizeBytes: 1000, source: "m2m_api" },
		}),
	},
]

const basePath = "/seksjoner/pensjon-og-ufore/rutiner/routine-1/gjennomgang/rev-1"

// biome-ignore lint/suspicious/noExplicitAny: Route components have varying prop shapes from React Router
function renderWithLoaderAndApiRoutes(Component: ComponentType<any>, loaderData: unknown) {
	const Stub = createRoutesStub([{ path: basePath.slice(1), Component, loader: () => loaderData }, ...oracleApiRoutes])
	return <Stub initialEntries={[basePath]} />
}

const meta = {
	title: "Sider/Seksjoner/Rutiner/Gjennomgang/Detalj",
	component: GjennomgangDetalj,
} satisfies Meta<typeof GjennomgangDetalj>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	render: () => renderWithLoaderAndApiRoutes(GjennomgangDetalj, mockGjennomgangDetaljData()),
}

export const OracleEvidenceUtenNedlastinger: Story = {
	render: () => renderWithLoaderAndApiRoutes(GjennomgangDetalj, mockGjennomgangDetaljOracleEvidenceData()),
}

export const OracleEvidenceMedNedlastinger: Story = {
	render: () =>
		renderWithLoaderAndApiRoutes(GjennomgangDetalj, mockGjennomgangDetaljOracleEvidenceData({ withDownloads: true })),
}

export const OracleEvidenceAlleTyper: Story = {
	render: () =>
		renderWithLoaderAndApiRoutes(
			GjennomgangDetalj,
			mockGjennomgangDetaljOracleEvidenceData({
				evidenceTypes: ["audit", "profiles", "roles", "users", "period"],
				withDownloads: true,
			}),
		),
}

export const OracleEvidenceFullfort: Story = {
	render: () =>
		renderWithLoaderAndApiRoutes(
			GjennomgangDetalj,
			mockGjennomgangDetaljOracleEvidenceData({
				withDownloads: true,
				activityStatus: "completed",
			}),
		),
}
