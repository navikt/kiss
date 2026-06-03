import type { JWTPayload } from "jose"
import { createRemoteJWKSet, jwtVerify } from "jose"
import { getUserRoles, upsertUser } from "~/db/queries/users.server"
import type { UserRole } from "~/db/schema/organization"

export interface UserRoleEntry {
	role: UserRole
	sectionId: string | null
	devTeamId: string | null
	devTeamSectionId: string | null
}

export interface NavUser {
	navIdent: string
	name: string
	email?: string
	/** Effective AD groups — admin group removed when not elevated */
	groups: string[]
	token: string
	/** Effective DB roles — admin role removed when not elevated */
	dbRoles: UserRoleEntry[]
	/** Pre-computed global roles for this request. Admin stripped when not elevated. */
	roles: ReadonlySet<UserRole>
	/** True if user is genuinely in an admin group or has the admin db-role (regardless of elevation). Used by toggle UI. */
	isActualAdmin: boolean
	/** True when admin privileges are not active (no elevation cookie). Used by toggle UI for button label. */
	adminSuppressed: boolean
}

interface AzureAdClaims extends JWTPayload {
	NAVident?: string
	name?: string
	preferred_username?: string
	groups?: string[]
}

const AZURE_OPENID_CONFIG_URL = process.env.AZURE_OPENID_CONFIG_JWKS_URI
const AZURE_APP_CLIENT_ID = process.env.AZURE_APP_CLIENT_ID

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null

function getJwks() {
	if (!jwks && AZURE_OPENID_CONFIG_URL) {
		jwks = createRemoteJWKSet(new URL(AZURE_OPENID_CONFIG_URL))
	}
	return jwks
}

export async function validateToken(token: string): Promise<AzureAdClaims> {
	const keySet = getJwks()
	if (!keySet) {
		throw new Error("JWKS not configured – missing AZURE_OPENID_CONFIG_JWKS_URI")
	}

	const { payload } = await jwtVerify(token, keySet, {
		audience: AZURE_APP_CLIENT_ID,
		algorithms: ["RS256"],
	})

	if (!payload.iss) {
		throw new Error("Token missing issuer")
	}

	return payload as AzureAdClaims
}

export function extractBearerToken(request: Request): string | null {
	const authHeader = request.headers.get("Authorization")
	if (authHeader?.startsWith("Bearer ")) {
		return authHeader.slice(7)
	}
	return null
}

/** Build a local dev user from environment variables. Returns null if not configured. */
function getLocalDevUser(): Omit<NavUser, "dbRoles" | "roles" | "isActualAdmin" | "adminSuppressed"> | null {
	const ident = process.env.LOCAL_DEV_USER
	if (!ident) return null

	const groups = (process.env.LOCAL_DEV_GROUPS ?? "").split(",").filter(Boolean)
	return {
		navIdent: ident,
		name: process.env.LOCAL_DEV_NAME ?? "Lokal utvikler",
		email: process.env.LOCAL_DEV_EMAIL ?? `${ident.toLowerCase()}@nav.no`,
		groups,
		token: "local-dev-token",
	}
}

/** Read and parse group IDs from an env var (uncached — called once per request during user building). */
function getGroupIds(envVar: string): string[] {
	return (process.env[envVar] ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
}

/**
 * Single place where adminSuppressed is applied to authorization data.
 * Computes isActualAdmin, strips admin from groups/dbRoles when not elevated,
 * and pre-computes the full global role set for the request.
 */
function buildEffectiveAuth(
	groups: string[],
	dbRoles: UserRoleEntry[],
	adminGroupIds: string[],
	auditorGroupIds: string[],
	adminSuppressed: boolean,
): { groups: string[]; dbRoles: UserRoleEntry[]; roles: ReadonlySet<UserRole>; isActualAdmin: boolean } {
	const isActualAdmin = groups.some((g) => adminGroupIds.includes(g)) || dbRoles.some((r) => r.role === "admin")
	const effectiveGroups = adminSuppressed ? groups.filter((g) => !adminGroupIds.includes(g)) : groups
	const effectiveDbRoles = adminSuppressed ? dbRoles.filter((r) => r.role !== "admin") : dbRoles

	const roles = new Set<UserRole>()
	if (effectiveGroups.some((g) => adminGroupIds.includes(g))) roles.add("admin")
	if (effectiveGroups.some((g) => auditorGroupIds.includes(g))) roles.add("auditor")
	for (const r of effectiveDbRoles) roles.add(r.role)

	// Auditor-suppression: when a user has the auditor role but is NOT an effective admin,
	// strip all other DB roles so auditor mode cannot be bypassed via team/section roles.
	if (roles.has("auditor") && !roles.has("admin")) {
		const auditorOnlyRoles = effectiveDbRoles.filter((r) => r.role === "auditor")
		return { groups: effectiveGroups, dbRoles: auditorOnlyRoles, roles: new Set<UserRole>(["auditor"]), isActualAdmin }
	}

	return { groups: effectiveGroups, dbRoles: effectiveDbRoles, roles, isActualAdmin }
}

async function loadDbRoles(navIdent: string): Promise<UserRoleEntry[]> {
	try {
		const roles = await getUserRoles(navIdent)
		return roles.map((r) => ({
			role: r.role,
			sectionId: r.sectionId,
			devTeamId: r.devTeamId,
			devTeamSectionId: r.devTeamSectionId,
		}))
	} catch {
		// DB not available during startup/tests — fall back to empty roles
		return []
	}
}

export const ADMIN_ELEVATED_COOKIE = "kiss-admin-elevated"

/** Admin mode is suppressed unless the user has actively elevated via cookie */
export function isAdminSuppressed(request: Request): boolean {
	const cookieHeader = request.headers.get("Cookie") ?? ""
	const cookies = cookieHeader.split(";").map((c) => c.trim())
	return !cookies.some((cookie) => cookie === `${ADMIN_ELEVATED_COOKIE}=true`)
}

export async function getAuthenticatedUser(request: Request): Promise<NavUser | null> {
	const adminSuppressed = isAdminSuppressed(request)
	const adminGroupIds = getGroupIds("KISS_ADMIN_GROUP_IDS")
	const auditorGroupIds = getGroupIds("KISS_AUDITOR_GROUP_IDS")

	// In local development, use the configured dev user
	const localDevBase = getLocalDevUser()
	if (localDevBase) {
		const dbRoles = await loadDbRoles(localDevBase.navIdent)
		const auth = buildEffectiveAuth(localDevBase.groups, dbRoles, adminGroupIds, auditorGroupIds, adminSuppressed)
		trackLogin(localDevBase.navIdent, localDevBase.name, localDevBase.email)
		return { ...localDevBase, ...auth, adminSuppressed }
	}

	const token = extractBearerToken(request)
	if (!token) {
		return null
	}

	try {
		const claims = await validateToken(token)
		const groups = claims.groups ?? []
		const navIdent = claims.NAVident ?? "unknown"
		const name = claims.name ?? "Ukjent bruker"
		const email = claims.preferred_username
		const dbRoles = await loadDbRoles(navIdent)
		const auth = buildEffectiveAuth(groups, dbRoles, adminGroupIds, auditorGroupIds, adminSuppressed)
		trackLogin(navIdent, name, email)
		return { navIdent, name, email, token, ...auth, adminSuppressed }
	} catch {
		return null
	}
}

/** Fire-and-forget upsert to track user login. Errors are silently ignored. */
function trackLogin(navIdent: string, name: string, email?: string) {
	upsertUser(navIdent, name, email).catch(() => {})
}

export function requireUser(user: NavUser | null): NavUser {
	if (!user) {
		throw new Response("Ikke autentisert", { status: 401 })
	}
	return user
}

export async function requireAuthenticatedUser(request: Request): Promise<NavUser> {
	return requireUser(await getAuthenticatedUser(request))
}
