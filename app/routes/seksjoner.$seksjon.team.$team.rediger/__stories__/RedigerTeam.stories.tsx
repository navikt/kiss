import type { Meta, StoryObj } from "@storybook/react"
import { mockTeamEditData } from "@storybook-mocks/data"
import { renderWithLoader } from "@storybook-mocks/router"
import RedigerTeam from "../index"

const meta = {
	title: "Sider/Seksjoner/Team/Rediger",
	component: RedigerTeam,
} satisfies Meta<typeof RedigerTeam>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	render: () =>
		renderWithLoader(RedigerTeam, mockTeamEditData(), "/seksjoner/pensjon-og-ufore/team/starte-pensjon/rediger"),
}

export const UtenNaisTeam: Story = {
	name: "Uten koblede Nais-team",
	render: () =>
		renderWithLoader(
			RedigerTeam,
			{
				...mockTeamEditData(),
				linkedNaisTeams: [],
				availableNaisTeams: [{ slug: "pensjonsdeployer" }, { slug: "pensjonsamhandling" }],
				apps: mockTeamEditData().apps.filter((a) => a.source === "direct"),
			},
			"/seksjoner/pensjon-og-ufore/team/starte-pensjon/rediger",
		),
}

export const MedMangeApps: Story = {
	name: "Med mange tilgjengelige apper",
	render: () =>
		renderWithLoader(
			RedigerTeam,
			{
				...mockTeamEditData(),
				availableApps: Array.from({ length: 20 }, (_, i) => ({
					id: `app-avail-${i}`,
					name: `pensjon-app-${i + 1}`,
				})),
			},
			"/seksjoner/pensjon-og-ufore/team/starte-pensjon/rediger",
		),
}

export const Arkivert: Story = {
	name: "Arkivert team",
	render: () =>
		renderWithLoader(
			RedigerTeam,
			{
				...mockTeamEditData(),
				teamArchivedAt: "2025-06-01T12:00:00Z",
			},
			"/seksjoner/pensjon-og-ufore/team/starte-pensjon/rediger",
		),
}

export const UtenApps: Story = {
	name: "Uten applikasjoner",
	render: () =>
		renderWithLoader(
			RedigerTeam,
			{
				...mockTeamEditData(),
				apps: [],
				availableApps: [],
				linkedNaisTeams: [],
				availableNaisTeams: [],
			},
			"/seksjoner/pensjon-og-ufore/team/starte-pensjon/rediger",
		),
}
