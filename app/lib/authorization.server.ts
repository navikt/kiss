import { roleScopeMap, type UserRole } from "~/db/schema/organization"
import type { NavUser } from "./auth.server"

// ---------------------------------------------------------------------------
// AD-gruppe → rolle mapping
// Begge AD-gruppe-roller (admin og auditor) supprimeres når admin-modus er deaktivert.
// Auditor-rollen via dbRoles (eksplisitt tildelt, uavhengig av admin) supprimeres ikke.
// Env vars leses ved kall-tidspunkt (ikke ved module-load) for å støtte vi.stubEnv i tester.
// ---------------------------------------------------------------------------

function adGroupRoles(user: NavUser): UserRole[] {
	const adminGroupIds = (process.env.KISS_ADMIN_GROUP_IDS ?? "").split(",").filter(Boolean)
	const auditorGroupIds = (process.env.KISS_AUDITOR_GROUP_IDS ?? "").split(",").filter(Boolean)
	const roles: UserRole[] = []
	if (!user.adminSuppressed && user.groups.some((g) => adminGroupIds.includes(g))) roles.push("admin")
	if (!user.adminSuppressed && user.groups.some((g) => auditorGroupIds.includes(g))) roles.push("auditor")
	return roles
}

// ---------------------------------------------------------------------------
// Generiske rolle-sjekker
// ---------------------------------------------------------------------------

/** Sjekk om bruker har en gitt rolle (globalt, uavhengig av scope). */
export function hasRole(user: NavUser, role: UserRole): boolean {
	if (role === "admin" && user.adminSuppressed) return false
	if (adGroupRoles(user).includes(role)) return true
	return (user.dbRoles ?? []).some((r) => r.role === role && !(r.role === "admin" && user.adminSuppressed))
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

/** Actual admin check ignoring suppression (for toggle UI) */
export function isActualAdmin(user: NavUser): boolean {
	const adminGroupIds = (process.env.KISS_ADMIN_GROUP_IDS ?? "").split(",").filter(Boolean)
	if (user.groups.some((g) => adminGroupIds.includes(g))) return true
	return (user.dbRoles ?? []).some((r) => r.role === "admin")
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

/** Har bruker en vilkårlig rolle i en seksjon (direkte eller via team). */
export function hasAnySectionRole(user: NavUser, sectionId: string): boolean {
	if (isAdmin(user)) return true
	return (user.dbRoles ?? []).some(
		(r) =>
			r.sectionId === sectionId ||
			r.devTeamSectionId === sectionId ||
			(r.sectionId === null && roleScopeMap[r.role] === "section"),
	)
}

/** Kan administrere et team (admin, produktleder, tech lead for teamet).
 * Krever eksakt devTeamId-match for team-roller – null-wildcard godtas ikke. */
export function canManageTeam(user: NavUser, devTeamId: string): boolean {
	if (isAdmin(user)) return true
	return (user.dbRoles ?? []).some(
		(r) => (r.role === "product_owner" || r.role === "tech_lead") && r.devTeamId === devTeamId,
	)
}

/** Kan se seksjonsrapporter (admin, seksjonsleder, teknologileder for seksjonen, eller revisor) */
export function canViewSectionReports(user: NavUser, sectionId: string): boolean {
	return canManageSection(user, sectionId) || isAuditor(user)
}

/** Kan generere og se applikasjonsrapporter og revisjonsbevis:
 * admin, revisor (globalt), seksjonsleder/teknologileder for appens seksjon, eller tech lead/produktleder for appens team */
export function canAccessAppReports(user: NavUser, sectionIds: string[], devTeamIds: string[]): boolean {
	if (isAdmin(user)) return true
	if (isAuditor(user)) return true
	if (sectionIds.some((s) => canViewSectionReports(user, s))) return true
	if (devTeamIds.some((t) => canManageTeam(user, t))) return true
	return false
}

export function requireSectionReportAccess(user: NavUser, sectionId: string): void {
	if (!canViewSectionReports(user, sectionId)) {
		throw new Response("Ikke autorisert", { status: 403 })
	}
}

/** Kan tildele roller (kun admin) */
export function canAssignRoles(user: NavUser): boolean {
	return isAdmin(user)
}
export function canApproveRoutine(user: NavUser, responsibleRole: string | null, sectionId: string): boolean {
	if (isAdmin(user)) return true
	if (!responsibleRole) return false

	const roleMap: Record<string, UserRole> = {
		Teknologileder: "tech_manager",
		Produktleder: "product_owner",
		Seksjonsleder: "section_manager",
	}
	const mappedRole = roleMap[responsibleRole]
	if (!mappedRole) return false
	return hasRoleForSection(user, mappedRole, sectionId)
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

export function requireAnySectionRole(user: NavUser, sectionId: string): void {
	if (!hasAnySectionRole(user, sectionId)) {
		throw new Response("Ikke autorisert", { status: 403 })
	}
}
