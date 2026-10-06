export interface GithubTeamMember {
	username: string
	role: string
	displayName?: string | null
	navIdent?: string | null
}

export interface GithubTeamAccess {
	teamSlug: string
	teamName: string
	permission: string
	members: GithubTeamMember[]
}

export interface GithubCollaboratorAccess {
	username: string
	permission: string
	displayName?: string | null
	navIdent?: string | null
}

export const GITHUB_PERMISSION_ORDER = ["admin", "maintain", "push", "write", "triage", "pull", "read"]

export function highestGithubPermission(permissions: string[]): string {
	for (const p of GITHUB_PERMISSION_ORDER) {
		if (permissions.includes(p)) return p
	}
	return permissions[0] ?? "unknown"
}

export const GITHUB_PERMISSION_TAG_VARIANTS: Record<string, "warning" | "error" | "success" | "info" | "neutral"> = {
	admin: "error",
	maintain: "warning",
	push: "success",
	write: "success",
	triage: "info",
	pull: "neutral",
	read: "neutral",
}

export function githubProfileUrl(username: string): string {
	return `https://github.com/${username}`
}

export function normalizeGithubUsername(username: string): string {
	return username.trim().toLowerCase()
}

export interface GithubUserAccess {
	username: string
	displayName: string | null
	navIdent: string | null
	highestPermission: string
	directPermission: string | null
	viaTeams: Array<{ teamSlug: string; teamName: string; permission: string }>
}

export function computeGithubUserAccess(
	teams: GithubTeamAccess[],
	collaborators: GithubCollaboratorAccess[],
): GithubUserAccess[] {
	const map = new Map<
		string,
		{
			username: string
			displayName: string | null
			navIdent: string | null
			permissions: string[]
			directPermission: string | null
			viaTeams: GithubUserAccess["viaTeams"]
		}
	>()

	for (const collab of collaborators) {
		const key = normalizeGithubUsername(collab.username)
		map.set(key, {
			username: key,
			displayName: collab.displayName ?? null,
			navIdent: collab.navIdent ?? null,
			permissions: [collab.permission],
			directPermission: collab.permission,
			viaTeams: [],
		})
	}

	for (const team of teams) {
		for (const member of team.members) {
			const key = normalizeGithubUsername(member.username)
			const entry = map.get(key) ?? {
				username: key,
				displayName: member.displayName ?? null,
				navIdent: member.navIdent ?? null,
				permissions: [],
				directPermission: null,
				viaTeams: [],
			}
			entry.displayName ??= member.displayName ?? null
			entry.navIdent ??= member.navIdent ?? null
			entry.permissions.push(team.permission)
			entry.viaTeams.push({ teamSlug: team.teamSlug, teamName: team.teamName, permission: team.permission })
			map.set(key, entry)
		}
	}

	return Array.from(map.values())
		.map((data) => ({
			username: data.username,
			displayName: data.displayName,
			navIdent: data.navIdent,
			highestPermission: highestGithubPermission(data.permissions),
			directPermission: data.directPermission,
			viaTeams: data.viaTeams,
		}))
		.sort((a, b) => {
			const aIdx = GITHUB_PERMISSION_ORDER.indexOf(a.highestPermission)
			const bIdx = GITHUB_PERMISSION_ORDER.indexOf(b.highestPermission)
			const aOrder = aIdx === -1 ? GITHUB_PERMISSION_ORDER.length : aIdx
			const bOrder = bIdx === -1 ? GITHUB_PERMISSION_ORDER.length : bIdx
			return aOrder !== bOrder ? aOrder - bOrder : a.username.localeCompare(b.username)
		})
}
