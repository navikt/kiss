export const persistenceLabels: Record<string, string> = {
	cloud_sql_postgres: "PostgreSQL",
	nais_postgres: "Postgres",
	opensearch: "OpenSearch",
	bucket: "Bucket",
	valkey: "Valkey",
	oracle: "Oracle",
	other: "Annet",
}

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

export type UnassignedApp = {
	appId: string
	appName: string
	naisTeamSlug: string
	environments: string[]
}

export type IgnoredApp = {
	appId: string
	appName: string
	reason: string | null
	ignoredBy: string
	ignoredAt: string | null
}

export type SectionEnvironment = {
	cluster: string
	included: boolean
}
