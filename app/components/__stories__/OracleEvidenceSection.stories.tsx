import type { Meta, StoryObj } from "@storybook/react"
import { mockOracleEvidenceActivity, mockOracleEvidenceData } from "@storybook-mocks/data"
import type React from "react"
import { createRoutesStub } from "react-router"
import { OracleEvidenceSection } from "../OracleEvidenceSection"

// Mock evidence status returned by the status API route
const mockEvidenceStatusResponse = {
	instanceId: "PENSJON_PROD",
	instanceName: "Pensjon Prod",
	collectedAt: "2026-03-01T10:00:00Z",
	reviewUrl: "https://pensjon-oracle-revisjon.ansatt.nav.no/PENSJON_PROD/audit/review",
	evidenceTypes: [
		{
			type: "audit",
			title: "Oracle Unified Audit-konfigurasjon",
			status: "OK",
			formats: ["EXCEL", "PDF"],
			available: true,
			error: null,
			review: null,
		},
		{
			type: "profiles",
			title: "Oracle-profiler",
			status: "OK",
			formats: ["EXCEL", "PDF"],
			available: true,
			error: null,
			review: null,
		},
		{
			type: "roles",
			title: "Oracle-roller",
			status: "OK",
			formats: ["EXCEL"],
			available: true,
			error: null,
			review: null,
		},
		{
			type: "users",
			title: "Oracle-brukere",
			status: "OK",
			formats: ["EXCEL"],
			available: true,
			error: null,
			review: null,
		},
		{
			type: "period",
			title: "Periodebasert gjennomgang",
			status: "PARTIAL",
			formats: ["EXCEL"],
			available: true,
			error: null,
			review: { totalStatements: 1250, reviewedStatements: 800, unreviewedStatements: 450, reviewProgress: 64 },
		},
	],
}

// Mock API routes needed by fetchers in OracleEvidenceSection
type StubRoute = {
	path: string
	loader?: () => unknown | Promise<unknown>
	action?: () => unknown | Promise<unknown>
}

const oracleApiRoutes: StubRoute[] = [
	{
		path: "/api/oracle-evidence-status",
		loader: () => mockEvidenceStatusResponse,
	},
	{
		path: "/api/oracle-evidence-download",
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

const delayedOracleApiRoutes = [
	oracleApiRoutes[0],
	{
		path: "/api/oracle-evidence-download",
		action: async () => {
			await new Promise((resolve) => window.setTimeout(resolve, 30_000))
			return {
				success: true,
				download: {
					id: "dl-delayed",
					fileName: "oracle-audit-2026-03-01.xlsx",
					sizeBytes: 1_200_000,
					source: "m2m_api",
				},
			}
		},
	},
]

function renderWithApiRoutes<TProps extends object>(
	Component: React.ComponentType<TProps>,
	props: TProps,
	routes = oracleApiRoutes,
) {
	const Wrapper = () => <Component {...props} />
	const Stub = createRoutesStub([{ path: "/", Component: Wrapper }, ...routes])
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

export const NedlastingPaagaar: Story = {
	parameters: {
		docs: {
			description: {
				story: "Klikk på en nedlastingsknapp for å se per-type loading state med sekundteller.",
			},
		},
	},
	render: () =>
		renderWithApiRoutes(
			OracleEvidenceSection,
			{
				activity: mockOracleEvidenceActivity(),
				oracleEvidenceData: mockOracleEvidenceData(),
				isDraft: true,
			},
			delayedOracleApiRoutes,
		),
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
