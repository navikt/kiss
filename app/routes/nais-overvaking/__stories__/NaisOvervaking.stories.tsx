import type { Meta, StoryObj } from "@storybook/react"
import { mockNaisOvervakingData } from "@storybook-mocks/data"
import { renderWithLoader } from "@storybook-mocks/router"
import NaisOvervaking from "../index"

const meta: Meta = {
	title: "Sider/Nais-overvåking",
	component: NaisOvervaking,
}
export default meta
type Story = StoryObj

export const Default: Story = {
	render: () => renderWithLoader(NaisOvervaking, mockNaisOvervakingData()),
}

export const IngenTeam: Story = {
	name: "Ingen team",
	render: () =>
		renderWithLoader(NaisOvervaking, {
			teams: [],
			sections: [],
			lastSync: null,
		}),
}
