import type { Meta, StoryObj } from "@storybook/react"
import { mockAppDetaljerData } from "@storybook-mocks/data"
import { renderWithLoader } from "@storybook-mocks/router"
import ApplikasjonDetalj from "../index"

const meta: Meta = {
	title: "Sider/Applikasjoner/Detaljer",
	component: ApplikasjonDetalj,
}
export default meta
type Story = StoryObj

export const Default: Story = {
	render: () => renderWithLoader(ApplikasjonDetalj, mockAppDetaljerData(), "/applikasjoner/app-1/detaljer"),
}
