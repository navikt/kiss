import { eq, sql } from "drizzle-orm"
import { db } from "../db/connection.server"
import { writeAuditLog } from "../db/queries/audit.server"
import { githubRepoCollaborators, githubRepoTeamMembers, githubRepoTeams } from "../db/schema/github-access"
import {
	type GitHubCollaborator,
	type GitHubTeam,
	type GitHubTeamMember,
	getRepoCollaborators,
	getRepoTeams,
	getTeamMembers,
	isGitHubAppConfigured,
} from "./github.server"
import { withAdvisoryLock } from "./lock.server"
import { logger } from "./logger.server"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export interface GitHubAccessSyncResult {
	appsProcessed: number
	teamsAdded: number
	teamsRemoved: number
	teamsUpdated: number
	collaboratorsAdded: number
	collaboratorsRemoved: number
	collaboratorsUpdated: number
	membersAdded: number
	membersRemoved: number
	errors: number
	durationMs: number
}

/** Parses git repository in either "owner/repo" or "https://github.com/owner/repo" format. */
export function parseGitRepository(gitRepository: string): { owner: string; repo: string } {
	let ownerRepo = gitRepository.trim()
	if (!ownerRepo) {
		throw new Error("Invalid git repository format: empty string")
	}
	// Strip GitHub URL prefix if present (both http and https)
	if (ownerRepo.startsWith("http://") || ownerRepo.startsWith("https://")) {
		try {
			const url = new URL(ownerRepo)
			ownerRepo = url.pathname.replace(/^\//, "")
		} catch {
			throw new Error(`Invalid git repository URL: ${gitRepository}`)
		}
	}
	// Remove trailing slash or .git suffix
	ownerRepo = ownerRepo.replace(/\/$/, "").replace(/\.git$/, "")

	const segments = ownerRepo.split("/")
	if (segments.length !== 2 || !segments[0] || !segments[1]) {
		throw new Error(
			`Invalid git repository format: ${gitRepository} (expected owner/repo or https://github.com/owner/repo)`,
		)
	}
	return { owner: segments[0], repo: segments[1] }
}

/**
 * Henter alle aktive applikasjoner som har et git-repository konfigurert.
 * Foretrekker app-nivå git_repository, faller tilbake til første environment-repo (tidligst discoveredAt).
 *
 * Bruker fullstendig raw SQL med eksplisitte aliaser (ma/ae/ae2) for å unngå en Drizzle-bug
 * der ${table.column} i sql`` scalar subquery i SELECT-listen ikke korrelerer korrekt
 * mot outer query, og returnerer null for alle rader.
 */
export async function findAppsWithGitRepository(): Promise<Array<{ id: string; gitRepository: string }>> {
	const rows = await db.execute<{ id: string; git_repository: string | null }>(
		sql`
			SELECT ma.id,
				COALESCE(
					NULLIF(trim(ma.git_repository), ''),
					(
						SELECT ae.git_repository
						FROM application_environments ae
						WHERE ae.application_id = ma.id
							AND ae.git_repository IS NOT NULL
							AND trim(ae.git_repository) != ''
						ORDER BY ae.discovered_at ASC
						LIMIT 1
					)
				) AS git_repository
			FROM monitored_applications ma
			WHERE ma.archived_at IS NULL
				AND (
					(ma.git_repository IS NOT NULL AND trim(ma.git_repository) != '')
					OR EXISTS (
						SELECT 1 FROM application_environments ae2
						WHERE ae2.application_id = ma.id
							AND ae2.git_repository IS NOT NULL
							AND trim(ae2.git_repository) != ''
					)
				)
		`,
	)
	return rows.rows
		.filter(
			(r): r is { id: string; git_repository: string } => r.git_repository != null && r.git_repository.trim() !== "",
		)
		.map((r) => ({ id: r.id, gitRepository: r.git_repository }))
}

/**
 * Kjører full GitHub-tilgangssynkronisering for alle applikasjoner med gitRepository.
 * Bruker advisory lock for å forhindre parallell kjøring på tvers av pods.
 */
export type GitHubSyncOutcome =
	| { status: "success"; result: GitHubAccessSyncResult }
	| { status: "not_configured" }
	| { status: "lock_held" }

export async function runGitHubAccessSync(performedBy = "github-access-sync"): Promise<GitHubSyncOutcome> {
	if (!isGitHubAppConfigured()) {
		logger.info("[github-access-sync] GitHub App not configured — skipping")
		return { status: "not_configured" }
	}

	// Advisory lock wraps the entire sync to prevent concurrent runs across pods.
	// This holds one pool connection for the sync duration (acceptable for a daily job).
	const syncResult = await withAdvisoryLock("github-access-sync", async () => {
		const start = Date.now()
		logger.info("[github-access-sync] Starting sync")

		const result: GitHubAccessSyncResult = {
			appsProcessed: 0,
			teamsAdded: 0,
			teamsRemoved: 0,
			teamsUpdated: 0,
			collaboratorsAdded: 0,
			collaboratorsRemoved: 0,
			collaboratorsUpdated: 0,
			membersAdded: 0,
			membersRemoved: 0,
			errors: 0,
			durationMs: 0,
		}

		const targetApps = await findAppsWithGitRepository()
		logger.info(`[github-access-sync] Found ${targetApps.length} apps with git repository`)

		for (const app of targetApps) {
			if (!app.gitRepository?.trim()) continue
			try {
				const appResult = await syncAppAccess(app.id, app.gitRepository, performedBy)
				result.appsProcessed++
				result.teamsAdded += appResult.teamsAdded
				result.teamsRemoved += appResult.teamsRemoved
				result.teamsUpdated += appResult.teamsUpdated
				result.collaboratorsAdded += appResult.collaboratorsAdded
				result.collaboratorsRemoved += appResult.collaboratorsRemoved
				result.collaboratorsUpdated += appResult.collaboratorsUpdated
				result.membersAdded += appResult.membersAdded
				result.membersRemoved += appResult.membersRemoved
			} catch (err) {
				result.errors++
				logger.error(`[github-access-sync] Error syncing ${app.gitRepository}`, err)
			}
		}

		result.durationMs = Date.now() - start
		logger.info(
			`[github-access-sync] Complete: ${result.appsProcessed} apps, +${result.teamsAdded}/-${result.teamsRemoved}/~${result.teamsUpdated} teams, +${result.collaboratorsAdded}/-${result.collaboratorsRemoved}/~${result.collaboratorsUpdated} collaborators, ${result.errors} errors (${result.durationMs}ms)`,
		)

		return result
	})

	if (syncResult === null) {
		return { status: "lock_held" }
	}
	return { status: "success", result: syncResult }
}

interface AppSyncResult {
	teamsAdded: number
	teamsRemoved: number
	teamsUpdated: number
	collaboratorsAdded: number
	collaboratorsRemoved: number
	collaboratorsUpdated: number
	membersAdded: number
	membersRemoved: number
}

async function syncAppAccess(appId: string, gitRepository: string, performedBy: string): Promise<AppSyncResult> {
	const { owner, repo } = parseGitRepository(gitRepository)

	// Fetch current state from GitHub (outside transaction to avoid long-held locks)
	const [ghTeams, ghCollaborators] = await Promise.all([getRepoTeams(owner, repo), getRepoCollaborators(owner, repo)])

	// Fetch team members in parallel with concurrency limit to respect rate limits
	const CONCURRENCY_LIMIT = 3
	const ghTeamMembers = new Map<string, GitHubTeamMember[]>()
	for (let i = 0; i < ghTeams.length; i += CONCURRENCY_LIMIT) {
		const batch = ghTeams.slice(i, i + CONCURRENCY_LIMIT)
		const batchResults = await Promise.all(batch.map((team) => getTeamMembers(owner, team.slug)))
		for (let j = 0; j < batch.length; j++) {
			ghTeamMembers.set(batch[j].slug, batchResults[j])
		}
	}

	// Perform all DB writes atomically in a transaction
	return db.transaction(async (tx) => {
		const result: AppSyncResult = {
			teamsAdded: 0,
			teamsRemoved: 0,
			teamsUpdated: 0,
			collaboratorsAdded: 0,
			collaboratorsRemoved: 0,
			collaboratorsUpdated: 0,
			membersAdded: 0,
			membersRemoved: 0,
		}

		// Sync teams
		const teamResult = await syncTeams(tx, appId, gitRepository, ghTeams, performedBy)
		result.teamsAdded = teamResult.added
		result.teamsRemoved = teamResult.removed
		result.teamsUpdated = teamResult.updated

		// Sync team members for each current team
		const currentTeams = await tx
			.select({ id: githubRepoTeams.id, teamSlug: githubRepoTeams.teamSlug })
			.from(githubRepoTeams)
			.where(eq(githubRepoTeams.applicationId, appId))

		for (const team of currentTeams) {
			const members = ghTeamMembers.get(team.teamSlug) ?? []
			const memberResult = await syncTeamMembers(tx, team.id, team.teamSlug, appId, gitRepository, members, performedBy)
			result.membersAdded += memberResult.added
			result.membersRemoved += memberResult.removed
		}

		// Sync collaborators
		const collabResult = await syncCollaborators(tx, appId, gitRepository, ghCollaborators, performedBy)
		result.collaboratorsAdded = collabResult.added
		result.collaboratorsRemoved = collabResult.removed
		result.collaboratorsUpdated = collabResult.updated

		return result
	})
}

async function syncTeams(
	tx: Tx,
	appId: string,
	gitRepository: string,
	ghTeams: GitHubTeam[],
	performedBy: string,
): Promise<{ added: number; removed: number; updated: number }> {
	const existing = await tx.select().from(githubRepoTeams).where(eq(githubRepoTeams.applicationId, appId))

	const existingBySlug = new Map(existing.map((t) => [t.teamSlug, t]))
	const ghBySlug = new Map(ghTeams.map((t) => [t.slug, t]))

	let added = 0
	let removed = 0
	let updated = 0
	const now = new Date()

	for (const ghTeam of ghTeams) {
		const existingTeam = existingBySlug.get(ghTeam.slug)
		if (!existingTeam) {
			await tx.insert(githubRepoTeams).values({
				applicationId: appId,
				teamSlug: ghTeam.slug,
				teamName: ghTeam.name,
				permission: ghTeam.permission,
				syncedAt: now,
			})
			await writeAuditLog(
				{
					action: "github_access_team_added",
					entityType: "monitored_application",
					entityId: appId,
					newValue: JSON.stringify({ teamSlug: ghTeam.slug, teamName: ghTeam.name, permission: ghTeam.permission }),
					metadata: { gitRepository },
					performedBy,
				},
				tx,
			)
			added++
		} else if (existingTeam.permission !== ghTeam.permission) {
			// Permission changed
			await tx
				.update(githubRepoTeams)
				.set({ permission: ghTeam.permission, teamName: ghTeam.name, syncedAt: now })
				.where(eq(githubRepoTeams.id, existingTeam.id))
			await writeAuditLog(
				{
					action: "github_access_team_permission_changed",
					entityType: "monitored_application",
					entityId: appId,
					previousValue: JSON.stringify({
						teamSlug: existingTeam.teamSlug,
						teamName: existingTeam.teamName,
						permission: existingTeam.permission,
					}),
					newValue: JSON.stringify({
						teamSlug: ghTeam.slug,
						teamName: ghTeam.name,
						permission: ghTeam.permission,
					}),
					metadata: { gitRepository },
					performedBy,
				},
				tx,
			)
			updated++
		} else if (existingTeam.teamName !== ghTeam.name) {
			// Only name changed (no permission change)
			await tx
				.update(githubRepoTeams)
				.set({ teamName: ghTeam.name, syncedAt: now })
				.where(eq(githubRepoTeams.id, existingTeam.id))
			await writeAuditLog(
				{
					action: "github_access_team_updated",
					entityType: "monitored_application",
					entityId: appId,
					previousValue: JSON.stringify({ teamSlug: existingTeam.teamSlug, teamName: existingTeam.teamName }),
					newValue: JSON.stringify({ teamSlug: ghTeam.slug, teamName: ghTeam.name }),
					metadata: { gitRepository },
					performedBy,
				},
				tx,
			)
			updated++
		} else {
			await tx.update(githubRepoTeams).set({ syncedAt: now }).where(eq(githubRepoTeams.id, existingTeam.id))
		}
	}

	// Remove teams no longer in GitHub
	for (const [slug, existingTeam] of existingBySlug) {
		if (!ghBySlug.has(slug)) {
			// CASCADE removes members
			await tx.delete(githubRepoTeams).where(eq(githubRepoTeams.id, existingTeam.id))
			await writeAuditLog(
				{
					action: "github_access_team_removed",
					entityType: "monitored_application",
					entityId: appId,
					previousValue: JSON.stringify({
						teamSlug: existingTeam.teamSlug,
						teamName: existingTeam.teamName,
						permission: existingTeam.permission,
					}),
					metadata: { gitRepository },
					performedBy,
				},
				tx,
			)
			removed++
		}
	}

	return { added, removed, updated }
}

async function syncTeamMembers(
	tx: Tx,
	repoTeamId: string,
	teamSlug: string,
	appId: string,
	gitRepository: string,
	ghMembers: GitHubTeamMember[],
	performedBy: string,
): Promise<{ added: number; removed: number }> {
	const existing = await tx.select().from(githubRepoTeamMembers).where(eq(githubRepoTeamMembers.repoTeamId, repoTeamId))

	const existingByUsername = new Map(existing.map((m) => [m.username, m]))
	const ghByUsername = new Map(ghMembers.map((m) => [m.login, m]))

	let added = 0
	let removed = 0
	const now = new Date()

	for (const ghMember of ghMembers) {
		const existingMember = existingByUsername.get(ghMember.login)
		if (!existingMember) {
			await tx.insert(githubRepoTeamMembers).values({
				repoTeamId,
				username: ghMember.login,
				role: ghMember.role,
				syncedAt: now,
			})
			await writeAuditLog(
				{
					action: "github_access_team_member_added",
					entityType: "monitored_application",
					entityId: appId,
					newValue: JSON.stringify({ username: ghMember.login, role: ghMember.role, teamSlug }),
					metadata: { gitRepository },
					performedBy,
				},
				tx,
			)
			added++
		} else if (existingMember.role !== ghMember.role) {
			// Role changed (member ↔ maintainer)
			await tx
				.update(githubRepoTeamMembers)
				.set({ role: ghMember.role, syncedAt: now })
				.where(eq(githubRepoTeamMembers.id, existingMember.id))
			await writeAuditLog(
				{
					action: "github_access_team_member_role_changed",
					entityType: "monitored_application",
					entityId: appId,
					previousValue: JSON.stringify({ username: ghMember.login, role: existingMember.role, teamSlug }),
					newValue: JSON.stringify({ username: ghMember.login, role: ghMember.role, teamSlug }),
					metadata: { gitRepository },
					performedBy,
				},
				tx,
			)
		} else {
			await tx
				.update(githubRepoTeamMembers)
				.set({ syncedAt: now })
				.where(eq(githubRepoTeamMembers.id, existingMember.id))
		}
	}

	// Remove members no longer in team
	for (const [username, existingMember] of existingByUsername) {
		if (!ghByUsername.has(username)) {
			await tx.delete(githubRepoTeamMembers).where(eq(githubRepoTeamMembers.id, existingMember.id))
			await writeAuditLog(
				{
					action: "github_access_team_member_removed",
					entityType: "monitored_application",
					entityId: appId,
					previousValue: JSON.stringify({ username, role: existingMember.role, teamSlug }),
					metadata: { gitRepository },
					performedBy,
				},
				tx,
			)
			removed++
		}
	}

	return { added, removed }
}

async function syncCollaborators(
	tx: Tx,
	appId: string,
	gitRepository: string,
	ghCollaborators: GitHubCollaborator[],
	performedBy: string,
): Promise<{ added: number; removed: number; updated: number }> {
	const existing = await tx
		.select()
		.from(githubRepoCollaborators)
		.where(eq(githubRepoCollaborators.applicationId, appId))

	const existingByUsername = new Map(existing.map((c) => [c.username, c]))
	const ghByUsername = new Map(ghCollaborators.map((c) => [c.login, c]))

	let added = 0
	let removed = 0
	let updated = 0
	const now = new Date()

	for (const ghCollab of ghCollaborators) {
		const existingCollab = existingByUsername.get(ghCollab.login)
		if (!existingCollab) {
			await tx.insert(githubRepoCollaborators).values({
				applicationId: appId,
				username: ghCollab.login,
				permission: ghCollab.role_name,
				syncedAt: now,
			})
			await writeAuditLog(
				{
					action: "github_access_collaborator_added",
					entityType: "monitored_application",
					entityId: appId,
					newValue: JSON.stringify({ username: ghCollab.login, permission: ghCollab.role_name }),
					metadata: { gitRepository },
					performedBy,
				},
				tx,
			)
			added++
		} else if (existingCollab.permission !== ghCollab.role_name) {
			await tx
				.update(githubRepoCollaborators)
				.set({ permission: ghCollab.role_name, syncedAt: now })
				.where(eq(githubRepoCollaborators.id, existingCollab.id))
			await writeAuditLog(
				{
					action: "github_access_collaborator_permission_changed",
					entityType: "monitored_application",
					entityId: appId,
					previousValue: JSON.stringify({ username: ghCollab.login, permission: existingCollab.permission }),
					newValue: JSON.stringify({ username: ghCollab.login, permission: ghCollab.role_name }),
					metadata: { gitRepository },
					performedBy,
				},
				tx,
			)
			updated++
		} else {
			await tx
				.update(githubRepoCollaborators)
				.set({ syncedAt: now })
				.where(eq(githubRepoCollaborators.id, existingCollab.id))
		}
	}

	// Remove collaborators no longer in GitHub
	for (const [username, existingCollab] of existingByUsername) {
		if (!ghByUsername.has(username)) {
			await tx.delete(githubRepoCollaborators).where(eq(githubRepoCollaborators.id, existingCollab.id))
			await writeAuditLog(
				{
					action: "github_access_collaborator_removed",
					entityType: "monitored_application",
					entityId: appId,
					previousValue: JSON.stringify({ username, permission: existingCollab.permission }),
					metadata: { gitRepository },
					performedBy,
				},
				tx,
			)
			removed++
		}
	}

	return { added, removed, updated }
}
