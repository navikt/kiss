import type { Meta, StoryObj } from "@storybook/react"
import { mockSeksjonDetailData } from "@storybook-mocks/data"
import { renderWithLoader } from "@storybook-mocks/router"
import SeksjonDashboard from "../index"

const meta = {
	title: "Sider/Seksjoner/Seksjon",
	component: SeksjonDashboard,
} satisfies Meta<typeof SeksjonDashboard>
export default meta
type Story = StoryObj<typeof meta>

const zeroEconomyStats = { implemented: 0, partial: 0, notImplemented: 0, notRelevant: 0, total: 0, apps: 0 }

const emptyUnassigned = {
	apps: 0,
	implemented: 0,
	partial: 0,
	notImplemented: 0,
	notRelevant: 0,
	total: 0,
	economyOnly: zeroEconomyStats,
}

export const Default: Story = {
	render: () => renderWithLoader(SeksjonDashboard, mockSeksjonDetailData(), "/seksjoner/pensjon-og-ufore"),
}

export const IngenOkonomisystemer: Story = {
	name: "Ingen økonomisystemer",
	render: () => {
		const base = mockSeksjonDetailData()
		return renderWithLoader(
			SeksjonDashboard,
			{
				...base,
				economySystemCount: 0,
				economySystemExpiredCount: 0,
				// Ingen apper er klassifisert som økonomisystem i dette scenarioet, så «Vis kun
				// økonomisystemer»-toggelen skal ikke vise noen data for team/uten-team heller.
				teams: base.teams.map((team) => ({ ...team, economyOnly: zeroEconomyStats })),
				unassigned: { ...base.unassigned, economyOnly: zeroEconomyStats },
			},
			"/seksjoner/pensjon-og-ufore",
		)
	},
}

export const MedUtlopteOkonomisystemer: Story = {
	name: "Med utløpte økonomisystemer",
	render: () => {
		const base = mockSeksjonDetailData()
		return renderWithLoader(
			SeksjonDashboard,
			{
				...base,
				economySystemCount: 5,
				economySystemExpiredCount: 3,
				// base.teams sin economyOnly summerer allerede til 5 apper (2+1+2), så bare
				// nullstill "uten team" for å holde totalen konsistent med economySystemCount.
				unassigned: { ...base.unassigned, economyOnly: zeroEconomyStats },
			},
			"/seksjoner/pensjon-og-ufore",
		)
	},
}

export const IkkeAdmin: Story = {
	name: "Ikke admin",
	render: () =>
		renderWithLoader(SeksjonDashboard, { ...mockSeksjonDetailData(), canAdmin: false }, "/seksjoner/pensjon-og-ufore"),
}

export const IngenTeam: Story = {
	name: "Ingen team",
	render: () =>
		renderWithLoader(
			SeksjonDashboard,
			{
				...mockSeksjonDetailData(),
				teams: [],
				unassigned: emptyUnassigned,
				totalApps: 0,
				totalImplemented: 0,
				totalPartial: 0,
				totalMangler: 0,
				overallPercent: 0,
				economySystemCount: 0,
				economySystemExpiredCount: 0,
				screenedCount: 0,
				routinesGjennomfort: 0,
				routinesIkkeGjennomfort: 0,
				needsFollowUpApps: 0,
			},
			"/seksjoner/pensjon-og-ufore",
		),
}

export const IkkeKonfigurert: Story = {
	name: "Ikke konfigurert (veiledning)",
	render: () =>
		renderWithLoader(
			SeksjonDashboard,
			{
				...mockSeksjonDetailData(),
				hasUtviklerteam: false,
				hasNaisTeam: false,
				hasNaisMiljo: false,
				teams: [],
				unassigned: emptyUnassigned,
				totalApps: 0,
				totalImplemented: 0,
				totalPartial: 0,
				totalMangler: 0,
				overallPercent: 0,
				economySystemCount: 0,
				economySystemExpiredCount: 0,
				screenedCount: 0,
				routinesGjennomfort: 0,
				routinesIkkeGjennomfort: 0,
				sectionRoutinesIkkeGjennomfort: 0,
				needsFollowUpApps: 0,
			},
			"/seksjoner/pensjon-og-ufore",
		),
}

export const IkkeKonfigurertIkkeAdmin: Story = {
	name: "Ikke konfigurert (ikke admin)",
	render: () =>
		renderWithLoader(
			SeksjonDashboard,
			{
				...mockSeksjonDetailData(),
				canAdmin: false,
				hasUtviklerteam: false,
				hasNaisTeam: false,
				hasNaisMiljo: false,
				teams: [],
				unassigned: emptyUnassigned,
				totalApps: 0,
				totalImplemented: 0,
				totalPartial: 0,
				totalMangler: 0,
				overallPercent: 0,
				economySystemCount: 0,
				economySystemExpiredCount: 0,
				screenedCount: 0,
				routinesGjennomfort: 0,
				routinesIkkeGjennomfort: 0,
				sectionRoutinesIkkeGjennomfort: 0,
				needsFollowUpApps: 0,
			},
			"/seksjoner/pensjon-og-ufore",
		),
}

export const DelvisKonfigurert: Story = {
	name: "Delvis konfigurert (mangler miljø)",
	render: () =>
		renderWithLoader(
			SeksjonDashboard,
			{ ...mockSeksjonDetailData(), hasNaisMiljo: false },
			"/seksjoner/pensjon-og-ufore",
		),
}
