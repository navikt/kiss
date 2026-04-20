import type { Meta, StoryObj } from "@storybook/react"
import { mockMineTeamData, mockMineTeamEmptyData } from "@storybook-mocks/data"
import { renderWithLoader } from "@storybook-mocks/router"
import MineTeamPage from "../index"

const meta: Meta = {
	title: "Sider/Mine team",
	component: MineTeamPage,
}
export default meta
type Story = StoryObj

export const Default: Story = {
	render: () => renderWithLoader(MineTeamPage, mockMineTeamData()),
}

export const IngenTeam: Story = {
	name: "Ingen team",
	render: () => renderWithLoader(MineTeamPage, mockMineTeamEmptyData()),
}
