import { randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import pg from "pg"
import { inject } from "vitest"
import * as schema from "../../schema/index"

let adminPool: pg.Pool
let pool: pg.Pool
let testDb: ReturnType<typeof drizzle<typeof schema>>
let currentDbName: string

export async function setupTestDatabase() {
	const host = inject("dbHost")
	const port = inject("dbPort")
	const user = inject("dbUser")
	const password = inject("dbPassword")

	if (!host || !port || !user || !password) {
		throw new Error(
			"Missing database connection info from globalSetup. Ensure globalSetup is configured in vitest.integration.config.ts.",
		)
	}

	currentDbName = `kiss_test_${randomUUID().replace(/-/g, "")}`

	// Admin pool connects to the default database (same name as user)
	adminPool = new pg.Pool({ host, port, user, password, database: user, max: 2 })
	adminPool.on("error", () => {})

	// Clone the template — O(1) vs drizzle-kit push O(migrations)
	await adminPool.query(`CREATE DATABASE "${currentDbName}" TEMPLATE kiss_template`)

	const connectionUri = `postgresql://${user}:${password}@${host}:${port}/${currentDbName}`
	pool = new pg.Pool({ connectionString: connectionUri })
	pool.on("error", () => {})
	testDb = drizzle(pool, { schema })

	return { db: testDb, pool, connectionUri }
}

export async function teardownTestDatabase() {
	await pool?.end()
	if (currentDbName && adminPool) {
		await adminPool.query(`DROP DATABASE IF EXISTS "${currentDbName}" WITH (FORCE)`)
	}
	await adminPool?.end()
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
	if (tables.length === 0) throw new Error("truncateWithRetry: tables array must not be empty")
	const db = getTestDb()
	const quoted = tables.map((t) => `"${t.replace(/"/g, '""')}"`)
	const sql = `TRUNCATE ${quoted.join(", ")} CASCADE`
	const retries = Number.isFinite(maxRetries) ? Math.max(1, Math.floor(maxRetries)) : 3
	for (let attempt = 1; attempt <= retries; attempt++) {
		try {
			await db.execute(/* sql */ sql)
			return
		} catch (err: unknown) {
			const pgErr = err as { code?: string; cause?: { code?: string } }
			const code = pgErr.code ?? pgErr.cause?.code
			if (code === "40P01" && attempt < retries) {
				await new Promise((r) => setTimeout(r, 50 * 2 ** (attempt - 1)))
				continue
			}
			throw err
		}
	}
}

/**
 * Setter inn en seksjon direkte i databasen uten å gå via createSection-forretningslogikken.
 * Brukes i testoppsett der man trenger en seksjon uten å teste selve opprettingslogikken.
 * Slug-algoritmen matcher generateSlug i sections.server.ts.
 */
export async function insertTestSection(
	name: string,
	description: string | null = null,
	createdBy = "test",
): Promise<{ id: string; name: string; slug: string }> {
	const db = getTestDb()
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9\s-æøå]/g, "")
		.replace(/æ/g, "ae")
		.replace(/ø/g, "o")
		.replace(/å/g, "a")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
	const r = await db.execute(
		sql`INSERT INTO sections (name, slug, description, created_by, updated_by) VALUES (${name}, ${slug}, ${description}, ${createdBy}, ${createdBy}) RETURNING id, name, slug`,
	)
	return r.rows[0] as { id: string; name: string; slug: string }
}
