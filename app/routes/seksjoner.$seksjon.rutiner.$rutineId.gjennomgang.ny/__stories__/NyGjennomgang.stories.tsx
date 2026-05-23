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

// Konflikten oppdages i loader (preselektert app via ?appId= i URL, eller seksjonsrutine).
// Vises umiddelbart når siden lastes – bruker trenger ikke sende inn skjema.

export const KonfliktApplikasjon: Story = {
	name: "Konflikt – applikasjonsrutine (oppdaget i loader)",
	render: () =>
		renderWithLoader(
			NyGjennomgang,
			mockNyGjennomgangData({
				loaderConflictError:
					"Det finnes allerede en aktiv gjennomgang for aktivitetstypen «Entra ID-gruppevedlikehold» på denne applikasjonen. Fullfør eller forkast den eksisterende gjennomgangen før du oppretter en ny.",
			}),
			"/seksjoner/pensjon-og-ufore/rutiner/routine-1/gjennomgang/ny?appId=app-1",
		),
}

export const KonfliktSeksjonsrutine: Story = {
	name: "Konflikt – seksjonsrutine (oppdaget i loader)",
	render: () =>
		renderWithLoader(
			NyGjennomgang,
			mockNyGjennomgangData({
				isSectionRoutine: true,
				loaderConflictError:
					"Det finnes allerede en aktiv gjennomgang for aktivitetstypen «RPA-brukervedlikehold» for denne seksjonen. Fullfør eller forkast den eksisterende gjennomgangen før du oppretter en ny.",
			}),
			"/seksjoner/pensjon-og-ufore/rutiner/routine-2/gjennomgang/ny",
		),
}

// Konflikten oppdages i action – skjer når app velges i skjema-select og skjema sendes inn.

export const KonfliktViaSkjema: Story = {
	name: "Konflikt – via skjema-submit (app valgt i dropdown)",
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
