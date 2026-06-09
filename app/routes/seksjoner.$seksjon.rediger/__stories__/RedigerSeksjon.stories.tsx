import type { Meta, StoryObj } from "@storybook/react"
import { renderWithLoader } from "@storybook-mocks/router"
import RedigerSeksjon from "../index"

const meta = {
	title: "Sider/Seksjoner/Rediger seksjon",
	component: RedigerSeksjon,
} satisfies Meta<typeof RedigerSeksjon>
export default meta
type Story = StoryObj<typeof meta>

const baseLoaderData = {
	section: {
		id: "s-01",
		name: "Seksjon for arbeidsytelser (SAY)",
		slug: "seksjon-for-arbeidsytelser-say",
		description: "Seksjonen som forvalter arbeidsytelser i NAV.",
	},
	teams: [
		{
			id: "t-01",
			name: "Glad Fjord",
			slug: "glad-fjord",
			description: "Ansvarlig for dagpenger",
			linkedNaisTeams: ["dagpenger", "dp-iverksett"],
			archivedAt: null,
		},
		{
			id: "t-02",
			name: "Rask Elv",
			slug: "rask-elv",
			description: "Ansvarlig for sykepenger",
			linkedNaisTeams: [],
			archivedAt: null,
		},
		{
			id: "t-03",
			name: "Stille Skog",
			slug: "stille-skog",
			description: null,
			linkedNaisTeams: ["stille-skog"],
			archivedAt: "2024-01-15T12:00:00.000Z",
		},
	],
	linkedNaisTeams: [
		{ slug: "dagpenger", displayName: "Dagpenger", devTeamId: "t-01" },
		{ slug: "dp-iverksett", displayName: "DP Iverksett", devTeamId: "t-01" },
		{ slug: "stille-skog", displayName: "Stille Skog", devTeamId: "t-03" },
	],
	unlinkedNaisTeams: [
		{ slug: "pensjon-team", displayName: "Pensjon Team" },
		{ slug: "uforetrygd", displayName: "Uføretrygd" },
	],
	sectionApps: [] as never[],
	ignoredApps: [] as never[],
	persistenceMap: {} as Record<string, never>,
	sectionEnvironments: [
		{ cluster: "dev-gcp", included: true },
		{ cluster: "prod-gcp", included: true },
		{ cluster: "dev-fss", included: false },
		{ cluster: "prod-fss", included: false },
	],
	seksjon: "seksjon-for-arbeidsytelser-say",
}

function mockLoaderData(overrides?: Partial<typeof baseLoaderData>) {
	return { ...baseLoaderData, ...overrides }
}

export const TeamFane: Story = {
	name: "Fane: Utviklingsteam",
	render: () =>
		renderWithLoader(RedigerSeksjon, mockLoaderData(), "/seksjoner/seksjon-for-arbeidsytelser-say/rediger?fane=team"),
}

export const TeamFaneIngenTeam: Story = {
	name: "Fane: Utviklingsteam – ingen team",
	render: () =>
		renderWithLoader(
			RedigerSeksjon,
			mockLoaderData({ teams: [] }),
			"/seksjoner/seksjon-for-arbeidsytelser-say/rediger?fane=team",
		),
}

export const SeksjonFane: Story = {
	name: "Fane: Seksjon",
	render: () =>
		renderWithLoader(
			RedigerSeksjon,
			mockLoaderData(),
			"/seksjoner/seksjon-for-arbeidsytelser-say/rediger?fane=seksjon",
		),
}

export const NaisFane: Story = {
	name: "Fane: Nais-team",
	render: () =>
		renderWithLoader(RedigerSeksjon, mockLoaderData(), "/seksjoner/seksjon-for-arbeidsytelser-say/rediger?fane=nais"),
}
