/**
 * Integration tests for getTeamIncompleteRoutines.
 *
 * Verifies:
 * - Non-existent team → null
 * - Team with no apps → empty deadlines
 * - Periodic section routine never reviewed → included in deadlines
 * - Non-periodic (frequency = null) routine → excluded from deadlines
 */
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

const { createSection, createTeam, getTeamIncompleteRoutines } = await import("~/db/queries/sections.server")
const { createRoutine } = await import("~/db/queries/routines.server")

describe("getTeamIncompleteRoutines", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	}, 120_000)

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM routine_review_participants;
			DELETE FROM routine_review_activities;
			DELETE FROM routine_review_links;
			DELETE FROM routine_review_attachments;
			DELETE FROM routine_reviews;
			DELETE FROM routine_controls;
			DELETE FROM routine_screening_questions;
			DELETE FROM routine_persistence_links;
			DELETE FROM routine_technology_elements;
			DELETE FROM routine_group_classification_links;
			DELETE FROM routine_oracle_role_criticality_links;
			DELETE FROM routines;
			DELETE FROM audit_log;
			DELETE FROM application_team_mappings;
			DELETE FROM application_environments;
			DELETE FROM section_ignored_applications;
			DELETE FROM section_environments;
			DELETE FROM monitored_applications;
			DELETE FROM dev_team_nais_team_mappings;
			DELETE FROM nais_teams;
			DELETE FROM dev_teams;
			DELETE FROM sections;
		`)
	})

	it("returns null for a non-existent team slug", async () => {
		const result = await getTeamIncompleteRoutines("slug-does-not-exist")
		expect(result).toBeNull()
	})

	it("returns empty deadlines for a team with no apps", async () => {
		const section = await createSection("Tom team-seksjon", null, "test")
		const team = await createTeam(section.id, "Tom team", null, "test")

		const result = await getTeamIncompleteRoutines(team.slug)

		expect(result).not.toBeNull()
		expect(result?.team.id).toBe(team.id)
		expect(result?.deadlines).toHaveLength(0)
	})

	it("includes a periodic section routine never reviewed in deadlines", async () => {
		const section = await createSection("Seksjon med rutine", null, "test")
		const team = await createTeam(section.id, "Team med app", null, "test")

		const db = getTestDb()
		const [app] = (
			await db.execute(
				/* sql */ `INSERT INTO monitored_applications (name, created_by, updated_by) VALUES ('test-app', 'test', 'test') RETURNING id`,
			)
		).rows as { id: string }[]
		await db.execute(
			/* sql */ `INSERT INTO application_team_mappings (application_id, dev_team_id, created_by) VALUES ('${app.id}', '${team.id}', 'test')`,
		)

		const routine = await createRoutine({
			sectionId: section.id,
			name: "Kvartalvis tilgangskontroll",
			description: null,
			frequency: "quarterly",
			screeningQuestionId: null,
			screeningChoiceValue: null,
			appliesToAllInSection: true,
			responsibleRole: null,
			isSectionRoutine: true,
			sectionRoutineOwnerRole: "Seksjonsleder",
			persistenceLinks: [],
			technologyElementIds: [],
			controlIds: [],
			groupClassifications: [],
			oracleRoleCriticalities: [],
			createdBy: "test",
		})
		await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)

		const result = await getTeamIncompleteRoutines(team.slug)

		expect(result).not.toBeNull()
		expect(result?.deadlines).toHaveLength(1)
		expect(result?.deadlines[0].routine?.id).toBe(routine.id)
		expect(result?.deadlines[0].lastReviewDate).toBeNull()
	})

	it("excludes routines with no frequency (event-only routines)", async () => {
		const section = await createSection("Seksjon hendelsesrutine", null, "test")
		const team = await createTeam(section.id, "Team hendelse", null, "test")

		const db = getTestDb()
		const [app] = (
			await db.execute(
				/* sql */ `INSERT INTO monitored_applications (name, created_by, updated_by) VALUES ('event-app', 'test', 'test') RETURNING id`,
			)
		).rows as { id: string }[]
		await db.execute(
			/* sql */ `INSERT INTO application_team_mappings (application_id, dev_team_id, created_by) VALUES ('${app.id}', '${team.id}', 'test')`,
		)

		const routine = await createRoutine({
			sectionId: section.id,
			name: "Hendelsesbasert rutine",
			description: null,
			frequency: null,
			eventFrequency: "Ved hendelse",
			screeningQuestionId: null,
			screeningChoiceValue: null,
			appliesToAllInSection: true,
			responsibleRole: null,
			isSectionRoutine: true,
			sectionRoutineOwnerRole: "Seksjonsleder",
			persistenceLinks: [],
			technologyElementIds: [],
			controlIds: [],
			groupClassifications: [],
			oracleRoleCriticalities: [],
			createdBy: "test",
		})
		await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)

		const result = await getTeamIncompleteRoutines(team.slug)

		expect(result).not.toBeNull()
		expect(result?.deadlines).toHaveLength(0)
	})
})
