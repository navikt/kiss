import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { sql } from "drizzle-orm"
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { Client } from "pg"
import { logger } from "~/lib/logger.server"
import { buildConnectionConfig } from "./connection.server"

const MIGRATIONS_FOLDER = "./drizzle"

// Advisory lock key for migrations (stable hash of "drizzle-migrations")
const MIGRATION_LOCK_KEY = 728371946

/**
 * Critical tables that must exist after migrations complete.
 * Used by verifyMigrationHealth() to catch missing migrations.
 */
const CRITICAL_TABLES = [
	"sections",
	"monitored_applications",
	"framework_controls",
	"framework_domains",
	"framework_risks",
	"routines",
	"routine_reviews",
	"screening_questions",
	"screening_answers",
	"users",
	"audit_log",
	"application_controls",
	"application_control_history",
] as const

export async function runMigrations() {
	const startTime = Date.now()
	logger.info("[migrations] Starting database migration process")

	// Use a dedicated Client (not from the shared pool) for ALL migration work.
	// This prevents migrations from competing with incoming requests for pool
	// connections, which caused handleRequest to block for 10+ seconds while
	// db.execute() waited for an available pool connection during startup.
	// connectionTimeoutMillis matches the shared pool setting (10s).
	const client = new Client({ ...buildConnectionConfig(), connectionTimeoutMillis: 10000 })
	await client.connect()

	// Build a dedicated Drizzle instance from the same client so every query
	// inside runMigrations() (logTrackingState, seedTracking, migrate(), etc.)
	// goes through the dedicated connection — the shared pool is never touched.
	const migrationDb = drizzle(client) as NodePgDatabase
	try {
		// Acquire blocking advisory lock — waits if another pod is migrating
		logger.info(`[migrations] Acquiring advisory lock (key=${MIGRATION_LOCK_KEY})...`)
		await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY])
		logger.info("[migrations] Advisory lock acquired")

		try {
			await logTrackingState("before", migrationDb)
			await seedTrackingForPushedDatabase(migrationDb)
			await logPendingMigrations(migrationDb)

			logger.info("[migrations] Running drizzle migrate()...")
			await migrate(migrationDb, { migrationsFolder: MIGRATIONS_FOLDER })

			await logTrackingState("after", migrationDb)
			await verifyMigrationHealth(migrationDb)

			const elapsed = Date.now() - startTime
			logger.info(`[migrations] Migration process completed successfully in ${elapsed}ms`)
		} finally {
			await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY])
			logger.info("[migrations] Advisory lock released")
		}
	} catch (error) {
		const elapsed = Date.now() - startTime
		logger.error(`[migrations] Migration failed after ${elapsed}ms`, error)
		throw error
	} finally {
		// pg.Client uses end() instead of pool.release()
		await client.end()
	}
}

/**
 * Log the current state of the migration tracking table.
 */
async function logTrackingState(phase: "before" | "after", migrationDb: NodePgDatabase) {
	try {
		const [{ exists }] = (
			await migrationDb.execute<{ exists: boolean }>(sql`
			SELECT EXISTS (
				SELECT FROM information_schema.tables
				WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
			) AS exists
		`)
		).rows

		if (!exists) {
			logger.info(`[migrations] [${phase}] Tracking table does not exist yet`)
			return
		}

		const [{ count }] = (
			await migrationDb.execute<{ count: string }>(sql`
			SELECT COUNT(*)::text AS count FROM drizzle."__drizzle_migrations"
		`)
		).rows

		logger.info(`[migrations] [${phase}] Tracking table exists with ${count} applied migration(s)`)
	} catch (error) {
		logger.warn(`[migrations] [${phase}] Could not read tracking state`, { details: String(error) })
	}
}

/**
 * Log which migrations from the journal are not yet in the tracking table.
 */
async function logPendingMigrations(migrationDb: NodePgDatabase) {
	try {
		const [{ exists }] = (
			await migrationDb.execute<{ exists: boolean }>(sql`
			SELECT EXISTS (
				SELECT FROM information_schema.tables
				WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
			) AS exists
		`)
		).rows

		if (!exists) {
			logger.info("[migrations] No tracking table — all migrations are pending")
			return
		}

		const tracked = (
			await migrationDb.execute<{ hash: string }>(sql`
			SELECT hash FROM drizzle."__drizzle_migrations"
		`)
		).rows
		const trackedHashes = new Set(tracked.map((r) => r.hash))

		const journal = readJournal()
		const pending: string[] = []
		for (const entry of journal.entries) {
			const sqlContent = fs.readFileSync(path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`)).toString()
			const hash = crypto.createHash("sha256").update(sqlContent).digest("hex")
			if (!trackedHashes.has(hash)) {
				pending.push(entry.tag)
			}
		}

		if (pending.length === 0) {
			logger.info("[migrations] No pending migrations")
		} else {
			logger.info(`[migrations] ${pending.length} pending migration(s): ${pending.join(", ")}`)
		}
	} catch (error) {
		logger.warn("[migrations] Could not determine pending migrations", { details: String(error) })
	}
}

/**
 * Verify that all critical tables exist after migration.
 * Throws if any are missing — this catches migration failures that were silently swallowed.
 */
export async function verifyMigrationHealth(migrationDb?: NodePgDatabase) {
	const executor = migrationDb ?? (await import("./connection.server")).db
	const result = await executor.execute<{ tablename: string }>(sql`
		SELECT tablename FROM pg_tables WHERE schemaname = 'public'
	`)
	const existingTables = new Set(result.rows.map((r) => r.tablename))

	logger.info(`[migrations] Post-migration: ${existingTables.size} public table(s) in database`)

	const missing = CRITICAL_TABLES.filter((t) => !existingTables.has(t))
	if (missing.length > 0) {
		const error = new Error(`[migrations] CRITICAL: Missing tables after migration: ${missing.join(", ")}`)
		logger.error(error.message)
		throw error
	}

	logger.info(`[migrations] Health check passed — all ${CRITICAL_TABLES.length} critical tables present`)
}

// ─── Seed tracking for db:push transition ───────────────────────────────

/**
 * Handles transition from `db:push` to `migrate()`.
 *
 * If the database was set up with `db:push`, tables exist but
 * there is no migration tracking. This seeds the drizzle.__drizzle_migrations
 * table so `migrate()` skips already-applied migrations.
 *
 * For each migration in the journal:
 * - CREATE TABLE migrations: skip if ANY target table doesn't exist yet
 * - ALTER TABLE ADD COLUMN: skip if the column doesn't exist yet
 * - All other migrations: seed as applied if target tables exist
 */
async function seedTrackingForPushedDatabase(migrationDb: NodePgDatabase) {
	const [{ exists: trackingExists }] = (
		await migrationDb.execute<{ exists: boolean }>(sql`
		SELECT EXISTS (
			SELECT FROM information_schema.tables
			WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
		) AS exists
	`)
	).rows

	if (trackingExists) {
		logger.info("[migrations] Tracking table already exists — skipping seed")
		return
	}

	const [{ exists: tablesExist }] = (
		await migrationDb.execute<{ exists: boolean }>(sql`
		SELECT EXISTS (
			SELECT FROM information_schema.tables
			WHERE table_schema = 'public' AND table_name = 'sections'
		) AS exists
	`)
	).rows

	if (!tablesExist) {
		logger.info("[migrations] Fresh database (no public tables) — skipping seed")
		return
	}

	logger.info("[migrations] Detected database created with db:push — seeding migration tracking...")

	await migrationDb.execute(sql`CREATE SCHEMA IF NOT EXISTS drizzle`)
	await migrationDb.execute(sql`
		CREATE TABLE IF NOT EXISTS drizzle."__drizzle_migrations" (
			id SERIAL PRIMARY KEY,
			hash text NOT NULL,
			created_at bigint
		)
	`)

	const existingTables = await getExistingPublicTables(migrationDb)
	const existingColumns = await getExistingColumns(migrationDb)

	const journal = readJournal()

	// Pre-process: find all tables/columns that are dropped by any migration.
	// These may have been created in earlier migrations but removed later,
	// so the CREATE/ADD should still be seeded as applied.
	const droppedTables = new Set<string>()
	const droppedColumns = new Set<string>()
	for (const entry of journal.entries) {
		const content = fs.readFileSync(path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`)).toString()
		for (const t of extractDropTableNames(content)) droppedTables.add(t)
		for (const c of extractDropColumns(content)) droppedColumns.add(c)
	}

	let seeded = 0
	let skipped = 0
	let stopSeeding = false
	for (const entry of journal.entries) {
		const sqlContent = fs.readFileSync(path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`)).toString()

		// Drizzle uses a timestamp watermark: it only applies migrations AFTER
		// the last tracked one. If we skip migration N but seed N+1, Drizzle will
		// never go back to apply N. So once we skip, we must stop seeding entirely.
		if (stopSeeding) {
			logger.info(`[migrations] Seed SKIP ${entry.tag} — previous migration was skipped (watermark)`)
			skipped++
			continue
		}

		const skipReason = shouldSkipMigration(sqlContent, existingTables, existingColumns, droppedTables, droppedColumns)
		if (skipReason) {
			logger.info(`[migrations] Seed SKIP ${entry.tag} — ${skipReason}`)
			skipped++
			stopSeeding = true
			continue
		}

		const hash = crypto.createHash("sha256").update(sqlContent).digest("hex")
		await migrationDb.execute(sql`
			INSERT INTO drizzle."__drizzle_migrations" (hash, created_at)
			VALUES (${hash}, ${entry.when})
		`)
		logger.info(`[migrations] Seed APPLIED ${entry.tag}`)
		seeded++
	}

	logger.info(`[migrations] Seeded ${seeded}, skipped ${skipped} of ${journal.entries.length} migration(s)`)
}

// ─── Helpers ────────────────────────────────────────────────────────────

function readJournal(): { entries: { idx: number; when: number; tag: string }[] } {
	const journalPath = path.join(MIGRATIONS_FOLDER, "meta", "_journal.json")
	return JSON.parse(fs.readFileSync(journalPath, "utf-8"))
}

async function getExistingPublicTables(migrationDb: NodePgDatabase): Promise<Set<string>> {
	const result = await migrationDb.execute<{ tablename: string }>(sql`
		SELECT tablename FROM pg_tables WHERE schemaname = 'public'
	`)
	return new Set(result.rows.map((r) => r.tablename))
}

async function getExistingColumns(migrationDb: NodePgDatabase): Promise<Set<string>> {
	const result = await migrationDb.execute<{ table_name: string; column_name: string }>(sql`
		SELECT table_name, column_name FROM information_schema.columns
		WHERE table_schema = 'public'
	`)
	return new Set(result.rows.map((r) => `${r.table_name}.${r.column_name}`))
}

/**
 * Determine if a migration should be SKIPPED during seed tracking
 * (i.e. left for migrate() to execute because it targets new structure).
 *
 * Returns a reason string if skip, or null if should be seeded as applied.
 *
 * Handles the case where a migration creates a table/column that is later
 * dropped by a subsequent migration — those are still seeded as applied.
 */
function shouldSkipMigration(
	sqlContent: string,
	existingTables: Set<string>,
	existingColumns: Set<string>,
	droppedTables: Set<string>,
	droppedColumns: Set<string>,
): string | null {
	// Check ALL CREATE TABLE statements — skip if ANY target table doesn't exist
	// UNLESS the table was dropped by a later migration (create+drop = both applied)
	const createTableNames = extractAllCreateTableNames(sqlContent)
	for (const tableName of createTableNames) {
		if (!existingTables.has(tableName) && !droppedTables.has(tableName)) {
			return `table "${tableName}" does not exist`
		}
	}

	// Check ALTER TABLE ADD COLUMN — skip if the column doesn't exist
	// UNLESS the column was dropped by a later migration
	// OR the table itself was dropped (all columns are implicitly dropped)
	const addedColumns = extractAlterTableAddColumns(sqlContent)
	for (const { table, column } of addedColumns) {
		if (!existingTables.has(table) && !droppedTables.has(table)) {
			return `table "${table}" does not exist`
		}
		if (droppedTables.has(table)) continue
		const colKey = `${table}.${column}`
		if (!existingColumns.has(colKey) && !droppedColumns.has(colKey)) {
			return `column "${colKey}" does not exist`
		}
	}

	return null
}

/** Extract all table names from CREATE TABLE statements. */
function extractAllCreateTableNames(sqlContent: string): string[] {
	const names: string[] = []
	const regex = /CREATE TABLE[^"]*"(\w+)"/g
	let match = regex.exec(sqlContent)
	while (match) {
		names.push(match[1])
		match = regex.exec(sqlContent)
	}
	return names
}

/** Extract table.column pairs from ALTER TABLE ... ADD COLUMN statements. */
function extractAlterTableAddColumns(sqlContent: string): Array<{ table: string; column: string }> {
	const results: Array<{ table: string; column: string }> = []
	const regex = /ALTER TABLE\s+"(\w+)"\s+ADD COLUMN\s+(?:IF NOT EXISTS\s+)?"(\w+)"/g
	let match = regex.exec(sqlContent)
	while (match) {
		results.push({ table: match[1], column: match[2] })
		match = regex.exec(sqlContent)
	}
	return results
}

/** Extract table names from DROP TABLE statements. */
function extractDropTableNames(sqlContent: string): string[] {
	const names: string[] = []
	const regex = /DROP TABLE[^"]*"(\w+)"/g
	let match = regex.exec(sqlContent)
	while (match) {
		names.push(match[1])
		match = regex.exec(sqlContent)
	}
	return names
}

/** Extract table.column keys from ALTER TABLE ... DROP COLUMN statements. */
function extractDropColumns(sqlContent: string): string[] {
	const results: string[] = []
	const regex = /ALTER TABLE\s+"(\w+)"\s+DROP COLUMN[^"]*"(\w+)"/g
	let match = regex.exec(sqlContent)
	while (match) {
		results.push(`${match[1]}.${match[2]}`)
		match = regex.exec(sqlContent)
	}
	return results
}

/** Extract table.constraint pairs from ALTER TABLE ... ADD CONSTRAINT statements. */
function extractAddConstraints(sqlContent: string): Array<{ table: string; constraint: string }> {
	const results: Array<{ table: string; constraint: string }> = []
	const regex = /ALTER TABLE\s+"(\w+)"\s+ADD CONSTRAINT\s+"(\w+)"/g
	let match = regex.exec(sqlContent)
	while (match) {
		results.push({ table: match[1], constraint: match[2] })
		match = regex.exec(sqlContent)
	}
	return results
}

/** Extract index names from CREATE [UNIQUE] INDEX statements. */
function extractCreateIndexNames(sqlContent: string): string[] {
	// Strip SQL line comments først så ord som "CREATE INDEX" i kommentarer
	// ikke gir falske treff. NB: forutsetter at migrasjonene ikke inneholder
	// `--` inni string-literaler (vi har ingen slike i dag, og hvis det skulle
	// bli aktuelt må denne stripper-en gjøres mer presis).
	const stripped = sqlContent.replace(/--.*$/gm, "")
	const names: string[] = []
	const regex = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/gi
	let match = regex.exec(stripped)
	while (match) {
		names.push(match[1] ?? match[2])
		match = regex.exec(stripped)
	}
	return names
}

// Export internals for testing
export const _testing = {
	shouldSkipMigration,
	extractAllCreateTableNames,
	extractAlterTableAddColumns,
	extractDropTableNames,
	extractDropColumns,
	extractCreateIndexNames,
	extractAddConstraints,
	CRITICAL_TABLES,
	MIGRATION_LOCK_KEY,
}
