import type { Meta, StoryObj } from "@storybook/react"
import { renderWithLoader } from "@storybook-mocks/router"
import SeksjonOkonomisystemer from "../index"

const meta = {
	title: "Sider/Seksjoner/Økonomisystemer",
	component: SeksjonOkonomisystemer,
} satisfies Meta<typeof SeksjonOkonomisystemer>
export default meta
type Story = StoryObj<typeof meta>

export const MedData: Story = {
	name: "Med klassifiserte applikasjoner",
	render: () =>
		renderWithLoader(SeksjonOkonomisystemer, {
			seksjon: "pensjon-og-ufore",
			seksjonName: "Pensjon og uføre",
			items: [
				{
					appId: "app-1",
					appName: "pensjon-vedtak",
					team: "team-pensjon",
					economySystemType: "hjelpesystem",
					justification:
						"Fatter vedtak som forplikter Nav økonomisk og produserer grunnlag for bokførte transaksjoner.",
					validUntil: "2027-03-01T00:00:00Z",
					isExpired: false,
				},
				{
					appId: "app-2",
					appName: "pensjon-utbetaling",
					team: "team-pensjon",
					economySystemType: "regnskapssystem",
					justification: "Håndterer hovedbok og reskontro for pensjonsutbetalinger.",
					validUntil: "2027-01-15T00:00:00Z",
					isExpired: false,
				},
				{
					appId: "app-3",
					appName: "ufore-faktura",
					team: "team-ufore",
					economySystemType: "fakturabehandling",
					justification: "Mottar og behandler innkommende fakturaer for uføreytelser.",
					validUntil: "2025-06-01T00:00:00Z",
					isExpired: true,
				},
			],
		}),
}

export const Tomt: Story = {
	name: "Ingen økonomisystemer",
	render: () =>
		renderWithLoader(SeksjonOkonomisystemer, {
			seksjon: "pensjon-og-ufore",
			seksjonName: "Pensjon og uføre",
			items: [],
		}),
}

export const AlleUtlopt: Story = {
	name: "Alle utløpt",
	render: () =>
		renderWithLoader(SeksjonOkonomisystemer, {
			seksjon: "pensjon-og-ufore",
			seksjonName: "Pensjon og uføre",
			items: [
				{
					appId: "app-1",
					appName: "pensjon-vedtak",
					team: "team-pensjon",
					economySystemType: "hjelpesystem",
					justification: "Fatter vedtak som forplikter Nav.",
					validUntil: "2025-02-01T00:00:00Z",
					isExpired: true,
				},
				{
					appId: "app-2",
					appName: "pensjon-utbetaling",
					team: "team-pensjon",
					economySystemType: "lonnssystem",
					justification: "Beregner og utbetaler pensjon.",
					validUntil: "2025-04-01T00:00:00Z",
					isExpired: true,
				},
			],
		}),
}
