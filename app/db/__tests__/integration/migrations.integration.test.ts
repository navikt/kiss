import fs from "node:fs"
import path from "node:path"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import pg from "pg"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "../../schema/index"

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let testDb: ReturnType<typeof drizzle<typeof schema>>

vi.mock("~/db/connection.server", () => ({
	get db() {
		return testDb
	},
	get pool() {
		return pool
	},
}))

const { runMigrations, verifyMigrationHealth, _testing } = await import("~/db/migrate.server")

async function getTableNames(): Promise<string[]> {
	const result = await testDb.execute<{ table_name: string }>(sql`
		SELECT table_name FROM information_schema.tables
		WHERE table_schema = 'public'
		ORDER BY table_name
	`)
	return result.rows.map((r) => r.table_name)
}

async function getTrackingCount(): Promise<number> {
	try {
		const result = await testDb.execute<{ count: string }>(sql`
			SELECT COUNT(*)::text AS count FROM drizzle."__drizzle_migrations"
		`)
		return Number(result.rows[0].count)
	} catch {
		return -1
	}
}

async function trackingTableExists(): Promise<boolean> {
	const result = await testDb.execute<{ exists: boolean }>(sql`
		SELECT EXISTS (
			SELECT FROM information_schema.tables
			WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
		) AS exists
	`)
	return result.rows[0].exists
}

async function dropAllPublicTables() {
	await testDb.execute(sql`
		DO $$ DECLARE r RECORD;
		BEGIN
			FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
				EXECUTE 'DROP TABLE IF EXISTS "' || r.tablename || '" CASCADE';
			END LOOP;
		END $$
	`)
	await testDb.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`)
}

// ─── Test suite ─────────────────────────────────────────────────────────

describe("Database migrations", () => {
	beforeAll(async () => {
		container = await new PostgreSqlContainer("postgres:17-alpine")
			.withDatabase("kiss_migration_test")
			.withUsername("test")
			.withPassword("test")
			.start()
	})

	afterAll(async () => {
		try {
			await pool?.end()
		} catch {
			// pool may already be ended by afterEach
		}
		await container?.stop()
	})

	beforeEach(async () => {
		pool = new pg.Pool({ connectionString: container.getConnectionUri() })
		testDb = drizzle(pool, { schema })
		await dropAllPublicTables()
	})

	afterEach(async () => {
		await pool?.end()
	})

	// ── 1. Fresh empty database ─────────────────────────────────────────

	describe("fresh empty database", () => {
		it("should apply all migrations and create all tables", async () => {
			await runMigrations()

			const tableNames = await getTableNames()

			const expectedTables = [
				"application_auth_integrations",
				"application_control_history",
				"application_controls",
				"application_environments",
				"application_group_assessments",
				"application_manual_groups",
				"application_persistence",
				"application_team_mappings",
				"audit_log",
				"bucket_objects",
				"clusters",
				"compliance_assessment_history",
				"compliance_assessments",
				"control_technology_elements",
				"dev_team_nais_team_mappings",
				"dev_teams",
				"documents",
				"framework_controls",
				"framework_domains",
				"framework_field_history",
				"framework_risk_control_mappings",
				"framework_risks",
				"framework_versions",
				"monitored_applications",
				"nais_teams",
				"reports",
				"routine_controls",
				"routine_persistence_links",
				"routine_review_activities",
				"routine_review_activity_entra_changes",
				"routine_review_attachments",
				"routine_review_links",
				"routine_review_participants",
				"routine_reviews",
				"routine_screening_questions",
				"routine_technology_elements",
				"routines",
				"ruleset_controls",
				"ruleset_routines",
				"rulesets",
				"screening_answers",
				"screening_choice_effects",
				"screening_question_choices",
				"screening_question_effects",
				"screening_question_technology_elements",
				"screening_questions",
				"screening_routine_selections",
				"section_environments",
				"section_ignored_applications",
				"sections",
				"entra_group_classifications",
				"routine_group_classification_links",
				"technology_elements",
				"user_preferences",
				"user_roles",
				"users",
			]

			for (const table of expectedTables) {
				expect(tableNames, `Missing table: ${table}`).toContain(table)
			}
		})

		it("should create the migration tracking table with all entries", async () => {
			await runMigrations()

			expect(await trackingTableExists()).toBe(true)
			const count = await getTrackingCount()
			expect(count).toBeGreaterThanOrEqual(38)
		})

		it("should include application_controls table (migration 0032)", async () => {
			await runMigrations()

			const tableNames = await getTableNames()
			expect(tableNames).toContain("application_controls")
			expect(tableNames).toContain("application_control_history")

			// Verify the table has expected columns
			const columns = await testDb.execute<{ column_name: string }>(sql`
				SELECT column_name FROM information_schema.columns
				WHERE table_schema = 'public' AND table_name = 'application_controls'
				ORDER BY column_name
			`)
			const colNames = columns.rows.map((r) => r.column_name)
			expect(colNames).toContain("application_id")
			expect(colNames).toContain("control_id")
			expect(colNames).toContain("is_active")
			expect(colNames).toContain("comment")
		})

		it("should include routine status column (migration 0033)", async () => {
			await runMigrations()

			const columns = await testDb.execute<{ column_name: string }>(sql`
				SELECT column_name FROM information_schema.columns
				WHERE table_schema = 'public' AND table_name = 'routines'
				ORDER BY column_name
			`)
			const colNames = columns.rows.map((r) => r.column_name)
			expect(colNames).toContain("status")
		})
	})

	// ── 2. Idempotency ──────────────────────────────────────────────────

	describe("idempotency", () => {
		it("should be safe to run migrations multiple times", async () => {
			await runMigrations()
			const countAfterFirst = await getTrackingCount()

			await expect(runMigrations()).resolves.not.toThrow()
			const countAfterSecond = await getTrackingCount()

			expect(countAfterSecond).toBe(countAfterFirst)
		})

		it("should not duplicate tracking entries on repeated runs", async () => {
			await runMigrations()
			await runMigrations()
			await runMigrations()

			const result = await testDb.execute<{ hash: string; cnt: string }>(sql`
				SELECT hash, COUNT(*)::text AS cnt FROM drizzle."__drizzle_migrations"
				GROUP BY hash HAVING COUNT(*) > 1
			`)
			expect(result.rows).toHaveLength(0)
		})
	})

	// ── 3. Partial migration state ──────────────────────────────────────
	// Note: Drizzle uses a timestamp watermark — it only applies migrations
	// with timestamps AFTER the last tracked one. You cannot "un-apply" an
	// older migration and expect Drizzle to re-apply it.

	describe("partial migration state", () => {
		it("should apply the LAST migration when only its tracking entry is removed", async () => {
			// Dynamically determine what the last migration does so this test
			// never needs manual updating when new migrations are added.
			const journalPath = path.resolve(__dirname, "../../../../drizzle/meta/_journal.json")
			const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"))
			const lastEntry = journal.entries[journal.entries.length - 1]
			const migrationSql = fs.readFileSync(path.resolve(__dirname, `../../../../drizzle/${lastEntry.tag}.sql`), "utf-8")

			const createdTables = _testing.extractAllCreateTableNames(migrationSql)
			const addedColumns = _testing.extractAlterTableAddColumns(migrationSql)
			const droppedTables = _testing.extractDropTableNames(migrationSql)
			const createdIndexes = _testing.extractCreateIndexNames(migrationSql)
			const addedConstraints = _testing.extractAddConstraints(migrationSql)
			const isDataMigration =
				/UPDATE\s+"?\w+"?\s+SET\b/i.test(migrationSql) ||
				/ALTER TABLE[\s\S]*?ALTER COLUMN[\s\S]*?SET DEFAULT/i.test(migrationSql)
			const hasStructuralChanges =
				createdTables.length > 0 ||
				addedColumns.length > 0 ||
				droppedTables.length > 0 ||
				createdIndexes.length > 0 ||
				addedConstraints.length > 0
			const hasVerifiableChanges = hasStructuralChanges || isDataMigration
			expect(hasVerifiableChanges).toBe(true)

			// Data-only migrations (UPDATE/SET DEFAULT) can't be structurally
			// reverted and re-verified — skip the partial-state reapplication test
			if (!hasStructuralChanges) return

			// Run all migrations first
			await runMigrations()
			const fullCount = await getTrackingCount()

			// Remove ONLY the very last tracking entry
			await testDb.execute(sql`
				DELETE FROM drizzle."__drizzle_migrations"
				WHERE id = (
					SELECT id FROM drizzle."__drizzle_migrations"
					ORDER BY id DESC LIMIT 1
				)
			`)

			// Undo changes: drop created tables (in reverse order for FK deps),
			// drop created indexes BEFORE columns (siden indeks kan referere
			// til kolonnen og blokkere DROP COLUMN), drop added columns, og
			// re-create dropped tables (minimally).
			for (const table of [...createdTables].reverse()) {
				await testDb.execute(sql.raw(`DROP TABLE IF EXISTS "${table}" CASCADE`))
			}
			for (const idx of createdIndexes) {
				await testDb.execute(sql.raw(`DROP INDEX IF EXISTS "${idx}"`))
			}
			for (const { table, column } of addedColumns) {
				await testDb.execute(sql.raw(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "${column}"`))
			}
			for (const { table, constraint } of addedConstraints) {
				if (createdTables.includes(table)) continue
				await testDb.execute(sql.raw(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${constraint}"`))
			}
			for (const table of droppedTables) {
				// Re-create minimally so the DROP can be re-applied
				await testDb.execute(sql.raw(`CREATE TABLE IF NOT EXISTS "${table}" ("_placeholder" text)`))
			}

			const reducedCount = await getTrackingCount()
			expect(reducedCount).toBe(fullCount - 1)

			// Run migrations again — should re-apply only the last migration
			await runMigrations()

			// Verify created tables were re-created
			if (createdTables.length > 0) {
				const tables = await testDb.execute<{ table_name: string }>(sql`
					SELECT table_name FROM information_schema.tables
					WHERE table_schema = 'public'
				`)
				const tableNames = tables.rows.map((r) => r.table_name)
				for (const t of createdTables) {
					expect(tableNames).toContain(t)
				}
			}

			// Verify added columns were re-added
			for (const { table, column } of addedColumns) {
				const cols = await testDb.execute<{ column_name: string }>(
					sql.raw(`
					SELECT column_name FROM information_schema.columns
					WHERE table_schema = 'public' AND table_name = '${table}'
				`),
				)
				expect(cols.rows.map((r) => r.column_name)).toContain(column)
			}

			// Verify dropped tables were dropped again
			if (droppedTables.length > 0) {
				const tables = await testDb.execute<{ table_name: string }>(sql`
					SELECT table_name FROM information_schema.tables
					WHERE table_schema = 'public'
				`)
				const tableNames = tables.rows.map((r) => r.table_name)
				for (const t of droppedTables) {
					expect(tableNames, `Table "${t}" should have been dropped`).not.toContain(t)
				}
			}

			// Verify created indexes were re-created
			for (const idx of createdIndexes) {
				const indexes = await testDb.execute<{ indexname: string }>(
					sql.raw(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = '${idx}'`),
				)
				expect(indexes.rows.map((r) => r.indexname)).toContain(idx)
			}

			// Verify added constraints were re-applied
			for (const { table, constraint } of addedConstraints) {
				// PostgreSQL truncates identifiers to 63 chars
				const pgConstraint = constraint.slice(0, 63)
				const constraints = await testDb.execute<{ conname: string }>(
					sql.raw(`
					SELECT conname FROM pg_constraint
					WHERE conrelid = '"${table}"'::regclass AND conname = '${pgConstraint}'
				`),
				)
				expect(
					constraints.rows.map((r) => r.conname),
					`Constraint "${constraint}" on "${table}" should have been re-created`,
				).toContain(pgConstraint)
			}

			const finalCount = await getTrackingCount()
			expect(finalCount).toBe(fullCount)
		})
	})

	// ── 4. db:push transition (seed tracking) ───────────────────────────

	describe("db:push transition", () => {
		it("should seed tracking and apply new migrations on a db:push database", async () => {
			// First, run all migrations normally to create the full schema
			await runMigrations()

			// Now simulate a db:push database: tables exist but no tracking
			await testDb.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`)
			expect(await trackingTableExists()).toBe(false)

			// Run migrations — should detect db:push, seed tracking, then complete
			await runMigrations()

			expect(await trackingTableExists()).toBe(true)
			const count = await getTrackingCount()
			expect(count).toBeGreaterThanOrEqual(38)
		})

		it("should correctly handle missing tables during seeding (watermark stop)", async () => {
			// Run all migrations to get the full schema
			await runMigrations()

			// Drop tracking and drop the application_controls tables
			// This simulates a db:push DB that was created before migration 0032
			await testDb.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`)
			await testDb.execute(sql`DROP TABLE IF EXISTS "application_control_history" CASCADE`)
			await testDb.execute(sql`DROP TABLE IF EXISTS "application_controls" CASCADE`)
			// Also drop what 0033 and 0034 add since seeding must stop at 0032
			await testDb.execute(sql`ALTER TABLE "routines" DROP COLUMN IF EXISTS "status"`)
			await testDb.execute(sql`ALTER TABLE "routines" DROP COLUMN IF EXISTS "approved_by"`)
			await testDb.execute(sql`ALTER TABLE "routines" DROP COLUMN IF EXISTS "approved_at"`)
			await testDb.execute(sql`ALTER TABLE "routines" DROP COLUMN IF EXISTS "source_routine_id"`)
			await testDb.execute(sql`ALTER TABLE "routines" DROP COLUMN IF EXISTS "replaced_by_routine_id"`)
			await testDb.execute(sql`ALTER TABLE "routines" DROP COLUMN IF EXISTS "replaced_at"`)
			// Undo 0035: drop tables it created
			await testDb.execute(sql`DROP TABLE IF EXISTS "entra_group_classifications" CASCADE`)
			await testDb.execute(sql`DROP TABLE IF EXISTS "routine_group_classification_links" CASCADE`)
			// Undo 0036: drop section_environments
			await testDb.execute(sql`DROP TABLE IF EXISTS "section_environments" CASCADE`)
			// Undo 0037: re-create section_excluded_environments so 0036 seed + 0037 DROP can re-apply
			await testDb.execute(sql`
				CREATE TABLE IF NOT EXISTS "section_excluded_environments" (
					"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
					"section_id" uuid NOT NULL,
					"cluster" text NOT NULL,
					"excluded_by" text NOT NULL DEFAULT 'test',
					"excluded_at" timestamp with time zone DEFAULT now() NOT NULL,
					CONSTRAINT "uq_section_cluster" UNIQUE("section_id","cluster")
				)
			`)
			// Undo 0075: drop the evidence_downloads table so 0074 can recreate it
			// with the old schema, and 0075 can then transform it
			await testDb.execute(sql`DROP TABLE IF EXISTS "routine_review_evidence_downloads" CASCADE`)

			// Run migrations — seed should stop at 0032 (tables don't exist),
			// then migrate() applies 0032 through 0037
			await runMigrations()

			const tableNames = await getTableNames()
			expect(tableNames).toContain("application_controls")
			expect(tableNames).toContain("application_control_history")
			expect(tableNames).toContain("section_environments")
			expect(tableNames).not.toContain("section_excluded_environments")

			// Verify routines.status column was also applied
			const columns = await testDb.execute<{ column_name: string }>(sql`
				SELECT column_name FROM information_schema.columns
				WHERE table_schema = 'public' AND table_name = 'routines'
			`)
			expect(columns.rows.map((r) => r.column_name)).toContain("status")
			expect(columns.rows.map((r) => r.column_name)).toContain("approved_by")
		})
	})

	// ── 5. Advisory lock (concurrent migration) ─────────────────────────

	describe("advisory lock", () => {
		it("should prevent concurrent migration conflicts", async () => {
			// Run two migrations concurrently — advisory lock ensures only one runs at a time
			const [result1, result2] = await Promise.all([runMigrations(), runMigrations()])

			// Both should succeed (second one waits for first, then finds nothing to do)
			expect(result1).toBeUndefined()
			expect(result2).toBeUndefined()

			// No duplicate entries
			const result = await testDb.execute<{ hash: string; cnt: string }>(sql`
				SELECT hash, COUNT(*)::text AS cnt FROM drizzle."__drizzle_migrations"
				GROUP BY hash HAVING COUNT(*) > 1
			`)
			expect(result.rows).toHaveLength(0)

			// All tables exist
			const tableNames = await getTableNames()
			expect(tableNames).toContain("application_controls")
			expect(tableNames).toContain("routines")
		})
	})

	// ── 6. Post-migration health verification ───────────────────────────

	describe("post-migration health check", () => {
		it("should pass after successful migration", async () => {
			await runMigrations()
			await expect(verifyMigrationHealth()).resolves.not.toThrow()
		})

		it("should fail when critical tables are missing", async () => {
			await runMigrations()

			// Drop a critical table
			await testDb.execute(sql`DROP TABLE IF EXISTS "application_control_history" CASCADE`)
			await testDb.execute(sql`DROP TABLE IF EXISTS "application_controls" CASCADE`)

			await expect(verifyMigrationHealth()).rejects.toThrow("Missing tables after migration")
		})

		it("should list all critical tables in CRITICAL_TABLES constant", () => {
			expect(_testing.CRITICAL_TABLES).toContain("application_controls")
			expect(_testing.CRITICAL_TABLES).toContain("application_control_history")
			expect(_testing.CRITICAL_TABLES).toContain("sections")
			expect(_testing.CRITICAL_TABLES).toContain("routines")
			expect(_testing.CRITICAL_TABLES).toContain("users")
		})
	})
})

// ─── Unit tests for seed helpers ────────────────────────────────────────

describe("Migration seed helpers", () => {
	it("extractAllCreateTableNames should find all CREATE TABLE statements", () => {
		const sqlContent = `
			CREATE TABLE "table_a" ("id" uuid PRIMARY KEY);
			CREATE TABLE "table_b" ("id" uuid PRIMARY KEY);
		`
		const names = _testing.extractAllCreateTableNames(sqlContent)
		expect(names).toEqual(["table_a", "table_b"])
	})

	it("extractAllCreateTableNames should handle CREATE TABLE IF NOT EXISTS", () => {
		const sqlContent = `CREATE TABLE IF NOT EXISTS "my_table" ("id" uuid);`
		const names = _testing.extractAllCreateTableNames(sqlContent)
		expect(names).toEqual(["my_table"])
	})

	it("extractAlterTableAddColumns should find ADD COLUMN statements", () => {
		const sqlContent = `
			ALTER TABLE "routines" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;
			ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp;
		`
		const cols = _testing.extractAlterTableAddColumns(sqlContent)
		expect(cols).toEqual([
			{ table: "routines", column: "status" },
			{ table: "users", column: "last_login_at" },
		])
	})

	it("extractDropTableNames should find DROP TABLE statements", () => {
		const sqlContent = `DROP TABLE "audit_evidence_sections" CASCADE;`
		const names = _testing.extractDropTableNames(sqlContent)
		expect(names).toEqual(["audit_evidence_sections"])
	})

	it("extractDropColumns should find DROP COLUMN statements", () => {
		const sqlContent = `
			ALTER TABLE "routines" DROP COLUMN IF EXISTS "persistence_type";
			ALTER TABLE "routines" DROP COLUMN IF EXISTS "data_classification";
		`
		const cols = _testing.extractDropColumns(sqlContent)
		expect(cols).toEqual(["routines.persistence_type", "routines.data_classification"])
	})

	it("shouldSkipMigration should skip when CREATE TABLE target doesn't exist", () => {
		const sqlContent = `CREATE TABLE "new_table" ("id" uuid PRIMARY KEY);`
		const tables = new Set(["sections", "users"])
		const columns = new Set(["sections.id", "users.id"])

		expect(_testing.shouldSkipMigration(sqlContent, tables, columns, new Set(), new Set())).toBe(
			'table "new_table" does not exist',
		)
	})

	it("shouldSkipMigration should skip when ANY CREATE TABLE target doesn't exist", () => {
		const sqlContent = `
			CREATE TABLE "existing_table" ("id" uuid PRIMARY KEY);
			CREATE TABLE "new_table" ("id" uuid PRIMARY KEY);
		`
		const tables = new Set(["existing_table", "sections"])
		const columns = new Set<string>()

		expect(_testing.shouldSkipMigration(sqlContent, tables, columns, new Set(), new Set())).toBe(
			'table "new_table" does not exist',
		)
	})

	it("shouldSkipMigration should skip when ALTER TABLE ADD COLUMN targets missing column", () => {
		const sqlContent = `ALTER TABLE "routines" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;`
		const tables = new Set(["routines"])
		const columns = new Set(["routines.name", "routines.frequency"])

		expect(_testing.shouldSkipMigration(sqlContent, tables, columns, new Set(), new Set())).toBe(
			'column "routines.status" does not exist',
		)
	})

	it("shouldSkipMigration should NOT skip when all targets exist", () => {
		const sqlContent = `ALTER TABLE "routines" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;`
		const tables = new Set(["routines"])
		const columns = new Set(["routines.name", "routines.status"])

		expect(_testing.shouldSkipMigration(sqlContent, tables, columns, new Set(), new Set())).toBeNull()
	})

	it("shouldSkipMigration should NOT skip index-only migrations when table exists", () => {
		const sqlContent = `CREATE INDEX "idx_test" ON "routines" ("name");`
		const tables = new Set(["routines"])
		const columns = new Set<string>()

		expect(_testing.shouldSkipMigration(sqlContent, tables, columns, new Set(), new Set())).toBeNull()
	})

	it("shouldSkipMigration should NOT skip CREATE TABLE when table was later dropped", () => {
		const sqlContent = `CREATE TABLE "old_table" ("id" uuid PRIMARY KEY);`
		const tables = new Set(["sections"]) // old_table doesn't exist
		const columns = new Set<string>()
		const droppedTables = new Set(["old_table"]) // but it was dropped by a later migration

		expect(_testing.shouldSkipMigration(sqlContent, tables, columns, droppedTables, new Set())).toBeNull()
	})

	it("shouldSkipMigration should NOT skip ADD COLUMN when column was later dropped", () => {
		const sqlContent = `ALTER TABLE "routines" ADD COLUMN "old_col" text;`
		const tables = new Set(["routines"])
		const columns = new Set(["routines.name"]) // old_col doesn't exist
		const droppedColumns = new Set(["routines.old_col"]) // but it was dropped later

		expect(_testing.shouldSkipMigration(sqlContent, tables, columns, new Set(), droppedColumns)).toBeNull()
	})
})
