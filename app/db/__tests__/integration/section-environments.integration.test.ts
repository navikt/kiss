import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { getTestDb, getTestPool, setupTestDatabase, teardownTestDatabase } from "./setup"

vi.mock("~/db/connection.server", () => ({
	get db() {
		return getTestDb()
	},
	get pool() {
		return getTestPool()
	},
}))

const {
	getSectionEnvironments,
	excludeEnvironment,
	includeEnvironment,
	upsertAppEnvironment,
	getUnassignedAppsForSection,
} = await import("~/db/queries/nais.server")

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createSection(name: string) {
	const db = getTestDb()
	const result = await db.execute(
		`INSERT INTO sections (name, slug, created_by, updated_by) VALUES ('${name}', '${name.toLowerCase().replace(/\s/g, "-")}', 'test', 'test') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function createNaisTeam(slug: string, sectionId: string) {
	const db = getTestDb()
	const result = await db.execute(
		`INSERT INTO nais_teams (slug, section_id) VALUES ('${slug}', '${sectionId}') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function createApp(name: string) {
	const db = getTestDb()
	const result = await db.execute(
		`INSERT INTO monitored_applications (name, created_by, updated_by) VALUES ('${name}', 'test', 'test') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("section_environments integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	}, 120_000)

	afterAll(async () => {
		await teardownTestDatabase()
	})

	describe("getSectionEnvironments", () => {
		it("returns empty array for new section with no environments", async () => {
			const sectionId = await createSection("Test Section Empty")
			const envs = await getSectionEnvironments(sectionId)
			expect(envs).toEqual([])
		})

		it("returns registered environments ordered by cluster name", async () => {
			const db = getTestDb()
			const sectionId = await createSection("Test Section Ordered")
			await db.execute(
				`INSERT INTO section_environments (section_id, cluster, included, added_by, updated_by)
				 VALUES ('${sectionId}', 'prod-gcp', true, 'test', 'test'),
				        ('${sectionId}', 'dev-gcp', true, 'test', 'test')`,
			)
			const envs = await getSectionEnvironments(sectionId)
			expect(envs.map((e) => e.cluster)).toEqual(["dev-gcp", "prod-gcp"])
		})

		it("returns both included and excluded environments", async () => {
			const db = getTestDb()
			const sectionId = await createSection("Test Section Mixed")
			await db.execute(
				`INSERT INTO section_environments (section_id, cluster, included, added_by, updated_by)
				 VALUES ('${sectionId}', 'prod-gcp', true, 'test', 'test'),
				        ('${sectionId}', 'dev-fss', false, 'test', 'test')`,
			)
			const envs = await getSectionEnvironments(sectionId)
			expect(envs).toHaveLength(2)
			expect(envs.find((e) => e.cluster === "prod-gcp")?.included).toBe(true)
			expect(envs.find((e) => e.cluster === "dev-fss")?.included).toBe(false)
		})
	})

	describe("excludeEnvironment / includeEnvironment", () => {
		it("excludeEnvironment sets included=false (idempotent)", async () => {
			const db = getTestDb()
			const sectionId = await createSection("Test Exclude")
			await db.execute(
				`INSERT INTO section_environments (section_id, cluster, included, added_by, updated_by)
				 VALUES ('${sectionId}', 'dev-gcp', true, 'test', 'test')`,
			)

			await excludeEnvironment(sectionId, "dev-gcp", "test")
			const envs = await getSectionEnvironments(sectionId)
			expect(envs.find((e) => e.cluster === "dev-gcp")?.included).toBe(false)

			// Idempotent — calling again should not throw
			await excludeEnvironment(sectionId, "dev-gcp", "test")
			const envs2 = await getSectionEnvironments(sectionId)
			expect(envs2.find((e) => e.cluster === "dev-gcp")?.included).toBe(false)
		})

		it("includeEnvironment sets included=true (idempotent)", async () => {
			const db = getTestDb()
			const sectionId = await createSection("Test Include")
			await db.execute(
				`INSERT INTO section_environments (section_id, cluster, included, added_by, updated_by)
				 VALUES ('${sectionId}', 'dev-gcp', false, 'test', 'test')`,
			)

			await includeEnvironment(sectionId, "dev-gcp", "test")
			const envs = await getSectionEnvironments(sectionId)
			expect(envs.find((e) => e.cluster === "dev-gcp")?.included).toBe(true)

			// Idempotent — calling again should not throw
			await includeEnvironment(sectionId, "dev-gcp", "test")
			const envs2 = await getSectionEnvironments(sectionId)
			expect(envs2.find((e) => e.cluster === "dev-gcp")?.included).toBe(true)
		})

		it("toggle: exclude then include restores included=true", async () => {
			const db = getTestDb()
			const sectionId = await createSection("Test Toggle")
			await db.execute(
				`INSERT INTO section_environments (section_id, cluster, included, added_by, updated_by)
				 VALUES ('${sectionId}', 'prod-gcp', true, 'test', 'test')`,
			)

			await excludeEnvironment(sectionId, "prod-gcp", "test")
			await includeEnvironment(sectionId, "prod-gcp", "test")

			const envs = await getSectionEnvironments(sectionId)
			expect(envs.find((e) => e.cluster === "prod-gcp")?.included).toBe(true)
		})
	})

	describe("upsertAppEnvironment — section_environments auto-registration", () => {
		it("registers new cluster in section_environments when naisTeamId has a section", async () => {
			const sectionId = await createSection("Test AutoReg")
			const naisTeamId = await createNaisTeam("team-autosync", sectionId)
			const appId = await createApp("app-autosync")

			await upsertAppEnvironment(appId, "prod-gcp", "team-autosync", naisTeamId)

			const envs = await getSectionEnvironments(sectionId)
			expect(envs).toHaveLength(1)
			expect(envs[0].cluster).toBe("prod-gcp")
			expect(envs[0].included).toBe(true)
		})

		it("does NOT overwrite existing included=false when syncing same cluster again", async () => {
			const db = getTestDb()
			const sectionId = await createSection("Test NoOverwrite")
			const naisTeamId = await createNaisTeam("team-nooverwrite", sectionId)
			const appId = await createApp("app-nooverwrite")
			const appId2 = await createApp("app-nooverwrite-2")

			// Manual exclude before first sync
			await db.execute(
				`INSERT INTO section_environments (section_id, cluster, included, added_by, updated_by)
				 VALUES ('${sectionId}', 'dev-gcp', false, 'test', 'test')`,
			)

			// Sync registers new app in dev-gcp — should not flip included back to true
			await upsertAppEnvironment(appId, "dev-gcp", "team-nooverwrite", naisTeamId)
			await upsertAppEnvironment(appId2, "dev-gcp", "team-nooverwrite", naisTeamId)

			const envs = await getSectionEnvironments(sectionId)
			expect(envs.find((e) => e.cluster === "dev-gcp")?.included).toBe(false)
		})

		it("does NOT register cluster in section_environments when naisTeamId has no section", async () => {
			const db = getTestDb()
			// Create a nais team without a section
			const result = await db.execute(`INSERT INTO nais_teams (slug) VALUES ('team-nosection') RETURNING id`)
			const naisTeamId = (result.rows[0] as { id: string }).id
			const appId = await createApp("app-nosection")

			await upsertAppEnvironment(appId, "prod-gcp", "team-nosection", naisTeamId)

			const appId3 = await createApp("app-nosection-extra")
			await upsertAppEnvironment(appId3, "prod-fss", "team-nosection", naisTeamId)

			const envRowsAfter = await db.execute(`SELECT * FROM section_environments WHERE cluster = 'prod-fss'`)
			expect(envRowsAfter.rows).toHaveLength(0)
		})

		it("does not re-register when upsertAppEnvironment is called for existing environment", async () => {
			const sectionId = await createSection("Test NoReRegister")
			const naisTeamId = await createNaisTeam("team-noreregister", sectionId)
			const appId = await createApp("app-noreregister")

			// First upsert — registers cluster
			await upsertAppEnvironment(appId, "prod-gcp", "team-noreregister", naisTeamId)
			// Second upsert same app+cluster — should be a no-op
			await upsertAppEnvironment(appId, "prod-gcp", "team-noreregister", naisTeamId)

			const envs = await getSectionEnvironments(sectionId)
			expect(envs.filter((e) => e.cluster === "prod-gcp")).toHaveLength(1)
		})
	})

	describe("getUnassignedAppsForSection — excluded cluster filtering", () => {
		it("excludes apps that only exist in excluded clusters from link suggestions", async () => {
			const sectionId = await createSection("Test Filter Section")
			const naisTeamId = await createNaisTeam("team-filter", sectionId)

			// App only in dev-gcp
			const devOnlyApp = await createApp("app-dev-only-filter")
			// App in prod-gcp
			const prodApp = await createApp("app-prod-filter")

			await upsertAppEnvironment(devOnlyApp, "dev-gcp", "team-filter", naisTeamId)
			await upsertAppEnvironment(prodApp, "prod-gcp", "team-filter", naisTeamId)

			// Exclude dev-gcp
			await excludeEnvironment(sectionId, "dev-gcp", "test")

			const candidates = await getUnassignedAppsForSection(sectionId)
			const candidateIds = candidates.map((c) => c.appId)

			expect(candidateIds).not.toContain(devOnlyApp)
			expect(candidateIds).toContain(prodApp)
		})

		it("re-includes app in suggestions after including excluded cluster", async () => {
			const sectionId = await createSection("Test Reinclude Section")
			const naisTeamId = await createNaisTeam("team-reinclude", sectionId)

			const devOnlyApp = await createApp("app-dev-only-reinclude")
			await upsertAppEnvironment(devOnlyApp, "dev-gcp", "team-reinclude", naisTeamId)

			await excludeEnvironment(sectionId, "dev-gcp", "test")
			const candidatesBefore = await getUnassignedAppsForSection(sectionId)
			expect(candidatesBefore.map((c) => c.appId)).not.toContain(devOnlyApp)

			await includeEnvironment(sectionId, "dev-gcp", "test")
			const candidatesAfter = await getUnassignedAppsForSection(sectionId)
			expect(candidatesAfter.map((c) => c.appId)).toContain(devOnlyApp)
		})
	})
})
