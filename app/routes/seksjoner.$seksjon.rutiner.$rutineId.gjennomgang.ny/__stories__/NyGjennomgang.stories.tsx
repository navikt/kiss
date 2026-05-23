import type { Meta, StoryObj } from "@storybook/react"
import { mockNyGjennomgangData } from "@storybook-mocks/data"
import { renderWithLoader, renderWithLoaderAndAction } from "@storybook-mocks/router"
import { data } from "react-router"
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

export const KonfliktApplikasjon: Story = {
	name: "Konflikt – applikasjonsrutine (aktiv gjennomgang finnes)",
	render: () =>
		renderWithLoaderAndAction(
			NyGjennomgang,
			mockNyGjennomgangData(),
			() =>
				data(
					{
						conflictError:
							"Det finnes allerede en aktiv gjennomgang for aktivitetstypen «Entra ID-gruppevedlikehold» på denne applikasjonen. Fullfør eller forkast den eksisterende gjennomgangen før du oppretter en ny.",
					},
					{ status: 409 },
				),
			"/seksjoner/pensjon-og-ufore/rutiner/routine-1/gjennomgang/ny",
		),
}

export const KonfliktSeksjonsrutine: Story = {
	name: "Konflikt – seksjonsrutine (aktiv gjennomgang finnes)",
	render: () =>
		renderWithLoaderAndAction(
			NyGjennomgang,
			mockNyGjennomgangData({ isSectionRoutine: true }),
			() =>
				data(
					{
						conflictError:
							"Det finnes allerede en aktiv gjennomgang for aktivitetstypen «RPA-brukervedlikehold» på denne applikasjonen. Fullfør eller forkast den eksisterende gjennomgangen før du oppretter en ny.",
					},
					{ status: 409 },
				),
			"/seksjoner/pensjon-og-ufore/rutiner/routine-2/gjennomgang/ny",
		),
}
