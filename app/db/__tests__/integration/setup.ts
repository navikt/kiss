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
	// Prevent unhandled error events when container stops with idle connections
	pool.on("error", () => {})
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

/**
 * Executes a TRUNCATE with retry on deadlock (error code 40P01).
 * TRUNCATE acquires AccessExclusiveLock which can deadlock with concurrent
 * read queries from the same test's async operations.
 */
export async function truncateWithRetry(tables: string[], maxRetries = 3): Promise<void> {
	const sql = `TRUNCATE ${tables.join(", ")} CASCADE`
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			await testDb.execute(/* sql */ sql)
			return
		} catch (err: unknown) {
			const pgErr = err as { code?: string; cause?: { code?: string } }
			const code = pgErr.code ?? pgErr.cause?.code
			if (code === "40P01" && attempt < maxRetries) {
				await new Promise((r) => setTimeout(r, 50 * attempt))
				continue
			}
			throw err
		}
	}
}
