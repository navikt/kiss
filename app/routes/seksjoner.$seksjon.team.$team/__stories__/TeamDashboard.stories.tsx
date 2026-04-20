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
