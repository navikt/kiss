import type { Meta, StoryObj } from "@storybook/react"
import { mockRutineDetaljData } from "@storybook-mocks/data"
import { renderWithLoader } from "@storybook-mocks/router"
import RutineDetaljer from "../index"

const meta = {
	title: "Sider/Seksjoner/Rutiner/Detalj",
	component: RutineDetaljer,
} satisfies Meta<typeof RutineDetaljer>
export default meta
type Story = StoryObj<typeof meta>

export const VanligRutine: Story = {
	name: "Vanlig rutine",
	render: () =>
		renderWithLoader(RutineDetaljer, mockRutineDetaljData(), "/seksjoner/pensjon-og-ufore/rutiner/routine-1"),
}

export const Seksjonsrutine: Story = {
	name: "Seksjonsrutine",
	render: () =>
		renderWithLoader(
			RutineDetaljer,
			mockRutineDetaljData({ isSectionRoutine: true }),
			"/seksjoner/pensjon-og-ufore/rutiner/routine-2",
		),
}

export const HendelsesbasertRutine: Story = {
	name: "Hendelsesbasert rutine (uten frist)",
	render: () =>
		renderWithLoader(
			RutineDetaljer,
			mockRutineDetaljData({ eventOnly: true }),
			"/seksjoner/pensjon-og-ufore/rutiner/routine-3",
		),
}

export const KombinertFrekvens: Story = {
	name: "Kombinert frekvens (periodisk + hendelsesbasert)",
	render: () =>
		renderWithLoader(
			RutineDetaljer,
			mockRutineDetaljData({ dualFrequency: true }),
			"/seksjoner/pensjon-og-ufore/rutiner/routine-4",
		),
}

export const MedOppfølgingspunkter: Story = {
	name: "Med oppfølgingspunkter (Må følges opp)",
	render: () =>
		renderWithLoader(
			RutineDetaljer,
			mockRutineDetaljData({ withFollowUp: true }),
			"/seksjoner/pensjon-og-ufore/rutiner/routine-1",
		),
}

export const ErstattetRutine: Story = {
	name: "Erstattet rutine (med etterfølger-banner)",
	render: () =>
		renderWithLoader(
			RutineDetaljer,
			mockRutineDetaljData({ replaced: true }),
			"/seksjoner/pensjon-og-ufore/rutiner/routine-old",
		),
}

export const NyRutineMedOpphav: Story = {
	name: "Ny rutine med opphav (erstatter en annen)",
	render: () =>
		renderWithLoader(
			RutineDetaljer,
			mockRutineDetaljData({ isReplacement: true }),
			"/seksjoner/pensjon-og-ufore/rutiner/routine-new",
		),
}
