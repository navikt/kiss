import { readFileSync } from "node:fs"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import * as schema from "./schema/index"

function buildConnectionConfig() {
	const dbHost = process.env.DB_HOST
	const dbPort = process.env.DB_PORT
	const dbDatabase = process.env.DB_DATABASE
	const dbUsername = process.env.DB_USERNAME
	const dbPassword = process.env.DB_PASSWORD
	const dbSslCert = process.env.DB_SSLCERT
	const dbSslKey = process.env.DB_SSLKEY
	const dbSslRootCert = process.env.DB_SSLROOTCERT

	if (dbHost && dbDatabase && dbUsername && dbPassword) {
		console.log(
			`Database config: Using Nais DB_* variables (host=${dbHost}, port=${dbPort ?? 5432}, db=${dbDatabase}, ssl=${dbSslRootCert ? "yes" : "no"})`,
		)

		const sslConfig: {
			rejectUnauthorized: boolean
			ca?: string
			cert?: string
			key?: string
		} = { rejectUnauthorized: false }

		if (dbSslRootCert) sslConfig.ca = readFileSync(dbSslRootCert, "utf-8")
		if (dbSslCert) sslConfig.cert = readFileSync(dbSslCert, "utf-8")
		if (dbSslKey) sslConfig.key = readFileSync(dbSslKey, "utf-8")

		return {
			host: dbHost,
			port: dbPort ? Number.parseInt(dbPort, 10) : 5432,
			database: dbDatabase,
			user: dbUsername,
			password: dbPassword,
			ssl: sslConfig,
		}
	}

	const connectionString = process.env.DATABASE_URL
	if (connectionString) {
		console.log("Database config: Using DATABASE_URL")
		return { connectionString }
	}

	console.log("Database config: No DB_* or DATABASE_URL found, using localhost default")
	const dbEnvVars = Object.keys(process.env).filter((k) => k.startsWith("DB_") || k.startsWith("DATABASE"))
	if (dbEnvVars.length > 0) {
		console.log(`Database-related env vars found: ${dbEnvVars.join(", ")}`)
	}
	return { connectionString: "postgresql://kiss:kiss@localhost:5432/kiss" }
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
