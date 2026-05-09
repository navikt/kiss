import type { Meta, StoryObj } from "@storybook/react"
import { mockSeksjonsrutinerData } from "@storybook-mocks/data"
import { renderWithLoader } from "@storybook-mocks/router"
import Seksjonsrutiner from "../index"

const meta = {
	title: "Sider/Seksjoner/Seksjonsrutiner",
	component: Seksjonsrutiner,
} satisfies Meta<typeof Seksjonsrutiner>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	name: "Med seksjonsrutiner",
	render: () =>
		renderWithLoader(Seksjonsrutiner, mockSeksjonsrutinerData(), "/seksjoner/pensjon-og-ufore/seksjonsrutiner"),
}

export const Ingen: Story = {
	name: "Ingen seksjonsrutiner",
	render: () =>
		renderWithLoader(
			Seksjonsrutiner,
			{ ...mockSeksjonsrutinerData(), sectionRoutines: [] },
			"/seksjoner/pensjon-og-ufore/seksjonsrutiner",
		),
}
