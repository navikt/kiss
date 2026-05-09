import type { Meta, StoryObj } from "@storybook/react"
import { mockRutinerListData } from "@storybook-mocks/data"
import { renderWithLoader } from "@storybook-mocks/router"
import SeksjonRutinerIndex from "../index"

const meta = {
	title: "Sider/Seksjoner/Rutiner",
	component: SeksjonRutinerIndex,
} satisfies Meta<typeof SeksjonRutinerIndex>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	name: "Med rutiner (inkl. seksjonsrutiner)",
	render: () => renderWithLoader(SeksjonRutinerIndex, mockRutinerListData(), "/seksjoner/pensjon-og-ufore/rutiner"),
}

export const IngenRutiner: Story = {
	name: "Ingen rutiner",
	render: () =>
		renderWithLoader(
			SeksjonRutinerIndex,
			{ ...mockRutinerListData(), routines: [] },
			"/seksjoner/pensjon-og-ufore/rutiner",
		),
}
