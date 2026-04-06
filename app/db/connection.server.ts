import { readFileSync } from "node:fs"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import * as schema from "./schema/index"

// Nais default env var prefix: NAIS_DATABASE_{APP}_{DB} → NAIS_DATABASE_KISS_KISS
const NAIS_PREFIX = "NAIS_DATABASE_KISS_KISS"

function buildConnectionConfig() {
	// 1. Try envVarPrefix (DB_*) from nais.yaml
	const dbHost = process.env.DB_HOST
	if (dbHost && process.env.DB_DATABASE && process.env.DB_USERNAME && process.env.DB_PASSWORD) {
		console.log(
			`Database config: Using DB_* variables (host=${dbHost}, port=${process.env.DB_PORT ?? 5432}, db=${process.env.DB_DATABASE}, ssl=${process.env.DB_SSLROOTCERT ? "yes" : "no"})`,
		)
		return buildSslConfig(
			dbHost,
			process.env.DB_PORT,
			process.env.DB_DATABASE!,
			process.env.DB_USERNAME!,
			process.env.DB_PASSWORD!,
			process.env.DB_SSLROOTCERT,
			process.env.DB_SSLCERT,
			process.env.DB_SSLKEY,
		)
	}

	// 2. Try Nais default env vars (NAIS_DATABASE_KISS_KISS_*)
	const naisUrl = process.env[`${NAIS_PREFIX}_URL`]
	if (naisUrl) {
		console.log(`Database config: Using ${NAIS_PREFIX}_URL`)
		return { connectionString: naisUrl }
	}

	const naisHost = process.env[`${NAIS_PREFIX}_HOST`]
	if (naisHost) {
		console.log(
			`Database config: Using ${NAIS_PREFIX}_* variables (host=${naisHost}, port=${process.env[`${NAIS_PREFIX}_PORT`] ?? 5432})`,
		)
		return buildSslConfig(
			naisHost,
			process.env[`${NAIS_PREFIX}_PORT`],
			process.env[`${NAIS_PREFIX}_DATABASE`]!,
			process.env[`${NAIS_PREFIX}_USERNAME`]!,
			process.env[`${NAIS_PREFIX}_PASSWORD`]!,
			process.env[`${NAIS_PREFIX}_SSLROOTCERT`],
			process.env[`${NAIS_PREFIX}_SSLCERT`],
			process.env[`${NAIS_PREFIX}_SSLKEY`],
		)
	}

	// 3. Try DATABASE_URL (generic fallback)
	const connectionString = process.env.DATABASE_URL
	if (connectionString) {
		console.log("Database config: Using DATABASE_URL")
		return { connectionString }
	}

	// 4. Local development default
	console.log("Database config: No Nais or DATABASE_URL vars found, using localhost default")
	const dbEnvVars = Object.keys(process.env).filter(
		(k) => k.startsWith("DB_") || k.startsWith("DATABASE") || k.startsWith("NAIS_DATABASE"),
	)
	if (dbEnvVars.length > 0) {
		console.log(`Database-related env vars found: ${dbEnvVars.join(", ")}`)
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

const pool = new Pool({
	...buildConnectionConfig(),
	max: 10,
	idleTimeoutMillis: 30000,
	connectionTimeoutMillis: 2000,
})

pool.on("error", (err) => {
	console.error("Unexpected error on idle database client", err)
})

export const db = drizzle(pool, { schema })
export { pool }
