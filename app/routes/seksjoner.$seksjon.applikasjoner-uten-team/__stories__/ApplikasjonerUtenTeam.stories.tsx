import type { Meta, StoryObj } from "@storybook/react"
import { renderWithLoader } from "@storybook-mocks/router"
import ApplikasjonerUtenTeam from "../index"

const mockData = {
	sectionName: "Pensjon og uføre",
	unassignedApps: [
		{ appId: "app-1", appName: "pensjon-saksbehandling", naisTeamSlug: "pensjon", environments: ["dev", "prod"] },
		{ appId: "app-2", appName: "pensjon-vedtak", naisTeamSlug: "pensjon", environments: ["dev"] },
		{ appId: "app-3", appName: "ufore-beregning", naisTeamSlug: "ufore", environments: ["dev", "prod"] },
	],
	teams: [
		{ id: "team-1", name: "Starte pensjon" },
		{ id: "team-2", name: "Beregning" },
	],
	canManageAny: true,
}

const meta = {
	title: "Sider/Seksjoner/Applikasjoner uten team",
	component: ApplikasjonerUtenTeam,
} satisfies Meta<typeof ApplikasjonerUtenTeam>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	render: () =>
		renderWithLoader(ApplikasjonerUtenTeam, mockData, "/seksjoner/pensjon-og-ufore/applikasjoner-uten-team"),
}

export const IngenUfordelte: Story = {
	name: "Alle applikasjoner tilknyttet",
	render: () =>
		renderWithLoader(
			ApplikasjonerUtenTeam,
			{ ...mockData, unassignedApps: [] },
			"/seksjoner/pensjon-og-ufore/applikasjoner-uten-team",
		),
}

export const KunLesetilgang: Story = {
	name: "Kun lesetilgang (ingen team å administrere)",
	render: () =>
		renderWithLoader(
			ApplikasjonerUtenTeam,
			{ ...mockData, canManageAny: false, teams: [] },
			"/seksjoner/pensjon-og-ufore/applikasjoner-uten-team",
		),
}
