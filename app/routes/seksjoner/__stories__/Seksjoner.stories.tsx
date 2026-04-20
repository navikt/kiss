import type { Meta, StoryObj } from "@storybook/react"
import { mockSeksjonerData } from "@storybook-mocks/data"
import { renderWithLoader } from "@storybook-mocks/router"
import Seksjoner from "../index"

const meta = {
	title: "Sider/Seksjoner",
	component: Seksjoner,
} satisfies Meta<typeof Seksjoner>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	render: () => renderWithLoader(Seksjoner, mockSeksjonerData()),
}

export const IngenSeksjoner: Story = {
	name: "Ingen seksjoner",
	render: () => renderWithLoader(Seksjoner, { sections: [] }),
}
