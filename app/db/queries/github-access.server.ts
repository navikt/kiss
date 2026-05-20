import { and, desc, eq, inArray } from "drizzle-orm"
import { db } from "../connection.server"
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
