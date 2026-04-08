import type { JWTPayload } from "jose"
import { createRemoteJWKSet, jwtVerify } from "jose"
import { getUserRoles } from "~/db/queries/users.server"
import type { UserRole } from "~/db/schema/organization"

export interface UserRoleEntry {
	role: UserRole
	sectionId: string | null
	devTeamId: string | null
}

export interface NavUser {
	navIdent: string
	name: string
	email?: string
	groups: string[]
	token: string
	dbRoles: UserRoleEntry[]
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
function getLocalDevUser(): NavUser | null {
	const ident = process.env.LOCAL_DEV_USER
	if (!ident) return null

	const groups = (process.env.LOCAL_DEV_GROUPS ?? "").split(",").filter(Boolean)
	return {
		navIdent: ident,
		name: process.env.LOCAL_DEV_NAME ?? "Lokal utvikler",
		email: process.env.LOCAL_DEV_EMAIL ?? `${ident.toLowerCase()}@nav.no`,
		groups,
		token: "local-dev-token",
		dbRoles: [],
	}
}

async function loadDbRoles(navIdent: string): Promise<UserRoleEntry[]> {
	try {
		const roles = await getUserRoles(navIdent)
		return roles.map((r) => ({
			role: r.role,
			sectionId: r.sectionId,
			devTeamId: r.devTeamId,
		}))
	} catch {
		// DB not available during startup/tests — fall back to empty roles
		return []
	}
}

export async function getAuthenticatedUser(request: Request): Promise<NavUser | null> {
	// In local development, use the configured dev user
	const localUser = getLocalDevUser()
	if (localUser) {
		localUser.dbRoles = await loadDbRoles(localUser.navIdent)
		return localUser
	}

	const token = extractBearerToken(request)
	if (!token) {
		return null
	}

	try {
		const claims = await validateToken(token)
		const groups = claims.groups ?? []
		const navIdent = claims.NAVident ?? "unknown"
		const dbRoles = await loadDbRoles(navIdent)
		return {
			navIdent,
			name: claims.name ?? "Ukjent bruker",
			email: claims.preferred_username,
			groups,
			token,
			dbRoles,
		}
	} catch {
		return null
	}
}

export function requireUser(user: NavUser | null): NavUser {
	if (!user) {
		throw new Response("Ikke autentisert", { status: 401 })
	}
	return user
}
