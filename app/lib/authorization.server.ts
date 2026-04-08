import type { UserRole } from "~/db/schema/organization"
import type { NavUser } from "./auth.server"

// Azure AD group IDs – configure via environment
const ADMIN_GROUP_IDS = (process.env.KISS_ADMIN_GROUP_IDS ?? "").split(",").filter(Boolean)
const AUDITOR_GROUP_IDS = (process.env.KISS_AUDITOR_GROUP_IDS ?? "").split(",").filter(Boolean)

// ---------------------------------------------------------------------------
// AD-gruppe → rolle mapping (alltid aktiv, uavhengig av DB)
// ---------------------------------------------------------------------------

function adGroupRoles(user: NavUser): UserRole[] {
	const roles: UserRole[] = []
	if (user.groups.some((g) => ADMIN_GROUP_IDS.includes(g))) roles.push("admin")
	if (user.groups.some((g) => AUDITOR_GROUP_IDS.includes(g))) roles.push("auditor")
	return roles
}

// ---------------------------------------------------------------------------
// Generiske rolle-sjekker
// ---------------------------------------------------------------------------

/** Sjekk om bruker har en gitt rolle (globalt, uavhengig av scope). */
export function hasRole(user: NavUser, role: UserRole): boolean {
	if (adGroupRoles(user).includes(role)) return true
	return (user.dbRoles ?? []).some((r) => r.role === role)
}

/** Sjekk om bruker har en rolle scopet til en seksjon. Admin har alltid tilgang. */
export function hasRoleForSection(user: NavUser, role: UserRole, sectionId: string): boolean {
	if (hasRole(user, "admin")) return true
	return hasExactRoleForSection(user, role, sectionId)
}

/** Streng sjekk: har bruker nøyaktig denne rollen for seksjonen (uten admin-bypass). */
export function hasExactRoleForSection(user: NavUser, role: UserRole, sectionId: string): boolean {
	return (user.dbRoles ?? []).some((r) => r.role === role && (r.sectionId === sectionId || r.sectionId === null))
}

/** Sjekk om bruker har en rolle scopet til et team. Admin har alltid tilgang. */
export function hasRoleForTeam(user: NavUser, role: UserRole, devTeamId: string): boolean {
	if (hasRole(user, "admin")) return true
	return (user.dbRoles ?? []).some((r) => r.role === role && (r.devTeamId === devTeamId || r.devTeamId === null))
}

// ---------------------------------------------------------------------------
// Bekvemmelighets-funksjoner (bygger på hasRole)
// ---------------------------------------------------------------------------

/** Admin: via AD-gruppe eller DB-rolle */
export function isAdmin(user: NavUser): boolean {
	return hasRole(user, "admin")
}

/** Revisor: egen rolle eller admin */
export function isAuditor(user: NavUser): boolean {
	return hasRole(user, "auditor") || isAdmin(user)
}

/** Kan administrere en seksjon (admin, seksjonsleder, teknologileder for seksjonen) */
export function canManageSection(user: NavUser, sectionId: string): boolean {
	if (isAdmin(user)) return true
	return hasRoleForSection(user, "section_manager", sectionId) || hasRoleForSection(user, "tech_manager", sectionId)
}

/** Kan administrere et team (admin, produktleder, tech lead for teamet) */
export function canManageTeam(user: NavUser, devTeamId: string): boolean {
	if (isAdmin(user)) return true
	return hasRoleForTeam(user, "product_owner", devTeamId) || hasRoleForTeam(user, "tech_lead", devTeamId)
}

/** Kan se rapporter (admin, revisor, seksjonsleder, teknologileder) */
export function canViewReports(user: NavUser, sectionId?: string): boolean {
	if (isAdmin(user) || isAuditor(user)) return true
	if (!sectionId) return false
	return hasRoleForSection(user, "section_manager", sectionId) || hasRoleForSection(user, "tech_manager", sectionId)
}

/** Kan tildele roller (kun admin) */
export function canAssignRoles(user: NavUser): boolean {
	return isAdmin(user)
}

// ---------------------------------------------------------------------------
// Require-varianter (kaster 403)
// ---------------------------------------------------------------------------

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

export function requireRole(user: NavUser, role: UserRole): void {
	if (!hasRole(user, role)) {
		throw new Response("Ikke autorisert", { status: 403 })
	}
}

export function requireSectionAccess(user: NavUser, sectionId: string): void {
	if (!canManageSection(user, sectionId)) {
		throw new Response("Ikke autorisert", { status: 403 })
	}
}
