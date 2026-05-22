import { logger } from "./logger.server"

/**
 * Query parameter names whose values should be redacted from logged URLs.
 * This prevents tokens, secrets and other credentials from leaking into logs.
 */
const SENSITIVE_PARAMS = new Set([
	"assertion",
	"client_secret",
	"access_token",
	"refresh_token",
	"id_token",
	"token",
	"code",
	"key",
	"password",
	"secret",
])

/** Redact sensitive query parameters and extract URL parts for structured logging */
function redactUrl(rawUrl: string): { host: string; path: string; url: string } {
	try {
		const parsed = new URL(rawUrl)
		for (const key of parsed.searchParams.keys()) {
			if (SENSITIVE_PARAMS.has(key.toLowerCase())) {
				parsed.searchParams.set(key, "[REDACTED]")
			}
		}
		return {
			host: parsed.host,
			path: parsed.pathname,
			url: parsed.toString(),
		}
	} catch {
		return { host: "[unknown]", path: rawUrl, url: rawUrl }
	}
}

export interface LoggedFetchOptions {
	/**
	 * Functional area / service name that identifies the origin of this call.
	 * Used in ELK to distinguish calls by domain, e.g. "nais", "github", "oracle-revisjon".
	 */
	area: string
}

/**
 * Wrapper around `fetch` that emits one structured log entry per outgoing HTTP call.
 *
 * Every entry carries:
 *   - `log_type: "outgoing_http"` — fixed discriminator for ELK filters
 *   - `area`                      — functional origin of the call
 *   - `method`, `host`, `path`, `url` — request metadata (sensitive query params redacted)
 *   - `status`, `ok`, `durationMs`   — response metadata
 *
 * Network errors are logged at `error` level and re-thrown unchanged.
 */
export async function loggedFetch(
	url: string,
	init: RequestInit | undefined,
	options: LoggedFetchOptions,
): Promise<Response> {
	const method = ((init?.method as string | undefined) ?? "GET").toUpperCase()
	const { host, path, url: redactedUrl } = redactUrl(url)
	const startMs = Date.now()

	try {
		const response = await fetch(url, init)
		const durationMs = Date.now() - startMs

		logger.info("Outgoing HTTP request", {
			log_type: "outgoing_http",
			area: options.area,
			method,
			host,
			path,
			url: redactedUrl,
			status: response.status,
			ok: response.ok,
			durationMs,
		})

		return response
	} catch (error) {
		const durationMs = Date.now() - startMs

		logger.error("Outgoing HTTP request failed", {
			log_type: "outgoing_http",
			area: options.area,
			method,
			host,
			path,
			url: redactedUrl,
			durationMs,
			error: error instanceof Error ? error.message : String(error),
		})

		throw error
	}
}
