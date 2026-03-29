import type { JWTPayload } from "jose"
import { createRemoteJWKSet, jwtVerify } from "jose"

export interface NavUser {
	navIdent: string
	name: string
	email?: string
	groups: string[]
	token: string
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

export async function getAuthenticatedUser(request: Request): Promise<NavUser | null> {
	const token = extractBearerToken(request)
	if (!token) {
		return null
	}

	try {
		const claims = await validateToken(token)
		return {
			navIdent: claims.NAVident ?? "unknown",
			name: claims.name ?? "Ukjent bruker",
			email: claims.preferred_username,
			groups: claims.groups ?? [],
			token,
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
