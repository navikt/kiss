/**
 * Fullskjerm-stories for dokumentasjons-screenshots.
 * Brukes av scripts/capture-screenshots.ts for å generere PNG-bilder.
 *
 * Disse storiene viser sidene med fullstendig layout (header, navigasjon, breadcrumbs).
 */
import type { Meta, StoryObj } from "@storybook/react"
import {
	mockAdminImportData,
	mockAppDetaljerData,
	mockDeploymentStats,
	mockDokumenterData,
	mockGjennomgangDetaljData,
	mockGjennomgangDetaljOracleEvidenceData,
	mockKontrollrammeverkData,
	mockMineTeamData,
	mockNaisOvervakingData,
	mockOracleRollerData,
	mockSeksjonDetailData,
	mockSeksjonerData,
	mockTeamDetailData,
} from "@storybook-mocks/data"
import { renderWithLayout } from "@storybook-mocks/router"
import AdminImport from "./routes/admin.import/index"
import ApplikasjonDetalj from "./routes/applikasjoner.$appId.detaljer/index"
import Dashboard from "./routes/dashboard/index"
import Dokumenter from "./routes/dokumenter/index"
import Kontrollrammeverk from "./routes/kontrollrammeverk/index"
import MineTeamPage from "./routes/mine-team/index"
import NaisOvervaking from "./routes/nais-overvaking/index"
import Seksjoner from "./routes/seksjoner/index"
import SeksjonDashboard from "./routes/seksjoner.$seksjon/index"
import SeksjonOracleRoller from "./routes/seksjoner.$seksjon.oracle-roller/index"
import GjennomgangDetalj from "./routes/seksjoner.$seksjon.rutiner.$rutineId.gjennomgang.$gjennomgangId/index"
import TeamDashboard from "./routes/seksjoner.$seksjon.team.$team/index"

const meta: Meta = {
	title: "Fullskjerm",
	parameters: {
		layout: "fullscreen",
	},
}
export default meta
type Story = StoryObj

export const DashboardStory: Story = {
	name: "Dashboard",
	render: () =>
		renderWithLayout(Dashboard, {
			domainStatuses: [
				{
					code: "ST",
					name: "Sikkerhetstesting",
					implemented: 42,
					partial: 8,
					notImplemented: 5,
					notRelevant: 3,
					total: 58,
					controlCount: 12,
					controlsWithGaps: 3,
				},
				{
					code: "TS",
					name: "Tilgangsstyring",
					implemented: 35,
					partial: 12,
					notImplemented: 8,
					notRelevant: 5,
					total: 60,
					controlCount: 15,
					controlsWithGaps: 5,
				},
				{
					code: "PD",
					name: "Persondata",
					implemented: 28,
					partial: 6,
					notImplemented: 4,
					notRelevant: 2,
					total: 40,
					controlCount: 8,
					controlsWithGaps: 2,
				},
			],
			totalControls: 158,
			totalImplemented: 105,
			totalPartial: 26,
			totalMangler: 27,
			overallPercent: 70,
			deploymentStats: mockDeploymentStats(),
		}),
}

export const KontrollrammeverkStory: Story = {
	name: "Kontrollrammeverk",
	render: () =>
		renderWithLayout(Kontrollrammeverk, mockKontrollrammeverkData(), {
			path: "/kontrollrammeverk",
		}),
}

export const SeksjonerStory: Story = {
	name: "Seksjoner",
	render: () =>
		renderWithLayout(Seksjoner, mockSeksjonerData(), {
			path: "/seksjoner",
		}),
}

export const SeksjonDetaljerStory: Story = {
	name: "Seksjon detaljer",
	render: () =>
		renderWithLayout(SeksjonDashboard, mockSeksjonDetailData(), {
			path: "/seksjoner/pensjon-og-ufore",
		}),
}

export const TeamDetaljerStory: Story = {
	name: "Team detaljer",
	render: () =>
		renderWithLayout(TeamDashboard, mockTeamDetailData(), {
			path: "/seksjoner/pensjon-og-ufore/team/starte-pensjon",
		}),
}

export const ApplikasjonDetaljerStory: Story = {
	name: "Applikasjon detaljer",
	render: () =>
		renderWithLayout(ApplikasjonDetalj, mockAppDetaljerData(), {
			path: "/applikasjoner/app-1/detaljer",
		}),
}

export const MineTeamStory: Story = {
	name: "Mine team",
	render: () =>
		renderWithLayout(MineTeamPage, mockMineTeamData(), {
			path: "/mine-team",
		}),
}

export const NaisOvervakingStory: Story = {
	name: "Nais-overvåking",
	render: () =>
		renderWithLayout(NaisOvervaking, mockNaisOvervakingData(), {
			path: "/admin/nais-overvaking",
		}),
}

export const OracleRollerStory: Story = {
	name: "Oracle-roller",
	render: () =>
		renderWithLayout(SeksjonOracleRoller, mockOracleRollerData(), {
			path: "/seksjoner/pensjon-og-ufore/oracle-roller",
		}),
}

export const ApplikasjonAutorisertStory: Story = {
	name: "Autoriserte applikasjoner (dra og slipp CSV)",
	render: () =>
		renderWithLayout(ApplikasjonDetalj, mockAppDetaljerData(), {
			path: "/applikasjoner/app-1/detaljer",
			initialEntry: "/applikasjoner/app-1/detaljer?fane=autoriserte-applikasjoner",
		}),
}

export const DokumenterStory: Story = {
	name: "Dokumenter (dra og slipp filopplasting)",
	render: () =>
		renderWithLayout(Dokumenter, mockDokumenterData(), {
			path: "/dokumenter",
		}),
}

export const AdminImportStory: Story = {
	name: "Admin import (dra og slipp Excel)",
	render: () =>
		renderWithLayout(AdminImport, mockAdminImportData(), {
			path: "/admin/import",
			isAdmin: true,
		}),
}

export const GjennomgangDetaljStory: Story = {
	name: "Gjennomgang detalj (dra og slipp vedlegg)",
	render: () =>
		renderWithLayout(GjennomgangDetalj, mockGjennomgangDetaljData(), {
			path: "/seksjoner/pensjon-og-ufore/rutiner/routine-1/gjennomgang/rev-1",
			extraRoutes: [
				{ path: "/api/gjennomgang/:id/vedlegg", action: () => ({ success: true, message: "Vedlegg lastet opp." }) },
			],
		}),
}

export const GjennomgangOraclePeriodStory: Story = {
	name: "Gjennomgang detalj (Oracle periodebasert gjennomgang)",
	render: () =>
		renderWithLayout(
			GjennomgangDetalj,
			mockGjennomgangDetaljOracleEvidenceData({
				evidenceTypes: ["period"],
				withDownloads: true,
			}),
			{
				path: "/seksjoner/pensjon-og-ufore/rutiner/routine-1/gjennomgang/rev-1",
				extraRoutes: [
					{
						path: "/api/oracle-evidence-status",
						loader: () => ({
							instanceId: "PENSJON_PROD",
							instanceName: "Pensjon Prod",
							collectedAt: "2026-03-01T10:00:00Z",
							reviewUrl:
								"https://pensjon-oracle-revisjon.ansatt.nav.no/PENSJON_PROD/audit/review?fromUtc=2026-01-01&toUtc=2026-03-31",
							evidenceTypes: [
								{
									type: "period",
									title: "Periodebasert gjennomgang",
									status: "PARTIAL",
									formats: ["EXCEL"],
									available: true,
									error: null,
									review: {
										totalStatements: 1250,
										reviewedStatements: 800,
										unreviewedStatements: 450,
										reviewProgress: 64,
									},
								},
							],
						}),
					},
					{
						path: "/api/oracle-evidence-download",
						action: () => ({
							success: true,
							download: { id: "dl-new", fileName: "period-evidence.xlsx", sizeBytes: 2_400_000, source: "m2m_api" },
						}),
					},
					{
						path: "/api/gjennomgang/:id/vedlegg",
						action: () => ({ success: true, message: "Vedlegg lastet opp." }),
					},
				],
			},
		),
}
