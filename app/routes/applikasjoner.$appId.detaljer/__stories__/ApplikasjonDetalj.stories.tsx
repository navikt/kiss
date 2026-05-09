import type { Meta, StoryObj } from "@storybook/react"
import { mockAppDetaljerData } from "@storybook-mocks/data"
import { renderWithLoader } from "@storybook-mocks/router"
import ApplikasjonDetalj from "../index"

const meta = {
	title: "Sider/Applikasjoner/Detaljer",
	component: ApplikasjonDetalj,
} satisfies Meta<typeof ApplikasjonDetalj>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	name: "Med rutiner og seksjonsrutiner",
	render: () => renderWithLoader(ApplikasjonDetalj, mockAppDetaljerData(), "/applikasjoner/app-1/detaljer"),
}
