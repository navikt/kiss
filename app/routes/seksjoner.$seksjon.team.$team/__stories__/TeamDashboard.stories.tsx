import type { Meta, StoryObj } from "@storybook/react"
import { mockTeamDetailData } from "@storybook-mocks/data"
import { renderWithLoader } from "@storybook-mocks/router"
import TeamDashboard from "../index"

const meta = {
	title: "Sider/Seksjoner/Team",
	component: TeamDashboard,
} satisfies Meta<typeof TeamDashboard>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	render: () =>
		renderWithLoader(TeamDashboard, mockTeamDetailData(), "/seksjoner/pensjon-og-ufore/team/starte-pensjon"),
}

export const RutineetterlevelseMiks: Story = {
	name: "Rutineetterlevelse – ulike tilstander",
	render: () =>
		renderWithLoader(
			TeamDashboard,
			{
				...mockTeamDetailData(),
				apps: [
					...mockTeamDetailData().apps,
					{
						appId: "app-4",
						appName: "pensjon-opptjening",
						implemented: 10,
						partial: 2,
						notImplemented: 0,
						notRelevant: 1,
						total: 13,
						source: "direct" as const,
						teamIds: ["t-01"],
						screeningProgress: { answered: 2, total: 6 },
						routineCompliance: { gjennomfort: 0, ikkeGjennomfort: 0, maaFolgesOpp: 0, total: 0 },
					},
					{
						appId: "app-5",
						appName: "pensjon-vedtak",
						implemented: 8,
						partial: 3,
						notImplemented: 4,
						notRelevant: 0,
						total: 15,
						source: "nais-team" as const,
						teamIds: ["t-01"],
						screeningProgress: { answered: 6, total: 6 },
						routineCompliance: { gjennomfort: 5, ikkeGjennomfort: 0, maaFolgesOpp: 0, total: 5 },
					},
				],
			},
			"/seksjoner/pensjon-og-ufore/team/starte-pensjon",
		),
}

export const IngenApplikasjoner: Story = {
	name: "Ingen applikasjoner",
	render: () =>
		renderWithLoader(
			TeamDashboard,
			{
				...mockTeamDetailData(),
				apps: [],
				totalImplemented: 0,
				totalPartial: 0,
				totalMangler: 0,
				overallPercent: 0,
			},
			"/seksjoner/pensjon-og-ufore/team/starte-pensjon",
		),
}
