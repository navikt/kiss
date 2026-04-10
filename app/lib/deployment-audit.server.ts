import type { VerificationSummaryResponse } from "../db/schema/deployment-audit"
import { getClientCredentialToken } from "./azure.server"
import { logger } from "./logger.server"

const DEPLOYMENT_AUDIT_SCOPE = process.env.DEPLOYMENT_AUDIT_SCOPE
const DEPLOYMENT_AUDIT_BASE_URL = process.env.DEPLOYMENT_AUDIT_BASE_URL

function isDevMode(): boolean {
	return !DEPLOYMENT_AUDIT_BASE_URL
}

async function fetchWithAuth(path: string): Promise<Response> {
	if (!DEPLOYMENT_AUDIT_SCOPE) {
		throw new Error("DEPLOYMENT_AUDIT_SCOPE is not configured")
	}
	if (!DEPLOYMENT_AUDIT_BASE_URL) {
		throw new Error("DEPLOYMENT_AUDIT_BASE_URL is not configured")
	}

	const token = await getClientCredentialToken(DEPLOYMENT_AUDIT_SCOPE)

	const url = `${DEPLOYMENT_AUDIT_BASE_URL}${path}`
	logger.debug("Fetching deployment-audit", { url })

	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${token}`,
		},
	})

	return response
}

// ─── In-memory cache (1h TTL, thundering herd protection) ───────────────────

const CACHE_TTL_MS = 60 * 60 * 1000
const cache = new Map<string, { data: VerificationSummaryResponse | null; notMonitored: boolean; fetchedAt: number }>()

function getCached(key: string): { data: VerificationSummaryResponse | null; notMonitored: boolean } | undefined {
	const entry = cache.get(key)
	if (!entry) return undefined
	if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
		cache.delete(key)
		return undefined
	}
	return { data: entry.data, notMonitored: entry.notMonitored }
}

function setCache(key: string, data: VerificationSummaryResponse | null, notMonitored: boolean) {
	cache.set(key, { data, fetchedAt: Date.now(), notMonitored })
}

// ─── Mock data (for lokal utvikling uten deployment-audit tilgjengelig) ──────

function getMockVerificationSummary(team: string, env: string, app: string): VerificationSummaryResponse {
	const hash = [...`${team}/${env}/${app}`].reduce((acc, c) => acc + c.charCodeAt(0), 0)
	const coveragePercent = 60 + (hash % 40)

	return {
		app: { team, environment: env, name: app, isActive: true },
		period: {
			from: new Date(new Date().getFullYear(), 0, 1).toISOString(),
			to: new Date().toISOString(),
		},
		fourEyesCoverage: {
			total: 42,
			approved: Math.round(42 * (coveragePercent / 100)),
			unapproved: Math.round(42 * ((100 - coveragePercent) / 100)),
			pending: 1,
			coveragePercent,
		},
		changeOriginCoverage: {
			total: 35,
			linked: Math.round(35 * ((coveragePercent - 10) / 100)),
			dependabot: 7,
			coveragePercent: Math.max(0, coveragePercent - 10),
		},
		lastDeployment: {
			createdAt: new Date().toISOString(),
			deployer: "x123456",
			commitSha: "abc123def456789012345678901234567890",
			fourEyesStatus: "approved",
			hasChangeOrigin: true,
		},
	}
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface VerificationResult {
	data: VerificationSummaryResponse | null
	notMonitored: boolean
}

/**
 * Hent verifiseringsstatus for en applikasjon fra deployment-audit.
 *
 * @returns data + notMonitored flag (404 = not monitored)
 */
export async function getVerificationSummary(
	team: string,
	env: string,
	app: string,
	from?: string,
	to?: string,
): Promise<VerificationResult> {
	if (isDevMode()) {
		logger.warn("DEPLOYMENT_AUDIT_BASE_URL not set — returning mock data", { team, env, app })
		return { data: getMockVerificationSummary(team, env, app), notMonitored: false }
	}

	const cacheKey = `${team}/${env}/${app}`
	const cached = getCached(cacheKey)
	if (cached) return cached

	try {
		const params = new URLSearchParams()
		if (from) params.set("from", from)
		if (to) params.set("to", to)

		const query = params.toString() ? `?${params.toString()}` : ""
		const path = `/api/v1/apps/${encodeURIComponent(team)}/${encodeURIComponent(env)}/${encodeURIComponent(app)}/verification-summary${query}`

		const response = await fetchWithAuth(path)

		if (response.status === 404) {
			logger.info("App not monitored by deployment-audit (404)", { team, env, app })
			setCache(cacheKey, null, true)
			return { data: null, notMonitored: true }
		}

		if (!response.ok) {
			const text = await response.text()
			logger.error("deployment-audit request failed", {
				url: path,
				status: response.status,
				body: text,
			})
			return { data: null, notMonitored: false }
		}

		const data = (await response.json()) as VerificationSummaryResponse
		setCache(cacheKey, data, false)
		return { data, notMonitored: false }
	} catch (error) {
		logger.error("Failed to fetch verification summary", { team, env, app, error })
		return { data: null, notMonitored: false }
	}
}
