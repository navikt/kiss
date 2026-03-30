import { execSync } from "node:child_process"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { drizzle } from "drizzle-orm/node-postgres"
import pg from "pg"
import * as schema from "../../schema/index"

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let testDb: ReturnType<typeof drizzle<typeof schema>>

export async function setupTestDatabase() {
	container = await new PostgreSqlContainer("postgres:17-alpine")
		.withDatabase("kiss_test")
		.withUsername("test")
		.withPassword("test")
		.start()

	const connectionUri = container.getConnectionUri()

	// Push schema using drizzle-kit
	execSync(`DATABASE_URL="${connectionUri}" npx drizzle-kit push --force`, {
		cwd: process.cwd(),
		stdio: "pipe",
	})

	pool = new pg.Pool({ connectionString: connectionUri })
	testDb = drizzle(pool, { schema })

	return { db: testDb, pool, connectionUri }
}

export async function teardownTestDatabase() {
	await pool?.end()
	await container?.stop()
}

export function getTestDb() {
	return testDb
}

export function getTestPool() {
	return pool
}
