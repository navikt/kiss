export type SectionData = {
	id: string
	name: string
	slug: string
	description: string | null
}

export type TeamItem = {
	id: string
	name: string
	slug: string
	description: string | null
	linkedNaisTeams: string[]
	archivedAt: string | null
}

export type LinkedNaisTeam = {
	slug: string
	displayName: string | null
	devTeamId: string | null
}

export type UnlinkedNaisTeam = {
	slug: string
	displayName: string | null
}

export type SectionEnvironment = {
	cluster: string
	included: boolean
}
