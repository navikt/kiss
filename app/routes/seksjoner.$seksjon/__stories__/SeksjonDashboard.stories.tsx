import type { Meta, StoryObj } from "@storybook/react"
import { mockSeksjonDetailData } from "@storybook-mocks/data"
import { renderWithLoader } from "@storybook-mocks/router"
import SeksjonDashboard from "../index"

const meta: Meta = {
	title: "Sider/Seksjoner/Seksjon",
	component: SeksjonDashboard,
}
export default meta
type Story = StoryObj

export const Default: Story = {
	render: () => renderWithLoader(SeksjonDashboard, mockSeksjonDetailData(), "/seksjoner/pensjon-og-ufore"),
}

export const IngenTeam: Story = {
	name: "Ingen team",
	render: () =>
		renderWithLoader(
			SeksjonDashboard,
			{
				...mockSeksjonDetailData(),
				teams: [],
				totalApps: 0,
				totalImplemented: 0,
				totalPartial: 0,
				totalMangler: 0,
				overallPercent: 0,
			},
			"/seksjoner/pensjon-og-ufore",
		),
}
