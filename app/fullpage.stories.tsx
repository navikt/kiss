/**
 * Fullskjerm-stories for dokumentasjons-screenshots.
 * Brukes av scripts/capture-screenshots.ts for å generere PNG-bilder.
 *
 * Disse storiene viser sidene med fullstendig layout (header, navigasjon, breadcrumbs).
 */
import type { Meta, StoryObj } from "@storybook/react"
import {
	mockAppDetaljerData,
	mockDeploymentStats,
	mockKontrollrammeverkData,
	mockMineTeamData,
	mockNaisOvervakingData,
	mockOracleProfilerData,
	mockSeksjonDetailData,
	mockSeksjonerData,
	mockTeamDetailData,
} from "@storybook-mocks/data"
import { renderWithLayout } from "@storybook-mocks/router"
import ApplikasjonDetalj from "./routes/applikasjoner.$appId.detaljer/index"
import Dashboard from "./routes/dashboard/index"
import Kontrollrammeverk from "./routes/kontrollrammeverk/index"
import MineTeamPage from "./routes/mine-team/index"
import NaisOvervaking from "./routes/nais-overvaking/index"
import Seksjoner from "./routes/seksjoner/index"
import SeksjonDashboard from "./routes/seksjoner.$seksjon/index"
import SeksjonOracleProfiler from "./routes/seksjoner.$seksjon.oracle-profiler/index"
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

export const OracleProfilerStory: Story = {
	name: "Oracle-profiler",
	render: () =>
		renderWithLayout(SeksjonOracleProfiler, mockOracleProfilerData(), {
			path: "/seksjoner/pensjon-og-ufore/oracle-profiler",
		}),
}
