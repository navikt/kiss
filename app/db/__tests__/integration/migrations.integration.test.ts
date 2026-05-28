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
				"application_environment_access_policy_rules",
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
				"github_repo_collaborators",
				"github_repo_team_members",
				"github_repo_teams",
				"monitored_applications",
				"nais_teams",
				"reports",
				"routine_activity_links",
				"routine_controls",
				"routine_persistence_links",
				"routine_review_activities",
				"routine_review_activity_entra_changes",
				"routine_review_attachments",
				"routine_review_links",
				"routine_review_participants",
				"routine_reviews",
				"routine_rpa_user_assessments",
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
				"sync_job_events",
				"sync_jobs",
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

		it("should include staged_data column on routine_review_activities (migration 0095)", async () => {
			await runMigrations()

			const columns = await testDb.execute<{ column_name: string }>(sql`
				SELECT column_name FROM information_schema.columns
				WHERE table_schema = 'public' AND table_name = 'routine_review_activities'
				ORDER BY column_name
			`)
			const colNames = columns.rows.map((r) => r.column_name)
			expect(colNames).toContain("staged_data")
		})

		it("should include archived_at column on application_group_assessments (migration 0096)", async () => {
			await runMigrations()

			const columns = await testDb.execute<{ column_name: string }>(sql`
				SELECT column_name FROM information_schema.columns
				WHERE table_schema = 'public' AND table_name = 'application_group_assessments'
				ORDER BY column_name
			`)
			const colNames = columns.rows.map((r) => r.column_name)
			expect(colNames).toContain("archived_at")
			expect(colNames).toContain("archived_by")
		})

		it("should not have activity_type column on routines after migration 0097", async () => {
			await runMigrations()

			const columns = await testDb.execute<{ column_name: string }>(sql`
				SELECT column_name FROM information_schema.columns
				WHERE table_schema = 'public' AND table_name = 'routines'
				ORDER BY column_name
			`)
			const colNames = columns.rows.map((r) => r.column_name)
			expect(colNames).not.toContain("activity_type")
		})
	})

	// ── 1b. Migration 0097 backfill behaviour ───────────────────────────
	// These tests simulate the pre-0097 state by re-adding the activity_type
	// column after a full migration run, inserting test data, then executing
	// only the backfill INSERT from 0097 to verify correctness.

	describe("migration 0097 backfill (routine_activity_links)", () => {
		// IDs stable within each test; beforeEach wipes tables via dropAllPublicTables + runMigrations
		let sectionId: string
		let routineId: string

		async function setupPre0097State() {
			await runMigrations()
			// Re-add the dropped column to simulate pre-0097 state
			await testDb.execute(sql`ALTER TABLE routines ADD COLUMN IF NOT EXISTS activity_type text`)
			// Create a section so routines can be inserted (FK constraint)
			const secResult = await testDb.execute<{ id: string }>(sql`
				INSERT INTO sections (name, slug, created_by, updated_by)
				VALUES ('Test Section', 'test-section', 'test', 'test')
				RETURNING id
			`)
			sectionId = secResult.rows[0].id
			const routineResult = await testDb.execute<{ id: string }>(sql`
				INSERT INTO routines (section_id, name, frequency, responsible_role,
				                     applies_to_all_in_section, is_section_routine,
				                     created_by, updated_by)
				VALUES (${sectionId}, 'Test Routine', 'quarterly', 'developer', 0, 0, 'test', 'test')
				RETURNING id
			`)
			routineId = routineResult.rows[0].id
		}

		async function setActivityType(value: string | null) {
			await testDb.execute(sql`UPDATE routines SET activity_type = ${value} WHERE id = ${routineId}`)
		}

		async function insertLink(activityType: string, archived = false) {
			await testDb.execute(sql`
				INSERT INTO routine_activity_links (id, routine_id, activity_type, sort_order, created_by)
				VALUES (gen_random_uuid(), ${routineId}, ${activityType}, 0, 'test')
			`)
			if (archived) {
				await testDb.execute(sql`
					UPDATE routine_activity_links
					SET archived_at = NOW(), archived_by = 'test'
					WHERE routine_id = ${routineId} AND activity_type = ${activityType} AND archived_at IS NULL
				`)
			}
		}

		async function runBackfill() {
			// Execute only the INSERT part of migration 0097 (not the DROP).
			// Must stay in sync with drizzle/0097_remove_legacy_activity_type.sql.
			await testDb.execute(sql`
				INSERT INTO routine_activity_links (id, routine_id, activity_type, sort_order, created_at, created_by)
				SELECT
					gen_random_uuid(),
					r.id,
					r.activity_type,
					COALESCE(
						(SELECT MAX(ral2.sort_order) + 1
						 FROM routine_activity_links ral2
						 WHERE ral2.routine_id = r.id AND ral2.archived_at IS NULL),
						0
					),
					r.created_at,
					r.created_by
				FROM routines r
				WHERE r.activity_type IS NOT NULL
				  AND NOT EXISTS (
				      SELECT 1
				      FROM routine_activity_links ral
				      WHERE ral.routine_id = r.id
				        AND ral.activity_type = r.activity_type
				        AND ral.archived_at IS NULL
				  )
				ON CONFLICT DO NOTHING
			`)
		}

		async function getActiveLinksWithOrder(): Promise<Array<{ activityType: string; sortOrder: number }>> {
			const result = await testDb.execute<{ activity_type: string; sort_order: number }>(sql`
				SELECT activity_type, sort_order
				FROM routine_activity_links
				WHERE routine_id = ${routineId} AND archived_at IS NULL
				ORDER BY sort_order, created_at
			`)
			return result.rows.map((r) => ({ activityType: r.activity_type, sortOrder: r.sort_order }))
		}

		async function getActiveLinks(): Promise<string[]> {
			return (await getActiveLinksWithOrder()).map((r) => r.activityType)
		}

		it("backfills activity_type to routine_activity_links when no links exist", async () => {
			await setupPre0097State()
			await setActivityType("oracle_evidence_audit")

			await runBackfill()

			expect(await getActiveLinks()).toEqual(["oracle_evidence_audit"])
		})

		it("does not create duplicate when matching active link already exists", async () => {
			await setupPre0097State()
			await setActivityType("oracle_evidence_audit")
			await insertLink("oracle_evidence_audit")

			await runBackfill()

			// Still exactly one link — no duplicate created
			expect(await getActiveLinks()).toEqual(["oracle_evidence_audit"])
		})

		it("backfills activity_type even when an active link for a DIFFERENT type exists", async () => {
			// This is the key correctness test: a routine with activity_type='A'
			// and an active link for 'B' must get a new link for 'A'.
			// The old (wrong) NOT EXISTS check would skip the insert because
			// SOME active link existed; the correct check matches on activity_type too.
			await setupPre0097State()
			await setActivityType("oracle_evidence_audit")
			await insertLink("entra_id_group_maintenance") // different type, active

			await runBackfill()

			const links = await getActiveLinks()
			expect(links).toContain("oracle_evidence_audit") // backfilled
			expect(links).toContain("entra_id_group_maintenance") // preserved
			expect(links).toHaveLength(2)
		})

		it("appends backfilled link with sort_order after existing active links (no duplicate sort_order)", async () => {
			// When existing links are present, the backfilled link must use
			// max(existing sort_order)+1 to avoid duplicate sort_order values
			// that would make ordering nondeterministic.
			await setupPre0097State()
			await setActivityType("oracle_evidence_audit")
			await insertLink("entra_id_group_maintenance") // active, sort_order=0

			await runBackfill()

			const links = await getActiveLinksWithOrder()
			const entraLink = links.find((l) => l.activityType === "entra_id_group_maintenance")
			const oracleLink = links.find((l) => l.activityType === "oracle_evidence_audit")
			expect(entraLink?.sortOrder).toBe(0)
			expect(oracleLink?.sortOrder).toBe(1) // appended after entra
		})

		it("backfills when existing link for same type is archived (partial unique index allows new active row)", async () => {
			await setupPre0097State()
			await setActivityType("oracle_evidence_audit")
			await insertLink("oracle_evidence_audit", true) // same type, but archived

			await runBackfill()

			// Archived row remains, new active row inserted — partial unique index allows this
			expect(await getActiveLinks()).toContain("oracle_evidence_audit")
		})

		it("skips routines where activity_type is NULL", async () => {
			await setupPre0097State()
			await setActivityType(null)

			await runBackfill()

			expect(await getActiveLinks()).toHaveLength(0)
		})

		it("backfills archived routines as well as active ones", async () => {
			await setupPre0097State()
			await setActivityType("oracle_evidence_audit")
			// Archive the routine itself
			await testDb.execute(sql`UPDATE routines SET archived_at = NOW(), archived_by = 'test' WHERE id = ${routineId}`)

			await runBackfill()

			// Archived routines must be included to preserve historical data
			expect(await getActiveLinks()).toContain("oracle_evidence_audit")
		})

		it("full 0097 SQL: backfills then drops the activity_type column", async () => {
			await setupPre0097State()
			await setActivityType("entra_id_group_maintenance")

			// Run the complete 0097 migration SQL (backfill + DROP COLUMN)
			const migrationSql = path.resolve(__dirname, "../../../../drizzle/0097_remove_legacy_activity_type.sql")
			const sqlText = fs.readFileSync(migrationSql, "utf-8")
			await testDb.execute(sql.raw(sqlText))

			// Column must be gone
			const columns = await testDb.execute<{ column_name: string }>(sql`
				SELECT column_name FROM information_schema.columns
				WHERE table_schema = 'public' AND table_name = 'routines'
			`)
			expect(columns.rows.map((r) => r.column_name)).not.toContain("activity_type")

			// Link must have been created before the drop
			expect(await getActiveLinks()).toContain("entra_id_group_maintenance")
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
			const droppedColumns = _testing.extractDropColumns(migrationSql)
			const createdIndexes = _testing.extractCreateIndexNames(migrationSql)
			const addedConstraints = _testing.extractAddConstraints(migrationSql)
			const isDataMigration =
				/UPDATE\s+"?\w+"?\s+SET\b/i.test(migrationSql) ||
				/ALTER TABLE[\s\S]*?ALTER COLUMN[\s\S]*?SET DEFAULT/i.test(migrationSql) ||
				/INSERT\s+INTO\b/i.test(migrationSql)
			const hasStructuralChanges =
				createdTables.length > 0 ||
				addedColumns.length > 0 ||
				droppedTables.length > 0 ||
				droppedColumns.length > 0 ||
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
			for (const tableColumn of droppedColumns) {
				const [table, column] = tableColumn.split(".")
				// Re-add minimally so the DROP COLUMN can be re-applied
				await testDb.execute(sql.raw(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column}" text`))
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

			// Verify dropped columns were dropped again
			for (const tableColumn of droppedColumns) {
				const [table, column] = tableColumn.split(".")
				const cols = await testDb.execute<{ column_name: string }>(
					sql.raw(`
					SELECT column_name FROM information_schema.columns
					WHERE table_schema = 'public' AND table_name = '${table}'
				`),
				)
				expect(
					cols.rows.map((r) => r.column_name),
					`Column "${column}" on "${table}" should have been dropped`,
				).not.toContain(column)
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
			// Undo 0090: recreate application_access_policy_rules so 0041/0056 can ALTER it,
			// then 0090 will drop it again
			await testDb.execute(sql`
				CREATE TABLE IF NOT EXISTS "application_access_policy_rules" (
					"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
					"application_id" uuid NOT NULL,
					"direction" text NOT NULL,
					"rule_application" text NOT NULL,
					"rule_namespace" text,
					"rule_cluster" text,
					"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
					"updated_at" timestamp with time zone DEFAULT now() NOT NULL
				)
			`)
			// Undo 0097: re-add activity_type column so that when drizzle re-applies
			// migration 0091 (which reads routines.activity_type), the column exists.
			// Migration 0097 dropped it, but re-applying 0091 needs it present.
			await testDb.execute(sql`ALTER TABLE "routines" ADD COLUMN IF NOT EXISTS "activity_type" text`)

			// Run migrations — seed should stop at 0032 (tables don't exist),
			// then migrate() applies 0032 through 0037
			await runMigrations()

			const tableNames = await getTableNames()
			expect(tableNames).toContain("application_controls")
			expect(tableNames).toContain("application_control_history")
			expect(tableNames).toContain("section_environments")
			expect(tableNames).not.toContain("section_excluded_environments")
			expect(tableNames).not.toContain("application_access_policy_rules")

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

	it("extractCreateIndexNames should handle CREATE INDEX IF NOT EXISTS with unquoted names", () => {
		const sqlContent = `CREATE INDEX IF NOT EXISTS rpa_group_members_user_active_idx ON rpa_group_members (user_object_id) WHERE archived_at IS NULL;`
		const names = _testing.extractCreateIndexNames(sqlContent)
		expect(names).toEqual(["rpa_group_members_user_active_idx"])
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
