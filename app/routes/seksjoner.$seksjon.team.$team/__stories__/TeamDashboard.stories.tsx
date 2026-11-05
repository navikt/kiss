import type { Meta, StoryObj } from "@storybook/react"
import { mockTeamDetailData } from "@storybook-mocks/data"
import { renderWithLoader } from "@storybook-mocks/router"
import { expect, screen, userEvent, within } from "storybook/test"
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
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)

		await expect(
			canvas.getByText("Tallene gjelder teamets aktive applikasjoner. Arkiverte applikasjoner telles separat."),
		).toBeVisible()
		await userEvent.click(canvas.getByRole("button", { name: "Om kontrolloppfyllelse" }))
		await expect(screen.getByText(/Delvis implementert gir halv uttelling/)).toBeVisible()
		await userEvent.keyboard("{Escape}")

		const help = canvas.getByRole("button", { name: "Om kontrollpunkter uten vurdering" })
		await expect(help.closest("a")).toBeNull()
		await userEvent.click(help)
		await expect(screen.getByText(/Ikke implementert er en vurdert status/)).toBeVisible()
		await userEvent.keyboard("{Escape}")
		await expect(canvas.getByRole("link", { name: /Kontrollpunkter uten vurdering/ })).toHaveAttribute(
			"href",
			"/seksjoner/pensjon-og-ufore/team/starte-pensjon/mangler",
		)

		await expect(canvas.getByRole("columnheader", { name: /Rutiner gjennomført \(%\)/ })).toBeVisible()
		const tableHelp = canvas.getByRole("button", { name: "Slik leser du tabellen" })
		await expect(tableHelp).toHaveAttribute("aria-expanded", "false")
		await userEvent.click(tableHelp)
		await expect(
			canvas.getByText(/Gjennomganger med åpne oppfølgingspunkter teller også som gjennomført/),
		).toBeVisible()
		await expect(canvas.getByText(/Dette er ikke det samme som kontrolloppfyllelse/)).toBeVisible()
		await userEvent.click(tableHelp)
		await expect(tableHelp).toHaveAttribute("aria-expanded", "false")
	},
}

export const DeploymentForklaringer: Story = {
	render: Default.render,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await userEvent.click(canvas.getByRole("button", { name: "Om 4-øyne-dekning" }))
		await expect(screen.getByText(/godkjent etter 4-øyne-prinsippet/)).toBeVisible()
		await userEvent.keyboard("{Escape}")
		await userEvent.click(canvas.getByRole("button", { name: "Om endringsopphav" }))
		await expect(screen.getByText(/koblet til et dokumentert endringsopphav/)).toBeVisible()
	},
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
