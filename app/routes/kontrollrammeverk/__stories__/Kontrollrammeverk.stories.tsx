import type { Meta, StoryObj } from "@storybook/react"
import { mockKontrollrammeverkData } from "@storybook-mocks/data"
import { renderWithLoader } from "@storybook-mocks/router"
import Kontrollrammeverk from "../index"

const meta: Meta = {
	title: "Sider/Kontrollrammeverk",
	component: Kontrollrammeverk,
}
export default meta
type Story = StoryObj

export const Default: Story = {
	render: () => renderWithLoader(Kontrollrammeverk, mockKontrollrammeverkData()),
}

export const IngenKontroller: Story = {
	name: "Ingen kontroller",
	render: () =>
		renderWithLoader(Kontrollrammeverk, {
			...mockKontrollrammeverkData(),
			controls: [],
			risks: [],
			totalControls: 0,
		}),
}
