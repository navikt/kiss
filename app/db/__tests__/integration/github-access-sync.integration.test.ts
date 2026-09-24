import { sql } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { getTestDb, getTestPool, insertTestSection, setupTestDatabase, teardownTestDatabase } from "./setup"

vi.mock("~/db/connection.server", () => ({
	get db() {
		return getTestDb()
	},
	get pool() {
		return getTestPool()
	},
}))

const { findAppsWithGitRepository } = await import("~/lib/github-access-sync.server")
const { getApplicationsSharingGitRepositoryForApp } = await import("~/db/queries/github-access.server")
const { upsertMonitoredApp, upsertAppEnvironment } = await import("~/db/queries/nais.server")

async function setDirectRepo(appId: string, gitRepository: string) {
	const db = getTestDb()
	await db.execute(
		sql`UPDATE monitored_applications SET git_repository = ${gitRepository}, updated_at = now() WHERE id = ${appId}`,
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
		await db.execute(/* sql */ `DELETE FROM section_environments`)
		await db.execute(/* sql */ `DELETE FROM nais_teams`)
		await db.execute(/* sql */ `DELETE FROM sections`)
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
		// Sett eksplisitte timestamps så rekkefølgen er deterministisk uavhengig av transaksjonstidsstempel
		const db = getTestDb()
		await db.execute(
			sql`UPDATE application_environments SET discovered_at = '2024-01-01 10:00:00+00' WHERE cluster = 'prod-gcp' AND application_id = ${appId}`,
		)
		await db.execute(
			sql`UPDATE application_environments SET discovered_at = '2024-01-02 10:00:00+00' WHERE cluster = 'dev-gcp' AND application_id = ${appId}`,
		)

		const result = await findAppsWithGitRepository()

		expect(result).toHaveLength(1)
		expect(result[0].gitRepository).toBe("https://github.com/navikt/first")
	})

	it("utelater arkiverte apper", async () => {
		const { id: appId } = await upsertMonitoredApp("arkivert-app", "test")
		await setDirectRepo(appId, "https://github.com/navikt/arkivert")
		const db = getTestDb()
		await db.execute(
			sql`UPDATE monitored_applications SET archived_at = now(), archived_by = 'test' WHERE id = ${appId}`,
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

describe("getApplicationsSharingGitRepositoryForApp", () => {
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
		await db.execute(/* sql */ `DELETE FROM section_environments`)
		await db.execute(/* sql */ `DELETE FROM nais_teams`)
		await db.execute(/* sql */ `DELETE FROM sections`)
	})

	it("normaliserer treff, prioriterer app-repository og utelater kildeappen og arkiverte apper", async () => {
		const source = await upsertMonitoredApp("kilde-app", "test")
		await setDirectRepo(source.id, "https://github.com/navikt/shared.git/")
		await upsertAppEnvironment(source.id, "prod-gcp", "kilde", null, null, "navikt/annet-repo")

		const directMatch = await upsertMonitoredApp("direkte-treff", "test")
		await setDirectRepo(directMatch.id, "NAVIKT/SHARED")

		const environmentMatch = await upsertMonitoredApp("miljo-treff", "test")
		await upsertAppEnvironment(environmentMatch.id, "prod-gcp", "miljo", null, null, "navikt/shared")

		const archivedMatch = await upsertMonitoredApp("arkivert-treff", "test")
		await setDirectRepo(archivedMatch.id, "navikt/shared")
		await getTestDb().execute(
			sql`UPDATE monitored_applications SET archived_at = now(), archived_by = 'test' WHERE id = ${archivedMatch.id}`,
		)

		const result = await getApplicationsSharingGitRepositoryForApp(source.id)

		expect(result).toEqual([
			{ id: directMatch.id, name: "direkte-treff", gitRepository: "NAVIKT/SHARED" },
			{ id: environmentMatch.id, name: "miljo-treff", gitRepository: "navikt/shared" },
		])
	})

	it("ignorerer arkiverte miljøer ved valg av effektivt repository", async () => {
		const source = await upsertMonitoredApp("kilde-app", "test")
		await setDirectRepo(source.id, "navikt/shared")

		const candidate = await upsertMonitoredApp("kandidat-app", "test")
		await upsertAppEnvironment(candidate.id, "prod-gcp", "kandidat", null, null, "navikt/shared")
		await upsertAppEnvironment(candidate.id, "dev-gcp", "kandidat", null, null, "navikt/annet-repo")
		const db = getTestDb()
		await db.execute(
			sql`UPDATE application_environments
				SET discovered_at = '2024-01-01 10:00:00+00', archived_at = now(), archived_by = 'test'
				WHERE application_id = ${candidate.id} AND cluster = 'prod-gcp'`,
		)
		await db.execute(
			sql`UPDATE application_environments
				SET discovered_at = '2024-01-02 10:00:00+00'
				WHERE application_id = ${candidate.id} AND cluster = 'dev-gcp'`,
		)

		expect(await getApplicationsSharingGitRepositoryForApp(source.id)).toEqual([])
	})

	it("ignorerer miljøer i cluster som er ekskludert for Nais-teamets seksjon", async () => {
		const source = await upsertMonitoredApp("kilde-app", "test")
		await setDirectRepo(source.id, "navikt/shared")

		const section = await insertTestSection("Glad Seksjon")
		const teamResult = await getTestDb().execute(
			sql`INSERT INTO nais_teams (slug, section_id) VALUES ('glad-team', ${section.id}) RETURNING id`,
		)
		const naisTeamId = teamResult.rows[0]?.id as string
		const candidate = await upsertMonitoredApp("kandidat-app", "test")
		await upsertAppEnvironment(candidate.id, "dev-gcp", "kandidat", naisTeamId, null, "navikt/shared")
		await upsertAppEnvironment(candidate.id, "prod-gcp", "kandidat", naisTeamId, null, "navikt/annet-repo")
		const db = getTestDb()
		// dev-gcp forblir ekskludert (default false ved auto-registrering); prod-gcp inkluderes eksplisitt
		// slik at testen faktisk skiller mellom ekskludert og inkludert cluster.
		await db.execute(
			sql`UPDATE section_environments SET included = true
				WHERE section_id = ${section.id} AND cluster = 'prod-gcp'`,
		)
		await db.execute(
			sql`UPDATE application_environments
				SET discovered_at = '2024-01-01 10:00:00+00'
				WHERE application_id = ${candidate.id} AND cluster = 'dev-gcp'`,
		)
		await db.execute(
			sql`UPDATE application_environments
				SET discovered_at = '2024-01-02 10:00:00+00'
				WHERE application_id = ${candidate.id} AND cluster = 'prod-gcp'`,
		)

		expect(await getApplicationsSharingGitRepositoryForApp(source.id)).toEqual([])
	})
})
