import type { Meta, StoryObj } from "@storybook/react"
import { renderWithLoader } from "@storybook-mocks/router"
import AdminOkonomisystemer from "../index"

const meta = {
	title: "Sider/Admin/Økonomisystemer",
	component: AdminOkonomisystemer,
} satisfies Meta<typeof AdminOkonomisystemer>
export default meta
type Story = StoryObj<typeof meta>

export const MedData: Story = {
	name: "Med klassifiserte applikasjoner",
	render: () =>
		renderWithLoader(AdminOkonomisystemer, {
			items: [
				{
					id: "ec-1",
					applicationId: "app-1",
					applicationName: "pensjon-vedtak",
					economySystemType: "hjelpesystem",
					justification: "Fatter vedtak som forplikter Nav økonomisk.",
					validUntil: "2027-03-01T00:00:00Z",
					isExpired: false,
				},
				{
					id: "ec-2",
					applicationId: "app-2",
					applicationName: "nav-regnskap",
					economySystemType: "regnskapssystem",
					justification: "Hovedbok og reskontro for Nav.",
					validUntil: "2027-01-15T00:00:00Z",
					isExpired: false,
				},
				{
					id: "ec-3",
					applicationId: "app-3",
					applicationName: "faktura-inn",
					economySystemType: "fakturabehandling",
					justification: "Mottar og behandler innkommende fakturaer.",
					validUntil: "2025-06-01T00:00:00Z",
					isExpired: true,
				},
				{
					id: "ec-4",
					applicationId: "app-4",
					applicationName: "nav-lonn",
					economySystemType: "lonnssystem",
					justification: "Beregner og utbetaler lønn.",
					validUntil: "2027-04-01T00:00:00Z",
					isExpired: false,
				},
			],
		}),
}

export const Tomt: Story = {
	name: "Ingen klassifiseringer",
	render: () => renderWithLoader(AdminOkonomisystemer, { items: [] }),
}

export const AlleUtlopt: Story = {
	name: "Alle klassifiseringer utløpt",
	render: () =>
		renderWithLoader(AdminOkonomisystemer, {
			items: [
				{
					id: "ec-1",
					applicationId: "app-1",
					applicationName: "pensjon-vedtak",
					economySystemType: "hjelpesystem",
					justification: "Fatter vedtak som forplikter Nav.",
					validUntil: "2025-02-01T00:00:00Z",
					isExpired: true,
				},
				{
					id: "ec-2",
					applicationId: "app-2",
					applicationName: "nav-regnskap",
					economySystemType: "regnskapssystem",
					justification: "Hovedbok for Nav.",
					validUntil: "2025-04-01T00:00:00Z",
					isExpired: true,
				},
			],
		}),
}
