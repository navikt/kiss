import type { Meta, StoryObj } from "@storybook/react"
import { mockSeksjonerData } from "@storybook-mocks/data"
import { renderWithLoader } from "@storybook-mocks/router"
import Seksjoner from "../index"

const meta: Meta = {
	title: "Sider/Seksjoner",
	component: Seksjoner,
}
export default meta
type Story = StoryObj

export const Default: Story = {
	render: () => renderWithLoader(Seksjoner, mockSeksjonerData()),
}

export const IngenSeksjoner: Story = {
	name: "Ingen seksjoner",
	render: () => renderWithLoader(Seksjoner, { sections: [] }),
}
