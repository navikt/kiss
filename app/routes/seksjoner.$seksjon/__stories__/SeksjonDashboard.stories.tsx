import type { Meta, StoryObj } from "@storybook/react"
import { mockSeksjonDetailData } from "@storybook-mocks/data"
import { renderWithLoader } from "@storybook-mocks/router"
import SeksjonDashboard from "../index"

const meta = {
	title: "Sider/Seksjoner/Seksjon",
	component: SeksjonDashboard,
} satisfies Meta<typeof SeksjonDashboard>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	render: () => renderWithLoader(SeksjonDashboard, mockSeksjonDetailData(), "/seksjoner/pensjon-og-ufore"),
}

export const IngenOkonomisystemer: Story = {
	name: "Ingen økonomisystemer",
	render: () =>
		renderWithLoader(
			SeksjonDashboard,
			{ ...mockSeksjonDetailData(), economySystemCount: 0 },
			"/seksjoner/pensjon-og-ufore",
		),
}

export const IkkeAdmin: Story = {
	name: "Ikke admin",
	render: () =>
		renderWithLoader(SeksjonDashboard, { ...mockSeksjonDetailData(), canAdmin: false }, "/seksjoner/pensjon-og-ufore"),
}

export const IngenTeam: Story = {
	name: "Ingen team",
	render: () =>
		renderWithLoader(
			SeksjonDashboard,
			{
				...mockSeksjonDetailData(),
				teams: [],
				unassigned: { apps: 0, implemented: 0, partial: 0, notImplemented: 0, notRelevant: 0, total: 0 },
				totalApps: 0,
				totalImplemented: 0,
				totalPartial: 0,
				totalMangler: 0,
				overallPercent: 0,
				economySystemCount: 0,
			},
			"/seksjoner/pensjon-og-ufore",
		),
}
