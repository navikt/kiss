import type { Meta, StoryObj } from "@storybook/react"
import { mockTeamRutinerData, mockTeamRutinerEmptyData } from "@storybook-mocks/data"
import { renderWithLoader } from "@storybook-mocks/router"
import { expect, userEvent, within } from "storybook/test"
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
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)

		await expect(canvas.getByText("Kvartalvis tilgangskontroll Oracle")).toBeInTheDocument()
		await expect(canvas.getByText("Halvårlig penetrasjonstest")).toBeInTheDocument()
		await expect(canvas.getByText("Årlig sårbarhetsskanning")).toBeInTheDocument()

		await userEvent.click(canvas.getByRole("checkbox", { name: "Kun økonomiapplikasjoner" }))
		await expect(canvas.getByText("Kvartalvis tilgangskontroll Oracle")).toBeInTheDocument()
		await expect(canvas.getByText("Tilgangskontroll Entra ID-grupper")).toBeInTheDocument()
		await expect(canvas.queryByText("Halvårlig penetrasjonstest")).not.toBeInTheDocument()
		await expect(canvas.queryByText("Årlig sårbarhetsskanning")).not.toBeInTheDocument()

		const [appActionFilterSelect] = canvas.getAllByRole("combobox", { name: "Handlinger" })
		await userEvent.selectOptions(appActionFilterSelect, "fortsett")
		await expect(canvas.queryByText("Kvartalvis tilgangskontroll Oracle")).not.toBeInTheDocument()
		await expect(canvas.getByText("Tilgangskontroll Entra ID-grupper")).toBeInTheDocument()
	},
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
