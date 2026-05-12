import type { Meta, StoryObj } from "@storybook/react"
import { mockGjennomgangDetaljData, mockGjennomgangDetaljOracleEvidenceData } from "@storybook-mocks/data"
import { renderWithLoader } from "@storybook-mocks/router"
import type { ComponentType } from "react"
import { createRoutesStub } from "react-router"
import GjennomgangDetalj from "../index"

// Mock API routes for Oracle evidence fetchers
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
					label: "Oracle Unified Audit",
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
			download: { id: "dl-new", fileName: "evidence.xlsx", sizeBytes: 1000, source: "m2m_api" },
		}),
	},
]

const PATH = "/seksjoner/pensjon-og-ufore/rutiner/routine-1/gjennomgang/rev-1"
const basePath = PATH

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

export const Utkast: Story = {
	name: "Utkast (uten oppfølgingspunkter)",
	render: () => renderWithLoader(GjennomgangDetalj, mockGjennomgangDetaljData({ status: "draft" }), PATH),
}

export const UtkastMedOppfølgingspunkter: Story = {
	name: "Utkast med oppfølgingspunkter",
	render: () =>
		renderWithLoader(GjennomgangDetalj, mockGjennomgangDetaljData({ status: "draft", followUpPoints: "mixed" }), PATH),
}

export const MåFølgesOpp: Story = {
	name: "Må følges opp (åpne punkter)",
	render: () =>
		renderWithLoader(
			GjennomgangDetalj,
			mockGjennomgangDetaljData({ status: "needs_follow_up", followUpPoints: "all_open" }),
			PATH,
		),
}

export const MåFølgesOppDelvisAdressert: Story = {
	name: "Må følges opp (delvis adressert)",
	render: () =>
		renderWithLoader(
			GjennomgangDetalj,
			mockGjennomgangDetaljData({ status: "needs_follow_up", followUpPoints: "mixed" }),
			PATH,
		),
}

export const Fullført: Story = {
	name: "Fullført (alle punkter adressert)",
	render: () =>
		renderWithLoader(
			GjennomgangDetalj,
			mockGjennomgangDetaljData({ status: "completed", followUpPoints: "all_resolved" }),
			PATH,
		),
}

export const FullførtUtenPunkter: Story = {
	name: "Fullført uten oppfølgingspunkter",
	render: () =>
		renderWithLoader(
			GjennomgangDetalj,
			mockGjennomgangDetaljData({ status: "completed", followUpPoints: "none" }),
			PATH,
		),
}

export const Forkastet: Story = {
	name: "Forkastet",
	render: () => renderWithLoader(GjennomgangDetalj, mockGjennomgangDetaljData({ status: "discarded" }), PATH),
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
