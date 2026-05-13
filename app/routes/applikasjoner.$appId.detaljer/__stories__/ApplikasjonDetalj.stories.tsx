import type { Meta, StoryObj } from "@storybook/react"
import { mockAppDetaljerData, mockRpaUsers } from "@storybook-mocks/data"
import { renderWithLoader } from "@storybook-mocks/router"
import ApplikasjonDetalj from "../index"

const meta = {
	title: "Sider/Applikasjoner/Detaljer",
	component: ApplikasjonDetalj,
} satisfies Meta<typeof ApplikasjonDetalj>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	name: "Med rutiner og seksjonsrutiner (inkl. hendelsesbaserte)",
	render: () => renderWithLoader(ApplikasjonDetalj, mockAppDetaljerData(), "/applikasjoner/app-1/detaljer"),
}

export const ManglerOracleTilgang: Story = {
	name: "Mangler Oracle-tilgang (Entra ID-grupper)",
	render: () =>
		renderWithLoader(
			ApplikasjonDetalj,
			mockAppDetaljerData({
				oracleRoles: [],
				inaccessibleOracleGroups: [
					{ id: "group-1", name: "Oracle-Pensjon-Prod-Readers" },
					{ id: "group-2", name: "Oracle-Pensjon-Test-Readers" },
				],
			}),
			"/applikasjoner/app-1/detaljer",
		),
}

export const MedRpaBrukere: Story = {
	name: "Med RPA-brukere (Autentisering-fanen)",
	render: () =>
		renderWithLoader(
			ApplikasjonDetalj,
			mockAppDetaljerData({
				rpaUsers: mockRpaUsers(),
				authIntegrations: [
					{
						id: "auth-1",
						type: "entra_id",
						sidecarEnabled: true,
						allowAllUsers: false,
						groups: JSON.stringify(["entra-rpa-1"]),
						inboundRules: null,
						claimsExtra: null,
					},
				],
			}),
			"/applikasjoner/app-1/detaljer?fane=autentisering",
		),
}
