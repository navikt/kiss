import { readFileSync } from "node:fs"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { data } from "react-router"
import { DB_ERROR_TYPES, type DomainErrorData, ERROR_CATEGORIES } from "~/lib/db-error-types"
import { logger } from "~/lib/logger.server"
import * as schema from "./schema/index"

// Nais default env var prefix: NAIS_DATABASE_{APP}_{DB} → NAIS_DATABASE_KISS_KISS
const NAIS_PREFIX = "NAIS_DATABASE_KISS_KISS"

function buildConnectionConfig() {
	// 1. Try envVarPrefix (DB_*) from nais.yaml
	const dbHost = process.env.DB_HOST
	const dbDatabase = process.env.DB_DATABASE
	const dbUsername = process.env.DB_USERNAME
	const dbPassword = process.env.DB_PASSWORD
	if (dbHost && dbDatabase && dbUsername && dbPassword) {
		logger.info(
			`Database config: Using DB_* variables (host=${dbHost}, port=${process.env.DB_PORT ?? 5432}, db=${dbDatabase}, ssl=${process.env.DB_SSLROOTCERT ? "yes" : "no"})`,
		)
		return buildSslConfig(
			dbHost,
			process.env.DB_PORT,
			dbDatabase,
			dbUsername,
			dbPassword,
			process.env.DB_SSLROOTCERT,
			process.env.DB_SSLCERT,
			process.env.DB_SSLKEY,
		)
	}

	// 2. Try Nais default env vars (NAIS_DATABASE_KISS_KISS_*)
	const naisHost = process.env[`${NAIS_PREFIX}_HOST`]
	const naisDatabase = process.env[`${NAIS_PREFIX}_DATABASE`]
	const naisUsername = process.env[`${NAIS_PREFIX}_USERNAME`]
	const naisPassword = process.env[`${NAIS_PREFIX}_PASSWORD`]
	if (naisHost && naisDatabase && naisUsername && naisPassword) {
		logger.info(
			`Database config: Using ${NAIS_PREFIX}_* variables (host=${naisHost}, port=${process.env[`${NAIS_PREFIX}_PORT`] ?? 5432}, db=${naisDatabase}, ssl=${process.env[`${NAIS_PREFIX}_SSLROOTCERT`] ? "yes" : "no"})`,
		)
		return buildSslConfig(
			naisHost,
			process.env[`${NAIS_PREFIX}_PORT`],
			naisDatabase,
			naisUsername,
			naisPassword,
			process.env[`${NAIS_PREFIX}_SSLROOTCERT`],
			process.env[`${NAIS_PREFIX}_SSLCERT`],
			process.env[`${NAIS_PREFIX}_SSLKEY`],
		)
	}

	// 3. Try DATABASE_URL (generic fallback)
	const connectionString = process.env.DATABASE_URL
	if (connectionString) {
		logger.info("Database config: Using DATABASE_URL")
		return { connectionString }
	}

	// 4. Local development default
	logger.info("Database config: No Nais or DATABASE_URL vars found, using localhost default")
	const dbEnvVars = Object.keys(process.env).filter(
		(k) => k.startsWith("DB_") || k.startsWith("DATABASE") || k.startsWith("NAIS_DATABASE"),
	)
	if (dbEnvVars.length > 0) {
		logger.info(`Database-related env vars found: ${dbEnvVars.join(", ")}`)
	}
	return { connectionString: "postgresql://kiss:kiss@localhost:5432/kiss" }
}

function buildSslConfig(
	host: string,
	port: string | undefined,
	database: string,
	user: string,
	password: string,
	sslRootCert: string | undefined,
	sslCert: string | undefined,
	sslKey: string | undefined,
) {
	const ssl: { rejectUnauthorized: boolean; ca?: string; cert?: string; key?: string } = {
		rejectUnauthorized: false,
	}

	if (sslRootCert) ssl.ca = readFileSync(sslRootCert, "utf-8")
	if (sslCert) ssl.cert = readFileSync(sslCert, "utf-8")
	if (sslKey) ssl.key = readFileSync(sslKey, "utf-8")

	return {
		host,
		port: port ? Number.parseInt(port, 10) : 5432,
		database,
		user,
		password,
		ssl,
	}
}

// Re-export shared error types so existing server-side imports continue to work.
// The actual definitions live in ~/lib/db-error-types (client-safe, no server deps).
export type { DbErrorType, DomainErrorData, ErrorCategory } from "~/lib/db-error-types"
export { DB_ERROR_TYPES, ERROR_CATEGORIES } from "~/lib/db-error-types"

const pool = new Pool({
	...buildConnectionConfig(),
	max: 5,
	min: 2,
	idleTimeoutMillis: 30000,
	connectionTimeoutMillis: 10000,
})

pool.on("error", (err) => {
	logger.error("Unexpected error on idle database client", err)
})

/**
 * Wrap pool.connect() to translate infrastructure-specific pg errors
 * into structured domain errors (Response with DomainErrorData).
 *
 * This isolates PostgreSQL-specific error message matching to the data access layer.
 * The UI layer only needs to check for error category (TRANSIENT/PERMANENT/etc.).
 *
 * Note: Only supports Promise-based usage (no callback overload). KISS codebase
 * exclusively uses async/await with pool.connect().
 */
const _originalConnect = pool.connect.bind(pool)
pool.connect = async function wrappedConnect() {
	try {
		return await _originalConnect()
	} catch (error) {
		if (error instanceof Error) {
			// Map pg-specific error messages to domain errors
			if (error.message.includes("timeout exceeded when trying to connect")) {
				logger.warn("[pool] Connection timeout — pool exhausted", error)
				throw data(
					{
						category: ERROR_CATEGORIES.TRANSIENT,
						errorType: DB_ERROR_TYPES.POOL_TIMEOUT,
						title: "Midlertidig overbelastet",
						userMessage: "Databasen er midlertidig overbelastet. Prøv igjen om noen sekunder.",
					} satisfies DomainErrorData,
					{ status: 503 },
				)
			}
			if (error.message.includes("remaining connection slots are reserved")) {
				logger.warn("[pool] Connection slots exhausted", error)
				throw data(
					{
						category: ERROR_CATEGORIES.TRANSIENT,
						errorType: DB_ERROR_TYPES.POOL_EXHAUSTED,
						title: "Midlertidig overbelastet",
						userMessage: "Databasen er midlertidig overbelastet. Prøv igjen om noen sekunder.",
					} satisfies DomainErrorData,
					{ status: 503 },
				)
			}
		}
		// Unknown error — re-throw as-is
		throw error
	}
} as typeof _originalConnect

/** Log pool stats for debugging connection exhaustion. */
export function logPoolStats(context?: string) {
	const prefix = context ? `[pool:${context}]` : "[pool]"
	logger.info(`${prefix} total=${pool.totalCount} idle=${pool.idleCount} waiting=${pool.waitingCount}`)
}

export const db = drizzle(pool, { schema })
export { pool }
