import type { Meta, StoryObj } from "@storybook/react"
import { mockOracleEvidenceActivity, mockOracleEvidenceData } from "@storybook-mocks/data"
import type React from "react"
import { createRoutesStub } from "react-router"
import { OracleEvidenceSection } from "../evidence"

// Mock evidence status returned by the status API route (normalized EvidenceStatusResponse format)
const mockEvidenceStatusResponse = {
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
		{
			id: "profiles",
			label: "Oracle-profiler",
			status: "ok",
			formats: ["excel", "pdf"],
			canDownload: true,
			error: null,
		},
		{
			id: "roles",
			label: "Oracle-roller",
			status: "ok",
			formats: ["excel"],
			canDownload: true,
			error: null,
		},
		{
			id: "users",
			label: "Oracle-brukere",
			status: "ok",
			formats: ["excel"],
			canDownload: true,
			error: null,
		},
		{
			id: "period",
			label: "Periodebasert gjennomgang",
			status: "partial",
			formats: ["excel"],
			canDownload: true,
			error: null,
			details: {
				review: {
					totalStatements: 1250,
					reviewedStatements: 800,
					unreviewedStatements: 450,
					reviewProgress: 64,
				},
			},
		},
	],
	metadata: { instanceId: "PENSJON_PROD", instanceName: "Pensjon Prod" },
}

// Mock API routes needed by fetchers in OracleEvidenceSection
const oracleApiRoutes = [
	{
		path: "/api/evidence-status",
		loader: () => mockEvidenceStatusResponse,
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
	title: "Komponenter/OracleEvidenceSection",
	parameters: {
		layout: "padded",
	},
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const TomUtenNedlastinger: Story = {
	render: () =>
		renderWithApiRoutes(OracleEvidenceSection, {
			activity: mockOracleEvidenceActivity(),
			oracleEvidenceData: mockOracleEvidenceData(),
			isDraft: true,
		}),
}

export const MedNedlastinger: Story = {
	render: () =>
		renderWithApiRoutes(OracleEvidenceSection, {
			activity: mockOracleEvidenceActivity(),
			oracleEvidenceData: mockOracleEvidenceData({ withDownloads: true }),
			isDraft: true,
		}),
}

export const EnkeltInstans: Story = {
	render: () =>
		renderWithApiRoutes(OracleEvidenceSection, {
			activity: mockOracleEvidenceActivity(),
			oracleEvidenceData: {
				...mockOracleEvidenceData({ withDownloads: true }),
				configuredInstances: [{ instanceId: "PENSJON_PROD" }],
			},
			isDraft: true,
		}),
}

export const FlereBevistyper: Story = {
	render: () =>
		renderWithApiRoutes(OracleEvidenceSection, {
			activity: {
				...mockOracleEvidenceActivity(),
				type: "oracle_evidence_all",
			},
			oracleEvidenceData: mockOracleEvidenceData({
				evidenceTypes: ["audit", "profiles", "roles", "users", "period"],
				withDownloads: true,
			}),
			isDraft: true,
		}),
}

export const Periodebasert: Story = {
	render: () =>
		renderWithApiRoutes(OracleEvidenceSection, {
			activity: {
				...mockOracleEvidenceActivity(),
				type: "oracle_evidence_period",
			},
			oracleEvidenceData: mockOracleEvidenceData({
				evidenceTypes: ["period"],
			}),
			isDraft: true,
		}),
}

export const AktivitetFullfort: Story = {
	render: () =>
		renderWithApiRoutes(OracleEvidenceSection, {
			activity: mockOracleEvidenceActivity({
				status: "completed",
				completedAt: "2026-03-05T14:00:00Z",
			}),
			oracleEvidenceData: mockOracleEvidenceData({ withDownloads: true }),
			isDraft: false,
		}),
}

export const IngenInstanser: Story = {
	render: () =>
		renderWithApiRoutes(OracleEvidenceSection, {
			activity: mockOracleEvidenceActivity(),
			oracleEvidenceData: {
				...mockOracleEvidenceData(),
				configuredInstances: [],
			},
			isDraft: true,
		}),
}
