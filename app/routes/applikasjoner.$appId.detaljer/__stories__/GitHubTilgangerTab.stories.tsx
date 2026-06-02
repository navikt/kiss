import type { Meta, StoryObj } from "@storybook/react"
import { GitHubTilgangerTab } from "../tabs/GitHubTilgangerTab"

const meta: Meta<typeof GitHubTilgangerTab> = {
	title: "Applikasjon/GitHub-tilganger",
	component: GitHubTilgangerTab,
	parameters: { layout: "padded" },
}

export default meta
type Story = StoryObj<typeof GitHubTilgangerTab>

const teams = [
	{
		id: "team-1",
		teamSlug: "pensjon-saksbehandling",
		teamName: "pensjon-saksbehandling",
		permission: "push",
		syncedAt: "2026-06-01T10:00:00Z",
		members: [
			{ username: "glad-fjord", role: "member" },
			{ username: "rask-elv", role: "member" },
			{ username: "stille-skog", role: "maintainer" },
		],
	},
	{
		id: "team-2",
		teamSlug: "pensjon-q0",
		teamName: "pensjon-q0",
		permission: "pull",
		syncedAt: "2026-06-01T10:00:00Z",
		members: [
			{ username: "glad-fjord", role: "member" },
			{ username: "rask-elv", role: "member" },
		],
	},
	{
		id: "team-3",
		teamSlug: "pensjon-q1",
		teamName: "pensjon-q1",
		permission: "pull",
		syncedAt: "2026-06-01T10:00:00Z",
		members: [
			{ username: "glad-fjord", role: "member" },
			{ username: "rask-elv", role: "member" },
			{ username: "stille-skog", role: "member" },
		],
	},
	{
		id: "team-4",
		teamSlug: "pensjon-q2",
		teamName: "pensjon-q2",
		permission: "pull",
		syncedAt: "2026-06-01T10:00:00Z",
		members: [
			{ username: "glad-fjord", role: "member" },
			{ username: "rask-elv", role: "member" },
			{ username: "stille-skog", role: "member" },
		],
	},
	{
		id: "team-5",
		teamSlug: "pensjon-q5",
		teamName: "pensjon-q5",
		permission: "pull",
		syncedAt: "2026-06-01T10:00:00Z",
		members: [{ username: "glad-fjord", role: "member" }],
	},
	{
		id: "team-6",
		teamSlug: "teampensjon",
		teamName: "teampensjon",
		permission: "maintain",
		syncedAt: "2026-06-01T10:00:00Z",
		members: [
			{ username: "glad-fjord", role: "member" },
			{ username: "rask-elv", role: "member" },
			{ username: "stille-skog", role: "member" },
		],
	},
]

const collaborators = [
	{ id: "c-1", username: "glad-fjord", permission: "admin", syncedAt: "2026-06-01T10:00:00Z" },
	{ id: "c-2", username: "rask-elv", permission: "admin", syncedAt: "2026-06-01T10:00:00Z" },
	{ id: "c-3", username: "stille-skog", permission: "admin", syncedAt: "2026-06-01T10:00:00Z" },
]

const changeLog = [
	{
		id: "log-1",
		action: "github_collaborator_synced",
		previousValue: null,
		newValue: JSON.stringify({ username: "glad-fjord", permission: "admin" }),
		metadata: null,
		performedBy: "system",
		performedAt: "2026-06-01T10:00:00Z",
	},
]

/** Viser ekspanderbare rader med tilgangskilder. Brukere i mange team
 * (som glad-fjord med push + 4× pull + maintain) holder tabellen kompakt —
 * klikk ▶ for å se direkte tilgang og teamliste. */
export const MangeBrukereOgTeam: Story = {
	name: "Mange brukere og team (ekspanderbare rader)",
	args: { teams, collaborators, changeLog },
}

/** Kun team-tilgang, ingen direkte collaborators. */
export const KunTeamTilgang: Story = {
	name: "Kun team-tilgang",
	args: {
		teams,
		collaborators: [],
		changeLog: [],
	},
}

/** Kun direktetilgang, ingen team. */
export const KunDirekteTilgang: Story = {
	name: "Kun direkte collaborators",
	args: {
		teams: [],
		collaborators,
		changeLog,
	},
}

/** Én bruker via ett team – enkelt tilfelle. */
export const EnkelTilgang: Story = {
	name: "Enkel tilgang (ett team)",
	args: {
		teams: [
			{
				id: "team-1",
				teamSlug: "pensjon-core",
				teamName: "pensjon-core",
				permission: "push",
				syncedAt: "2026-06-01T10:00:00Z",
				members: [{ username: "modig-bjork", role: "member" }],
			},
		],
		collaborators: [],
		changeLog: [],
	},
}

/** Ingen data synkronisert ennå. */
export const IngenData: Story = {
	name: "Ingen data",
	args: { teams: [], collaborators: [], changeLog: [] },
}
