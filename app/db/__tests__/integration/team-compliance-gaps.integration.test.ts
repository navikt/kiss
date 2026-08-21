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
 * - Technology element name comes from the row-specific relational join
 *   (application_controls.technology_element_id), not the legacy framework text field
 * - Technology element is null when the row has no relational technology element id
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

async function insertFrameworkControl(
	controlId: string,
	shortTitle: string,
	options: { technologyElement?: string } = {},
): Promise<string> {
	const db = getTestDb()
	const [ctrl] = (
		await db.execute(
			sql`INSERT INTO framework_controls (control_id, short_title, requirement, technology_element)
				VALUES (${controlId}, ${shortTitle}, 'req', ${options.technologyElement ?? null}) RETURNING id`,
		)
	).rows as { id: string }[]
	return ctrl.id
}

async function insertTechnologyElement(name: string, slug: string): Promise<string> {
	const db = getTestDb()
	const [element] = (
		await db.execute(sql`INSERT INTO technology_elements (name, slug) VALUES (${name}, ${slug}) RETURNING id`)
	).rows as { id: string }[]
	return element.id
}

async function insertApplicationControl(
	appId: string,
	controlId: string,
	status: string | null,
	options: { isActive?: boolean; technologyElementId?: string | null } = {},
) {
	const { isActive = true, technologyElementId = null } = options
	const db = getTestDb()
	await db.execute(
		sql`INSERT INTO application_controls
			(application_id, control_id, status, is_active, activated_at, technology_element_id, created_by, updated_by)
			VALUES (${appId}, ${controlId}, ${status}, ${isActive}, NOW(), ${technologyElementId}, 'test', 'test')`,
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
			DELETE FROM technology_elements;
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
		await insertApplicationControl(appId, inactiveControl, null, { isActive: false })

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

	it("uses the row-specific relational technology element, not the legacy framework text", async () => {
		const section = await insertTestSection("Seksjon med teknologielement", null, "test")
		const team = await createTeam(section.id, "Team med teknologielement", null, "test")

		const appId = await insertApp("app-med-teknologielement")
		await linkAppToTeam(appId, team.id)

		const relatedElementId = await insertTechnologyElement("PostgreSQL", "postgresql")
		const gapControl = await insertFrameworkControl("K-GAP.20", "Kontroll med teknologielement", {
			technologyElement: "Legacy tekst som ikke skal brukes",
		})
		await insertApplicationControl(appId, gapControl, null, { technologyElementId: relatedElementId })

		const result = await getTeamComplianceGaps(team.slug)

		expect(result?.gaps).toHaveLength(1)
		expect(result?.gaps[0].technologyElement).toBe("PostgreSQL")
	})

	it("returns null technology element when the row has no relational technology element id", async () => {
		const section = await insertTestSection("Seksjon uten teknologielement", null, "test")
		const team = await createTeam(section.id, "Team uten teknologielement", null, "test")

		const appId = await insertApp("app-uten-teknologielement")
		await linkAppToTeam(appId, team.id)

		const gapControl = await insertFrameworkControl("K-GAP.21", "Kontroll uten teknologielement", {
			technologyElement: "Legacy tekst som ikke skal brukes",
		})
		await insertApplicationControl(appId, gapControl, null, { technologyElementId: null })

		const result = await getTeamComplianceGaps(team.slug)

		expect(result?.gaps).toHaveLength(1)
		expect(result?.gaps[0].technologyElement).toBeNull()
	})
})
