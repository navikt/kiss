import type { Meta, StoryObj } from "@storybook/react"
import { mockTeamRutinerData, mockTeamRutinerEmptyData } from "@storybook-mocks/data"
import { renderWithLoader } from "@storybook-mocks/router"
import TeamUgjennomforteRutiner from "../index"

const meta = {
	title: "Sider/Seksjoner/Team/Ikke-gjennomførte rutiner",
	component: TeamUgjennomforteRutiner,
} satisfies Meta<typeof TeamUgjennomforteRutiner>
export default meta
type Story = StoryObj<typeof meta>

export const MedData: Story = {
	name: "Med ikke-gjennomførte rutiner",
	render: () =>
		renderWithLoader(
			TeamUgjennomforteRutiner,
			mockTeamRutinerData(),
			"/seksjoner/pensjon-og-ufore/team/starte-pensjon/rutiner",
		),
}

export const TomListe: Story = {
	name: "Ingen ikke-gjennomførte rutiner",
	render: () =>
		renderWithLoader(
			TeamUgjennomforteRutiner,
			mockTeamRutinerEmptyData(),
			"/seksjoner/pensjon-og-ufore/team/starte-pensjon/rutiner",
		),
}
