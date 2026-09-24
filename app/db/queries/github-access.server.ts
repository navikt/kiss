import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { normalizeGitRepository } from "../../lib/github.server"
import { db } from "../connection.server"
import { applicationEnvironments, monitoredApplications } from "../schema/applications"
import { type AuditLogAction, auditLog } from "../schema/audit"
import { githubRepoCollaborators, githubRepoTeamMembers, githubRepoTeams } from "../schema/github-access"

export interface GitHubRepoTeamWithMembers {
	id: string
	teamSlug: string
	teamName: string
	permission: string
	syncedAt: Date
	members: Array<{
		username: string
		role: string
	}>
}

export interface GitHubRepoCollaboratorRow {
	id: string
	username: string
	permission: string
	syncedAt: Date
}

export interface GitHubAccessChangeLogEntry {
	id: string
	action: string
	previousValue: string | null
	newValue: string | null
	metadata: string | null
	performedBy: string
	performedAt: Date
}

export interface GitHubSharedApplication {
	id: string
	name: string
	gitRepository: string
}

async function getApplicationsSharingGitRepository(
	appId: string,
	gitRepository: string,
): Promise<GitHubSharedApplication[]> {
	const repositoryKey = normalizeGitRepository(gitRepository)
	if (!repositoryKey) return []

	const rows = await db.execute<{
		id: string
		name: string
		git_repository: string | null
	}>(sql`
		SELECT
			ma.id,
			ma.name,
			COALESCE(
				NULLIF(trim(ma.git_repository), ''),
				(
					SELECT ae.git_repository
					FROM ${applicationEnvironments} ae
					WHERE ae.application_id = ma.id
						AND ae.archived_at IS NULL
						AND ae.git_repository IS NOT NULL
						AND trim(ae.git_repository) != ''
					ORDER BY ae.discovered_at ASC
					LIMIT 1
				)
			) AS git_repository
		FROM ${monitoredApplications} ma
		WHERE ma.archived_at IS NULL
	`)

	return rows.rows
		.map((row) => ({
			...row,
			normalizedRepository: row.git_repository ? normalizeGitRepository(row.git_repository) : null,
		}))
		.filter((row): row is typeof row & { git_repository: string; normalizedRepository: string } =>
			row.id !== appId && row.git_repository != null && row.normalizedRepository === repositoryKey,
		)
		.map(({ id, name, git_repository: gitRepository }) => ({ id, name, gitRepository }))
		.sort((a, b) => a.name.localeCompare(b.name, "nb"))
}

/**
 * Hent aktive applikasjoner som bruker samme effektive GitHub-repository som en applikasjon.
 * App-nivået prioriteres, ellers brukes eldste aktive miljø-repository.
 */
export async function getApplicationsSharingGitRepositoryForApp(appId: string): Promise<GitHubSharedApplication[]> {
	const rows = await db.execute<{ git_repository: string | null }>(sql`
		SELECT
			COALESCE(
				NULLIF(trim(ma.git_repository), ''),
				(
					SELECT ae.git_repository
					FROM ${applicationEnvironments} ae
					WHERE ae.application_id = ma.id
						AND ae.archived_at IS NULL
						AND ae.git_repository IS NOT NULL
						AND trim(ae.git_repository) != ''
					ORDER BY ae.discovered_at ASC
					LIMIT 1
				)
			) AS git_repository
		FROM ${monitoredApplications} ma
		WHERE ma.id = ${appId}
			AND ma.archived_at IS NULL
		LIMIT 1
	`)

	const gitRepository = rows.rows[0]?.git_repository?.trim()
	return gitRepository ? getApplicationsSharingGitRepository(appId, gitRepository) : []
}

/**
 * Hent alle GitHub-team med tilgang til en applikasjon, inkludert medlemmer.
 */
export async function getGitHubTeamsForApp(appId: string): Promise<GitHubRepoTeamWithMembers[]> {
	const teams = await db
		.select()
		.from(githubRepoTeams)
		.where(eq(githubRepoTeams.applicationId, appId))
		.orderBy(githubRepoTeams.teamName)

	if (teams.length === 0) return []

	const teamIds = teams.map((t) => t.id)
	const allMembers = await db
		.select()
		.from(githubRepoTeamMembers)
		.where(inArray(githubRepoTeamMembers.repoTeamId, teamIds))
		.orderBy(githubRepoTeamMembers.username)

	const membersByTeam = new Map<string, Array<{ username: string; role: string }>>()
	for (const member of allMembers) {
		const list = membersByTeam.get(member.repoTeamId) ?? []
		list.push({ username: member.username, role: member.role })
		membersByTeam.set(member.repoTeamId, list)
	}

	return teams.map((team) => ({
		id: team.id,
		teamSlug: team.teamSlug,
		teamName: team.teamName,
		permission: team.permission,
		syncedAt: team.syncedAt,
		members: membersByTeam.get(team.id) ?? [],
	}))
}

/**
 * Hent alle individuelle collaborators for en applikasjon.
 */
export async function getGitHubCollaboratorsForApp(appId: string): Promise<GitHubRepoCollaboratorRow[]> {
	return db
		.select({
			id: githubRepoCollaborators.id,
			username: githubRepoCollaborators.username,
			permission: githubRepoCollaborators.permission,
			syncedAt: githubRepoCollaborators.syncedAt,
		})
		.from(githubRepoCollaborators)
		.where(eq(githubRepoCollaborators.applicationId, appId))
		.orderBy(githubRepoCollaborators.username)
}

/**
 * Hent GitHub-tilgangs endringslogg for en applikasjon (siste 50 endringer).
 */
export async function getGitHubAccessChangeLog(appId: string, limit = 50): Promise<GitHubAccessChangeLogEntry[]> {
	const githubActions: AuditLogAction[] = [
		"github_access_team_added",
		"github_access_team_removed",
		"github_access_team_permission_changed",
		"github_access_team_updated",
		"github_access_collaborator_added",
		"github_access_collaborator_removed",
		"github_access_collaborator_permission_changed",
		"github_access_team_member_added",
		"github_access_team_member_removed",
		"github_access_team_member_role_changed",
	]

	return db
		.select({
			id: auditLog.id,
			action: auditLog.action,
			previousValue: auditLog.previousValue,
			newValue: auditLog.newValue,
			metadata: auditLog.metadata,
			performedBy: auditLog.performedBy,
			performedAt: auditLog.performedAt,
		})
		.from(auditLog)
		.where(
			and(
				eq(auditLog.entityType, "monitored_application"),
				eq(auditLog.entityId, appId),
				inArray(auditLog.action, githubActions),
			),
		)
		.orderBy(desc(auditLog.performedAt))
		.limit(limit)
}
