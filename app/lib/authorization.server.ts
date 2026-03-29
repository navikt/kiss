import type { NavUser } from "./auth.server"

// Azure AD group IDs – configure via environment or database
const ADMIN_GROUP_IDS = (process.env.KISS_ADMIN_GROUP_IDS ?? "").split(",").filter(Boolean)
const AUDITOR_GROUP_IDS = (process.env.KISS_AUDITOR_GROUP_IDS ?? "").split(",").filter(Boolean)

export function isAdmin(user: NavUser): boolean {
	return user.groups.some((g) => ADMIN_GROUP_IDS.includes(g))
}

export function isAuditor(user: NavUser): boolean {
	return user.groups.some((g) => AUDITOR_GROUP_IDS.includes(g)) || isAdmin(user)
}

export function requireAdmin(user: NavUser): void {
	if (!isAdmin(user)) {
		throw new Response("Ikke autorisert", { status: 403 })
	}
}

export function requireAuditor(user: NavUser): void {
	if (!isAuditor(user)) {
		throw new Response("Ikke autorisert", { status: 403 })
	}
}
