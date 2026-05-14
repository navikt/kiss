import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { getTestDb, getTestPool, setupTestDatabase, teardownTestDatabase } from "./setup"

vi.mock("~/db/connection.server", () => ({
	get db() {
		return getTestDb()
	},
	get pool() {
		return getTestPool()
	},
}))

const { upsertAppEnvironment, upsertMonitoredApp } = await import("~/db/queries/nais.server")

async function createNaisTeam(slug: string): Promise<string> {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO nais_teams (slug, app_count, status) VALUES ('${slug}', 0, 'monitored') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

describe("Nais app identity per team", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	})

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `DELETE FROM application_environments`)
		await db.execute(/* sql */ `DELETE FROM monitored_applications`)
		await db.execute(/* sql */ `DELETE FROM nais_teams`)
	})

	it("keeps separate monitored app ids for same app name across different teams", async () => {
		const teamA = await createNaisTeam("pensjondeployer")
		const teamB = await createNaisTeam("teampensjon")

		const appA = await upsertMonitoredApp("pensjon-kodeverk", "nais-sync", teamA)
		await upsertAppEnvironment(appA.id, "prod-gcp", "pensjondeployer", teamA)

		const appB = await upsertMonitoredApp("pensjon-kodeverk", "nais-sync", teamB)
		await upsertAppEnvironment(appB.id, "dev-gcp", "teampensjon", teamB)

		expect(appB.id).not.toBe(appA.id)

		const appAAgain = await upsertMonitoredApp("pensjon-kodeverk", "nais-sync", teamA)
		const appBAgain = await upsertMonitoredApp("pensjon-kodeverk", "nais-sync", teamB)
		expect(appAAgain.id).toBe(appA.id)
		expect(appBAgain.id).toBe(appB.id)
	})

	it("splits a legacy shared app row into team-specific identity", async () => {
		const teamA = await createNaisTeam("pensjondeployer")
		const teamB = await createNaisTeam("teampensjon")

		const legacy = await upsertMonitoredApp("pensjon-kodeverk", "nais-sync")
		await upsertAppEnvironment(legacy.id, "prod-gcp", "pensjondeployer", teamA)
		await upsertAppEnvironment(legacy.id, "dev-gcp", "teampensjon", teamB)

		const splitA = await upsertMonitoredApp("pensjon-kodeverk", "nais-sync", teamA)
		expect(splitA.id).not.toBe(legacy.id)

		const db = getTestDb()
		const rows = await db.execute(
			/* sql */ `SELECT application_id, nais_team_id, cluster, namespace
			           FROM application_environments
			           WHERE namespace IN ('pensjondeployer', 'teampensjon')
			           ORDER BY namespace`,
		)

		const envs = rows.rows as Array<{
			application_id: string
			nais_team_id: string
			cluster: string
			namespace: string
		}>

		const deployerEnv = envs.find((e) => e.namespace === "pensjondeployer")
		const teamPensjonEnv = envs.find((e) => e.namespace === "teampensjon")

		expect(deployerEnv?.application_id).toBe(splitA.id)
		expect(teamPensjonEnv?.application_id).toBe(legacy.id)

		const splitAAgain = await upsertMonitoredApp("pensjon-kodeverk", "nais-sync", teamA)
		expect(splitAAgain.id).toBe(splitA.id)
	})
})
