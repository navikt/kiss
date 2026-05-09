import type { Meta, StoryObj } from "@storybook/react"
import { mockNyRutineData } from "@storybook-mocks/data"
import { renderWithLoader } from "@storybook-mocks/router"
import NyRutine from "../index"

const meta = {
	title: "Sider/Seksjoner/Rutiner/Ny",
	component: NyRutine,
} satisfies Meta<typeof NyRutine>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	render: () => renderWithLoader(NyRutine, mockNyRutineData(), "/seksjoner/pensjon-og-ufore/rutiner/ny"),
}
