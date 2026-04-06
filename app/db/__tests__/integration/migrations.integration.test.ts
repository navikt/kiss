import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
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

const { runMigrations } = await import("~/db/migrate.server")

describe("Database migration on empty database", () => {
	beforeAll(async () => {
		container = await new PostgreSqlContainer("postgres:17-alpine")
			.withDatabase("kiss_migration_test")
			.withUsername("test")
			.withPassword("test")
			.start()

		pool = new pg.Pool({ connectionString: container.getConnectionUri() })
		testDb = drizzle(pool, { schema })
	})

	afterAll(async () => {
		await pool?.end()
		await container?.stop()
	})

	it("should run migrations successfully on an empty database", async () => {
		await runMigrations()

		const result = await testDb.execute<{ table_name: string }>(sql`
			SELECT table_name FROM information_schema.tables
			WHERE table_schema = 'public'
			ORDER BY table_name
		`)

		const tableNames = result.rows.map((r) => r.table_name)

		const expectedTables = [
			"application_auth_integrations",
			"application_environments",
			"application_persistence",
			"application_team_mappings",
			"audit_log",
			"bucket_objects",
			"clusters",
			"compliance_assessment_history",
			"compliance_assessments",
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
			"routine_review_attachments",
			"routine_review_links",
			"routine_review_participants",
			"routine_reviews",
			"routines",
			"screening_answers",
			"screening_question_choices",
			"screening_question_effects",
			"screening_questions",
			"sections",
			"user_roles",
			"users",
		]

		for (const table of expectedTables) {
			expect(tableNames, `Missing table: ${table}`).toContain(table)
		}
	})

	it("should have created the migration tracking table", async () => {
		const result = await testDb.execute<{ count: string }>(sql`
			SELECT COUNT(*)::text AS count FROM drizzle."__drizzle_migrations"
		`)

		expect(Number(result.rows[0].count)).toBeGreaterThan(0)
	})

	it("should be idempotent — running migrations again does nothing", async () => {
		await expect(runMigrations()).resolves.not.toThrow()
	})
})
