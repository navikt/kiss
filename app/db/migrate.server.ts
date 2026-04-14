import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { sql } from "drizzle-orm"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { logger } from "~/lib/logger.server"
import { db } from "./connection.server"

const MIGRATIONS_FOLDER = "./drizzle"

export async function runMigrations() {
	logger.info("Running database migrations...")
	try {
		await seedTrackingForPushedDatabase()
		await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
		logger.info("Database migrations completed successfully")
	} catch (error) {
		logger.error("Database migration failed", error)
		throw error
	}
}

/**
 * Handles transition from `db:push` to `migrate()`.
 *
 * If the database was set up with `db:push`, tables exist but
 * there is no migration tracking. This seeds the drizzle.__drizzle_migrations
 * table so `migrate()` skips already-applied migrations.
 *
 * Only seeds migrations whose CREATE TABLE targets actually exist in the
 * database, so new table migrations are left for `migrate()` to execute.
 */
async function seedTrackingForPushedDatabase() {
	const [{ exists: trackingExists }] = (
		await db.execute<{ exists: boolean }>(sql`
		SELECT EXISTS (
			SELECT FROM information_schema.tables
			WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
		) AS exists
	`)
	).rows

	if (trackingExists) return

	const [{ exists: tablesExist }] = (
		await db.execute<{ exists: boolean }>(sql`
		SELECT EXISTS (
			SELECT FROM information_schema.tables
			WHERE table_schema = 'public' AND table_name = 'sections'
		) AS exists
	`)
	).rows

	if (!tablesExist) return

	logger.info("Detected database created with db:push — seeding migration tracking...")

	await db.execute(sql`CREATE SCHEMA IF NOT EXISTS drizzle`)
	await db.execute(sql`
		CREATE TABLE IF NOT EXISTS drizzle."__drizzle_migrations" (
			id SERIAL PRIMARY KEY,
			hash text NOT NULL,
			created_at bigint
		)
	`)

	const existingTables = await getExistingPublicTables()

	const journalPath = path.join(MIGRATIONS_FOLDER, "meta", "_journal.json")
	const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8")) as {
		entries: { idx: number; when: number; tag: string }[]
	}

	let seeded = 0
	for (const entry of journal.entries) {
		const sqlContent = fs.readFileSync(path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`)).toString()

		const newTable = extractCreateTableName(sqlContent)
		if (newTable && !existingTables.has(newTable)) {
			logger.info(`Skipping migration ${entry.tag} — table "${newTable}" does not exist yet`)
			continue
		}

		const hash = crypto.createHash("sha256").update(sqlContent).digest("hex")
		await db.execute(sql`
			INSERT INTO drizzle."__drizzle_migrations" (hash, created_at)
			VALUES (${hash}, ${entry.when})
		`)
		seeded++
	}

	logger.info(`Seeded ${seeded} of ${journal.entries.length} migration(s) into tracking table`)
}

async function getExistingPublicTables(): Promise<Set<string>> {
	const result = await db.execute<{ tablename: string }>(sql`
		SELECT tablename FROM pg_tables WHERE schemaname = 'public'
	`)
	return new Set(result.rows.map((r) => r.tablename))
}

function extractCreateTableName(sqlContent: string): string | null {
	const match = sqlContent.match(/CREATE TABLE[^"]*"(\w+)"/)
	return match?.[1] ?? null
}
