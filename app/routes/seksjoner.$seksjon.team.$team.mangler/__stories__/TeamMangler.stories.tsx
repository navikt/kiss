import type { Meta, StoryObj } from "@storybook/react"
import { mockTeamGapsData, mockTeamGapsEmptyData } from "@storybook-mocks/data"
import { renderWithLoader } from "@storybook-mocks/router"
import TeamComplianceGaps from "../index"

const meta = {
	title: "Sider/Seksjoner/Team/Mangler",
	component: TeamComplianceGaps,
} satisfies Meta<typeof TeamComplianceGaps>
export default meta
type Story = StoryObj<typeof meta>

export const MedMangler: Story = {
	name: "Med mangler",
	render: () =>
		renderWithLoader(TeamComplianceGaps, mockTeamGapsData(), "/seksjoner/pensjon-og-ufore/team/starte-pensjon/mangler"),
}

export const IngenMangler: Story = {
	name: "Ingen mangler",
	render: () =>
		renderWithLoader(
			TeamComplianceGaps,
			mockTeamGapsEmptyData(),
			"/seksjoner/pensjon-og-ufore/team/starte-pensjon/mangler",
		),
}
