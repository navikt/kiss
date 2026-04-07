import type { JWTPayload } from "jose"
import { createRemoteJWKSet, jwtVerify } from "jose"

const ADMIN_GROUP_ID = "1e97cbc6-0687-4d23-aebd-c611035279c1" // pensjon-revisjon
const _USER_GROUP_ID = "415d3817-c83d-44c9-a52b-5116757f8fa8" // teampensjon

export type UserRole = "admin" | "user"

export interface NavUser {
	navIdent: string
	name: string
	email?: string
	groups: string[]
	token: string
	role: UserRole
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

/** Derive user role from Azure AD group memberships. */
export function deriveRole(groups: string[]): UserRole {
	if (groups.includes(ADMIN_GROUP_ID)) return "admin"
	return "user"
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
		role: deriveRole(groups),
	}
}

export async function getAuthenticatedUser(request: Request): Promise<NavUser | null> {
	// In local development, use the configured dev user
	const localUser = getLocalDevUser()
	if (localUser) return localUser

	const token = extractBearerToken(request)
	if (!token) {
		return null
	}

	try {
		const claims = await validateToken(token)
		const groups = claims.groups ?? []
		return {
			navIdent: claims.NAVident ?? "unknown",
			name: claims.name ?? "Ukjent bruker",
			email: claims.preferred_username,
			groups,
			token,
			role: deriveRole(groups),
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

/** Check if a user has the admin role. */
export function isAdmin(user: NavUser): boolean {
	return user.role === "admin"
}

/** Require admin role, throw 403 if not. */
export function requireAdmin(user: NavUser): NavUser {
	if (!isAdmin(user)) {
		throw new Response("Ingen tilgang", { status: 403 })
	}
	return user
}
