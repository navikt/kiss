/**
 * Integration tests for getTeamComplianceGaps.
 *
 * Verifies:
 * - Non-existent team → null
 * - Team with no apps → empty gaps
 * - Active control with status IS NULL → included as a gap
 * - Control with a determined status (e.g. implemented) → excluded
 * - Inactive control (isActive=false) → excluded
 * - Economy classification is carried through onto each gap row
 */
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

const { createTeam, getTeamComplianceGaps } = await import("~/db/queries/sections.server")

async function insertApp(name: string): Promise<string> {
	const db = getTestDb()
	const [app] = (
		await db.execute(
			sql`INSERT INTO monitored_applications (name, created_by, updated_by) VALUES (${name}, 'test', 'test') RETURNING id`,
		)
	).rows as { id: string }[]
	return app.id
}

async function linkAppToTeam(appId: string, teamId: string) {
	const db = getTestDb()
	await db.execute(
		sql`INSERT INTO application_team_mappings (application_id, dev_team_id, created_by)
			VALUES (${appId}, ${teamId}, 'test')`,
	)
}

async function insertFrameworkControl(controlId: string, shortTitle: string): Promise<string> {
	const db = getTestDb()
	const [ctrl] = (
		await db.execute(
			sql`INSERT INTO framework_controls (control_id, short_title, requirement)
				VALUES (${controlId}, ${shortTitle}, 'req') RETURNING id`,
		)
	).rows as { id: string }[]
	return ctrl.id
}

async function insertApplicationControl(appId: string, controlId: string, status: string | null, isActive = true) {
	const db = getTestDb()
	await db.execute(
		sql`INSERT INTO application_controls
			(application_id, control_id, status, is_active, activated_at, created_by, updated_by)
			VALUES (${appId}, ${controlId}, ${status}, ${isActive}, NOW(), 'test', 'test')`,
	)
}

async function classifyEconomy(appId: string, isEconomySystem: boolean) {
	const db = getTestDb()
	await db.execute(
		sql`INSERT INTO application_economy_classifications
			(application_id, is_economy_system, justification, valid_until, created_by, updated_by)
			VALUES (${appId}, ${isEconomySystem}, 'test', now() + interval '1 year', 'test', 'test')`,
	)
}

describe("getTeamComplianceGaps", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	}, 120_000)

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM application_economy_classifications;
			DELETE FROM application_controls;
			DELETE FROM application_team_mappings;
			DELETE FROM application_environments;
			DELETE FROM section_ignored_applications;
			DELETE FROM section_environments;
			DELETE FROM monitored_applications;
			DELETE FROM dev_team_nais_team_mappings;
			DELETE FROM nais_teams;
			DELETE FROM dev_teams;
			DELETE FROM framework_risk_control_mappings;
			DELETE FROM framework_controls;
			DELETE FROM sections;
		`)
	})

	it("returns null for a non-existent team slug", async () => {
		const result = await getTeamComplianceGaps("slug-does-not-exist")
		expect(result).toBeNull()
	})

	it("returns empty gaps for a team with no apps", async () => {
		const section = await insertTestSection("Tom team-seksjon", null, "test")
		const team = await createTeam(section.id, "Tomt team", null, "test")

		const result = await getTeamComplianceGaps(team.slug)

		expect(result).not.toBeNull()
		expect(result?.team.id).toBe(team.id)
		expect(result?.gaps).toHaveLength(0)
	})

	it("includes controls with no computed status and excludes assessed/inactive ones", async () => {
		const section = await insertTestSection("Seksjon med mangler", null, "test")
		const team = await createTeam(section.id, "Team med mangler", null, "test")

		const appId = await insertApp("app-med-mangler")
		await linkAppToTeam(appId, team.id)

		const gapControl = await insertFrameworkControl("K-GAP.01", "Kontroll uten status")
		const implementedControl = await insertFrameworkControl("K-GAP.02", "Implementert kontroll")
		const inactiveControl = await insertFrameworkControl("K-GAP.03", "Inaktiv kontroll")

		await insertApplicationControl(appId, gapControl, null)
		await insertApplicationControl(appId, implementedControl, "implemented")
		await insertApplicationControl(appId, inactiveControl, null, false)

		const result = await getTeamComplianceGaps(team.slug)

		expect(result).not.toBeNull()
		expect(result?.gaps).toHaveLength(1)
		expect(result?.gaps[0].controlCode).toBe("K-GAP.01")
		expect(result?.gaps[0].appId).toBe(appId)
	})

	it("carries the app's economy classification onto each gap row", async () => {
		const section = await insertTestSection("Seksjon med økonomisystem", null, "test")
		const team = await createTeam(section.id, "Team med økonomisystem", null, "test")

		const economyAppId = await insertApp("okonomi-app")
		await linkAppToTeam(economyAppId, team.id)
		await classifyEconomy(economyAppId, true)

		const nonEconomyAppId = await insertApp("ikke-okonomi-app")
		await linkAppToTeam(nonEconomyAppId, team.id)
		await classifyEconomy(nonEconomyAppId, false)

		const gapControl = await insertFrameworkControl("K-GAP.10", "Kontroll uten status")
		await insertApplicationControl(economyAppId, gapControl, null)
		await insertApplicationControl(nonEconomyAppId, gapControl, null)

		const result = await getTeamComplianceGaps(team.slug)

		expect(result).not.toBeNull()
		expect(result?.gaps).toHaveLength(2)
		const economyGap = result?.gaps.find((g) => g.appId === economyAppId)
		const nonEconomyGap = result?.gaps.find((g) => g.appId === nonEconomyAppId)
		expect(economyGap?.isEconomySystem).toBe(true)
		expect(nonEconomyGap?.isEconomySystem).toBe(false)
	})
})
