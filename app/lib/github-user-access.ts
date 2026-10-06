/**
 * Delt logikk for å regne ut hvem som har GitHub-tilgang til et repo og hvorfor
 * (direkte collaborator-tilgang og/eller via team-medlemskap), samt å rangere
 * tilgangsnivåer. Brukes både av applikasjonens "GitHub-tilganger"-fane og av
 * `github_access_maintenance`-aktiviteten i periodiske gjennomganger — holdes her
 * som client-safe (ingen DB-import) slik at begge kan dele samme kilde til sannhet.
 */

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

/** Aksel `Tag`-varianter per tilgangsnivå — brukt av `GithubPermissionTag` (`app/components/`),
 *  delt mellom "GitHub-tilganger"-fanen og `github_access_maintenance`-aktiviteten. */
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
			displayName: string | null
			navIdent: string | null
			permissions: string[]
			directPermission: string | null
			viaTeams: GithubUserAccess["viaTeams"]
		}
	>()

	for (const collab of collaborators) {
		map.set(collab.username, {
			displayName: collab.displayName ?? null,
			navIdent: collab.navIdent ?? null,
			permissions: [collab.permission],
			directPermission: collab.permission,
			viaTeams: [],
		})
	}

	for (const team of teams) {
		for (const member of team.members) {
			const entry = map.get(member.username) ?? {
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
			map.set(member.username, entry)
		}
	}

	return Array.from(map.entries())
		.map(([username, data]) => ({
			username,
			displayName: data.displayName,
			navIdent: data.navIdent,
			highestPermission: highestGithubPermission(data.permissions),
			directPermission: data.directPermission,
			viaTeams: data.viaTeams,
		}))
		.sort((a, b) => {
			// Ukjente permissions (indexOf = -1) sorteres sist, ikke først
			const aIdx = GITHUB_PERMISSION_ORDER.indexOf(a.highestPermission)
			const bIdx = GITHUB_PERMISSION_ORDER.indexOf(b.highestPermission)
			const aOrder = aIdx === -1 ? GITHUB_PERMISSION_ORDER.length : aIdx
			const bOrder = bIdx === -1 ? GITHUB_PERMISSION_ORDER.length : bIdx
			return aOrder !== bOrder ? aOrder - bOrder : a.username.localeCompare(b.username)
		})
}
