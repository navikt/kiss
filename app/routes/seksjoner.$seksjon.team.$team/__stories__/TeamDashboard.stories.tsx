import type { Meta, StoryObj } from "@storybook/react"
import { mockTeamDetailData } from "@storybook-mocks/data"
import { renderWithLoader } from "@storybook-mocks/router"
import TeamDashboard from "../index"

const meta = {
	title: "Sider/Seksjoner/Team",
	component: TeamDashboard,
} satisfies Meta<typeof TeamDashboard>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	render: () =>
		renderWithLoader(TeamDashboard, mockTeamDetailData(), "/seksjoner/pensjon-og-ufore/team/starte-pensjon"),
}

export const RutineetterlevelseMiks: Story = {
	name: "Rutineetterlevelse – ulike tilstander",
	render: () =>
		renderWithLoader(
			TeamDashboard,
			{
				...mockTeamDetailData(),
				apps: [
					...mockTeamDetailData().apps,
					{
						appId: "app-4",
						appName: "pensjon-opptjening",
						implemented: 10,
						partial: 2,
						notImplemented: 0,
						notRelevant: 1,
						total: 13,
						source: "direct" as const,
						teamIds: ["t-01"],
						screeningProgress: { answered: 2, total: 6 },
						routineCompliance: {
							routinesGjennomfort: 0,
							routinesIkkeGjennomfort: 0,
							routinesMaaFolgesOpp: 0,
							routinesTotal: 0,
						},
						isEconomySystem: null,
						economySystemType: null,
					},
					{
						appId: "app-5",
						appName: "pensjon-vedtak",
						implemented: 8,
						partial: 3,
						notImplemented: 4,
						notRelevant: 0,
						total: 15,
						source: "nais-team" as const,
						teamIds: ["t-01"],
						screeningProgress: { answered: 6, total: 6 },
						routineCompliance: {
							routinesGjennomfort: 5,
							routinesIkkeGjennomfort: 0,
							routinesMaaFolgesOpp: 0,
							routinesTotal: 5,
						},
						isEconomySystem: true,
						economySystemType: "hjelpesystem",
					},
				],
			},
			"/seksjoner/pensjon-og-ufore/team/starte-pensjon",
		),
}

export const IngenApplikasjoner: Story = {
	name: "Ingen applikasjoner",
	render: () =>
		renderWithLoader(
			TeamDashboard,
			{
				...mockTeamDetailData(),
				apps: [],
				totalImplemented: 0,
				totalPartial: 0,
				totalMangler: 0,
				overallPercent: 0,
				totalRoutinesIkkeGjennomfort: 0,
			},
			"/seksjoner/pensjon-og-ufore/team/starte-pensjon",
		),
}

export const StorTeam: Story = {
	name: "Stort team (14 medlemmer)",
	render: () =>
		renderWithLoader(
			TeamDashboard,
			{
				...mockTeamDetailData(),
				teamUsers: [
					{ navIdent: "Z990003", name: "Glad Fjord", roles: ["tech_lead"] as const },
					{ navIdent: "Z990004", name: "Rask Elv", roles: ["product_owner"] as const },
					{ navIdent: "Z990005", name: "Stille Skog", roles: ["developer"] as const },
					{ navIdent: "Z990006", name: "Blå Himmel", roles: ["developer"] as const },
					{ navIdent: "Z990007", name: "Grønn Dal", roles: ["developer"] as const },
					{ navIdent: "Z990008", name: "Høy Fjell", roles: ["developer"] as const },
					{ navIdent: "Z990009", name: "Dyp Sjø", roles: ["developer"] as const },
					{ navIdent: "Z990010", name: "Mild Vind", roles: ["developer"] as const },
					{ navIdent: "Z990011", name: "Sterk Stein", roles: ["developer"] as const },
					{ navIdent: "Z990012", name: "Lys Morgen", roles: ["developer"] as const },
					{ navIdent: "Z990013", name: "Rolig Bekk", roles: ["developer"] as const },
					{ navIdent: "Z990014", name: "Frisk Luft", roles: ["developer"] as const },
					{ navIdent: "Z990015", name: "Tung Sky", roles: ["developer"] as const },
					{ navIdent: "Z990016", name: "Klar Natt", roles: ["developer"] as const },
				],
			},
			"/seksjoner/pensjon-og-ufore/team/starte-pensjon",
		),
}

export const MedIkkeGjennomforteRutiner: Story = {
	name: "Med ikke-gjennomførte rutiner (card synlig)",
	render: () =>
		renderWithLoader(
			TeamDashboard,
			{
				...mockTeamDetailData(),
				totalRoutinesIkkeGjennomfort: 12,
			},
			"/seksjoner/pensjon-og-ufore/team/starte-pensjon",
		),
}

export const IngenIkkeGjennomforteRutiner: Story = {
	name: "Ingen ikke-gjennomførte rutiner (card skjult)",
	render: () =>
		renderWithLoader(
			TeamDashboard,
			{
				...mockTeamDetailData(),
				totalRoutinesIkkeGjennomfort: 0,
			},
			"/seksjoner/pensjon-og-ufore/team/starte-pensjon",
		),
}
