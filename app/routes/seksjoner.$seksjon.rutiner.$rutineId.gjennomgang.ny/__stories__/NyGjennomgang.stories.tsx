import type { Meta, StoryObj } from "@storybook/react"
import { mockNyGjennomgangData } from "@storybook-mocks/data"
import { renderWithLoader } from "@storybook-mocks/router"
import NyGjennomgang from "../index"

const meta = {
	title: "Sider/Seksjoner/Rutiner/Ny gjennomgang",
	component: NyGjennomgang,
} satisfies Meta<typeof NyGjennomgang>
export default meta
type Story = StoryObj<typeof meta>

export const VanligRutine: Story = {
	name: "Vanlig rutine (med app-valg)",
	render: () =>
		renderWithLoader(
			NyGjennomgang,
			mockNyGjennomgangData(),
			"/seksjoner/pensjon-og-ufore/rutiner/routine-1/gjennomgang/ny",
		),
}

export const Seksjonsrutine: Story = {
	name: "Seksjonsrutine (uten app-valg)",
	render: () =>
		renderWithLoader(
			NyGjennomgang,
			mockNyGjennomgangData({ isSectionRoutine: true }),
			"/seksjoner/pensjon-og-ufore/rutiner/routine-2/gjennomgang/ny",
		),
}
