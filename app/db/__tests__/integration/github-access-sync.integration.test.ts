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

const { findAppsWithGitRepository } = await import("~/lib/github-access-sync.server")
const { upsertMonitoredApp, upsertAppEnvironment } = await import("~/db/queries/nais.server")

async function setDirectRepo(appId: string, gitRepository: string) {
	const db = getTestDb()
	await db.execute(
		/* sql */ `UPDATE monitored_applications SET git_repository = '${gitRepository}', updated_at = now() WHERE id = '${appId}'`,
	)
}

describe("findAppsWithGitRepository", () => {
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
	})

	it("returnerer app med direkte git_repository på app-nivå", async () => {
		const { id: appId } = await upsertMonitoredApp("pen", "test")
		await setDirectRepo(appId, "https://github.com/navikt/pen")

		const result = await findAppsWithGitRepository()

		expect(result).toHaveLength(1)
		expect(result[0]).toEqual({ id: appId, gitRepository: "https://github.com/navikt/pen" })
	})

	it("returnerer app med git_repository kun på environment-nivå", async () => {
		const { id: appId } = await upsertMonitoredApp("pensjon-regler", "test")
		await upsertAppEnvironment(appId, "prod-gcp", "teampensjon", null, null, "https://github.com/navikt/pensjon-regler")

		const result = await findAppsWithGitRepository()

		expect(result).toHaveLength(1)
		expect(result[0]).toEqual({ id: appId, gitRepository: "https://github.com/navikt/pensjon-regler" })
	})

	it("foretrekker app-nivå repo fremfor environment-nivå repo", async () => {
		const { id: appId } = await upsertMonitoredApp("pen", "test")
		await setDirectRepo(appId, "https://github.com/navikt/pen")
		await upsertAppEnvironment(appId, "prod-gcp", "teampensjon", null, null, "https://github.com/navikt/env-repo")

		const result = await findAppsWithGitRepository()

		expect(result).toHaveLength(1)
		expect(result[0].gitRepository).toBe("https://github.com/navikt/pen")
	})

	it("returnerer tidligst discoveredAt env-repo når flere envs har repo", async () => {
		const { id: appId } = await upsertMonitoredApp("pen", "test")
		await upsertAppEnvironment(appId, "prod-gcp", "teampensjon", null, null, "https://github.com/navikt/first")
		await upsertAppEnvironment(appId, "dev-gcp", "teampensjon", null, null, "https://github.com/navikt/second")

		const result = await findAppsWithGitRepository()

		expect(result).toHaveLength(1)
		expect(result[0].gitRepository).toBe("https://github.com/navikt/first")
	})

	it("utelater arkiverte apper", async () => {
		const { id: appId } = await upsertMonitoredApp("arkivert-app", "test")
		await setDirectRepo(appId, "https://github.com/navikt/arkivert")
		const db = getTestDb()
		await db.execute(
			/* sql */ `UPDATE monitored_applications SET archived_at = now(), archived_by = 'test' WHERE id = '${appId}'`,
		)

		const result = await findAppsWithGitRepository()

		expect(result).toHaveLength(0)
	})

	it("utelater apper uten git_repository", async () => {
		await upsertMonitoredApp("ingen-repo", "test")

		const result = await findAppsWithGitRepository()

		expect(result).toHaveLength(0)
	})

	it("utelater apper med git_repository som kun er whitespace", async () => {
		const { id: appId } = await upsertMonitoredApp("tom-repo", "test")
		await setDirectRepo(appId, "   ")

		const result = await findAppsWithGitRepository()

		expect(result).toHaveLength(0)
	})
})
