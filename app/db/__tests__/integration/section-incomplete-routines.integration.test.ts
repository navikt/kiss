/**
 * Integration tests for getSectionIncompleteRoutines and countSectionRoutinesIncomplete.
 *
 * The functions use the application_controls compliance cache (matching_routine_ids)
 * and run a single bulk SQL query instead of a per-app pipeline.
 *
 * getSectionIncompleteRoutines verifies:
 * - Section with no apps → empty list
 * - Periodic routine never reviewed → included (isSectionRoutine=false)
 * - Routine with frequency=null → excluded
 * - Routine reviewed within the period → excluded
 * - Overdue routine (reviewed outside period) → included
 * - Section routine never reviewed → included (isSectionRoutine=true)
 * - Routine not in application_controls cache → excluded
 *
 * countSectionRoutinesIncomplete verifies:
 * - No apps → 0
 * - Same section routine matching via multiple apps → counted once (distinct)
 * - Section routine reviewed within the frequency period → excluded
 * - App routine (not section routine) → not counted
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

const { createSection, createTeam, getSectionIncompleteRoutines, countSectionRoutinesIncomplete } = await import(
	"~/db/queries/sections.server"
)
const { createRoutine } = await import("~/db/queries/routines.server")

async function insertApp(name: string): Promise<string> {
	const db = getTestDb()
	const [row] = (
		await db.execute(
			/* sql */ `INSERT INTO monitored_applications (name, created_by, updated_by) VALUES ('${name}', 'Z990001', 'Z990001') RETURNING id`,
		)
	).rows as { id: string }[]
	return row.id
}

async function linkAppToTeam(appId: string, teamId: string): Promise<void> {
	const db = getTestDb()
	await db.execute(
		/* sql */ `INSERT INTO application_team_mappings (application_id, dev_team_id, created_by) VALUES ('${appId}', '${teamId}', 'Z990001')`,
	)
}

async function insertFrameworkControl(): Promise<string> {
	const db = getTestDb()
	const [row] = (
		await db.execute(
			/* sql */ `INSERT INTO framework_controls (control_id) VALUES ('K-TEST.${Date.now()}') RETURNING id`,
		)
	).rows as { id: string }[]
	return row.id
}

async function insertApplicationControl(appId: string, controlId: string, routineIds: string[]): Promise<void> {
	const db = getTestDb()
	const idsArray = routineIds.map((id) => `'${id}'`).join(", ")
	await db.execute(
		/* sql */ `
		INSERT INTO application_controls
			(application_id, control_id, status, establishment, routine_compliance,
			 routines_established, routines_completed, routines_overdue,
			 match_sources, matching_routine_ids, is_screening_derived, created_by, updated_by)
		VALUES
			('${appId}', '${controlId}', NULL, 'not_established', 'not_applicable',
			 0, 0, 0, '{}', ARRAY[${idsArray}]::uuid[], false, 'Z990001', 'Z990001')
	`,
	)
}

async function insertCompletedReview(routineId: string, applicationId: string | null, reviewedAt: Date): Promise<void> {
	const db = getTestDb()
	const appIdValue = applicationId ? `'${applicationId}'` : "NULL"
	await db.execute(
		/* sql */ `
		INSERT INTO routine_reviews
			(routine_id, application_id, title, status, reviewed_at, created_by)
		VALUES
			('${routineId}', ${appIdValue}, 'Testgjennomgang', 'completed', '${reviewedAt.toISOString()}', 'Z990001')
	`,
	)
}

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
		DELETE FROM application_controls;
		DELETE FROM application_team_mappings;
		DELETE FROM application_environments;
		DELETE FROM section_ignored_applications;
		DELETE FROM section_environments;
		DELETE FROM monitored_applications;
		DELETE FROM dev_team_nais_team_mappings;
		DELETE FROM nais_teams;
		DELETE FROM dev_teams;
		DELETE FROM framework_controls;
		DELETE FROM sections;
	`)
})

describe("getSectionIncompleteRoutines", () => {
	it("returns empty list when section has no apps", async () => {
		const section = await createSection("Tom seksjon", null, "Z990001")

		const result = await getSectionIncompleteRoutines(section.id)

		expect(result).toHaveLength(0)
	})

	it("includes a periodic app routine that has never been reviewed", async () => {
		const section = await createSection("Seksjon med rutine", null, "Z990001")
		const team = await createTeam(section.id, "Team Elv", null, "Z990001")
		const appId = await insertApp("Rask Elv App")
		await linkAppToTeam(appId, team.id)
		const controlId = await insertFrameworkControl()

		const routine = await createRoutine({
			sectionId: section.id,
			name: "Kvartalvis tilgangskontroll",
			description: null,
			frequency: "quarterly",
			screeningQuestionId: null,
			screeningChoiceValue: null,
			appliesToAllInSection: false,
			responsibleRole: null,
			isSectionRoutine: false,
			sectionRoutineOwnerRole: null,
			persistenceLinks: [],
			technologyElementIds: [],
			controlIds: [],
			groupClassifications: [],
			oracleRoleCriticalities: [],
			createdBy: "Z990001",
		})
		const db = getTestDb()
		await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)

		await insertApplicationControl(appId, controlId, [routine.id])

		const result = await getSectionIncompleteRoutines(section.id)

		expect(result).toHaveLength(1)
		expect(result[0].routineId).toBe(routine.id)
		expect(result[0].applicationId).toBe(appId)
		expect(result[0].lastReviewDate).toBeNull()
		expect(result[0].isSectionRoutine).toBe(false)
	})

	it("excludes routines with frequency=null (event-only routines)", async () => {
		const section = await createSection("Seksjon hendelse", null, "Z990001")
		const team = await createTeam(section.id, "Team Fjord", null, "Z990001")
		const appId = await insertApp("Stille Fjord App")
		await linkAppToTeam(appId, team.id)
		const controlId = await insertFrameworkControl()

		const routine = await createRoutine({
			sectionId: section.id,
			name: "Hendelsesbasert rutine",
			description: null,
			frequency: null,
			eventFrequency: "Ved hendelse",
			screeningQuestionId: null,
			screeningChoiceValue: null,
			appliesToAllInSection: false,
			responsibleRole: null,
			isSectionRoutine: false,
			sectionRoutineOwnerRole: null,
			persistenceLinks: [],
			technologyElementIds: [],
			controlIds: [],
			groupClassifications: [],
			oracleRoleCriticalities: [],
			createdBy: "Z990001",
		})
		const db = getTestDb()
		await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)

		await insertApplicationControl(appId, controlId, [routine.id])

		const result = await getSectionIncompleteRoutines(section.id)

		expect(result).toHaveLength(0)
	})

	it("excludes routines reviewed within the frequency period", async () => {
		const section = await createSection("Seksjon nylig gjennomgått", null, "Z990001")
		const team = await createTeam(section.id, "Team Skog", null, "Z990001")
		const appId = await insertApp("Glad Skog App")
		await linkAppToTeam(appId, team.id)
		const controlId = await insertFrameworkControl()

		const routine = await createRoutine({
			sectionId: section.id,
			name: "Månedlig tilgangskontroll",
			description: null,
			frequency: "monthly",
			screeningQuestionId: null,
			screeningChoiceValue: null,
			appliesToAllInSection: false,
			responsibleRole: null,
			isSectionRoutine: false,
			sectionRoutineOwnerRole: null,
			persistenceLinks: [],
			technologyElementIds: [],
			controlIds: [],
			groupClassifications: [],
			oracleRoleCriticalities: [],
			createdBy: "Z990001",
		})
		const db = getTestDb()
		await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)

		await insertApplicationControl(appId, controlId, [routine.id])

		// Review done 10 days ago — within the 30-day monthly period
		const recentReview = new Date()
		recentReview.setDate(recentReview.getDate() - 10)
		await insertCompletedReview(routine.id, appId, recentReview)

		const result = await getSectionIncompleteRoutines(section.id)

		expect(result).toHaveLength(0)
	})

	it("includes routines reviewed outside the frequency period (overdue)", async () => {
		const section = await createSection("Seksjon forfalt", null, "Z990001")
		const team = await createTeam(section.id, "Team Bjørk", null, "Z990001")
		const appId = await insertApp("Modig Bjørk App")
		await linkAppToTeam(appId, team.id)
		const controlId = await insertFrameworkControl()

		const routine = await createRoutine({
			sectionId: section.id,
			name: "Kvartalvis sikkerhetsvurdering",
			description: null,
			frequency: "quarterly",
			screeningQuestionId: null,
			screeningChoiceValue: null,
			appliesToAllInSection: false,
			responsibleRole: null,
			isSectionRoutine: false,
			sectionRoutineOwnerRole: null,
			persistenceLinks: [],
			technologyElementIds: [],
			controlIds: [],
			groupClassifications: [],
			oracleRoleCriticalities: [],
			createdBy: "Z990001",
		})
		const db = getTestDb()
		await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)

		await insertApplicationControl(appId, controlId, [routine.id])

		// Review done 200 days ago — outside the 91-day quarterly period
		const oldReview = new Date()
		oldReview.setDate(oldReview.getDate() - 200)
		await insertCompletedReview(routine.id, appId, oldReview)

		const result = await getSectionIncompleteRoutines(section.id)

		expect(result).toHaveLength(1)
		expect(result[0].routineId).toBe(routine.id)
		expect(result[0].lastReviewDate).not.toBeNull()
	})

	it("includes section routine never reviewed and marks isSectionRoutine=true", async () => {
		const section = await createSection("Seksjon seksjonsrutine", null, "Z990001")
		const team = await createTeam(section.id, "Team Vind", null, "Z990001")
		const appId = await insertApp("Frisk Vind App")
		await linkAppToTeam(appId, team.id)
		const controlId = await insertFrameworkControl()

		const routine = await createRoutine({
			sectionId: section.id,
			name: "Halvårlig seksjonsgjennomgang",
			description: null,
			frequency: "semi_annually",
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
			createdBy: "Z990001",
		})
		const db = getTestDb()
		await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)

		await insertApplicationControl(appId, controlId, [routine.id])

		const result = await getSectionIncompleteRoutines(section.id)

		expect(result).toHaveLength(1)
		expect(result[0].routineId).toBe(routine.id)
		expect(result[0].isSectionRoutine).toBe(true)
		expect(result[0].lastReviewDate).toBeNull()
	})

	it("excludes routines not in application_controls cache", async () => {
		const section = await createSection("Seksjon ikke i cache", null, "Z990001")
		const team = await createTeam(section.id, "Team Sol", null, "Z990001")
		const appId = await insertApp("Sterk Sol App")
		await linkAppToTeam(appId, team.id)

		// Routine created but NOT inserted into application_controls
		const routine = await createRoutine({
			sectionId: section.id,
			name: "Rutine uten kontrollkobling",
			description: null,
			frequency: "monthly",
			screeningQuestionId: null,
			screeningChoiceValue: null,
			appliesToAllInSection: false,
			responsibleRole: null,
			isSectionRoutine: false,
			sectionRoutineOwnerRole: null,
			persistenceLinks: [],
			technologyElementIds: [],
			controlIds: [],
			groupClassifications: [],
			oracleRoleCriticalities: [],
			createdBy: "Z990001",
		})
		const db = getTestDb()
		await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)

		const result = await getSectionIncompleteRoutines(section.id)

		// Not in cache → not shown on the mangler page
		expect(result).toHaveLength(0)
	})
})

describe("countSectionRoutinesIncomplete", () => {
	it("returns 0 when appIds list is empty", async () => {
		const result = await countSectionRoutinesIncomplete([])
		expect(result).toBe(0)
	})

	it("counts a section routine that has never been reviewed", async () => {
		const section = await createSection("Tyst Fjord Seksjon", null, "Z990001")
		const team = await createTeam(section.id, "Team Fjord", null, "Z990001")
		const appId = await insertApp("Stille Fjord App")
		await linkAppToTeam(appId, team.id)
		const controlId = await insertFrameworkControl()

		const routine = await createRoutine({
			sectionId: section.id,
			name: "Årslig seksjonsgjennomgang",
			description: null,
			frequency: "annually",
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
			createdBy: "Z990001",
		})
		const db = getTestDb()
		await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)
		await insertApplicationControl(appId, controlId, [routine.id])

		const result = await countSectionRoutinesIncomplete([appId])
		expect(result).toBe(1)
	})

	it("counts the same section routine only once when it matches via multiple apps", async () => {
		const section = await createSection("Grønn Dal Seksjon", null, "Z990001")
		const team = await createTeam(section.id, "Team Dal", null, "Z990001")
		const appId1 = await insertApp("Grønn Dal App 1")
		const appId2 = await insertApp("Grønn Dal App 2")
		await linkAppToTeam(appId1, team.id)
		await linkAppToTeam(appId2, team.id)
		const controlId = await insertFrameworkControl()

		const routine = await createRoutine({
			sectionId: section.id,
			name: "Felles seksjonsrutine",
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
			createdBy: "Z990001",
		})
		const db = getTestDb()
		await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)
		// Same routine in application_controls for both apps
		await insertApplicationControl(appId1, controlId, [routine.id])
		const controlId2 = await insertFrameworkControl()
		await insertApplicationControl(appId2, controlId2, [routine.id])

		const result = await countSectionRoutinesIncomplete([appId1, appId2])
		// Should be 1, not 2 — distinct count
		expect(result).toBe(1)
	})

	it("excludes a section routine reviewed within the frequency period", async () => {
		const section = await createSection("Blå Topp Seksjon", null, "Z990001")
		const team = await createTeam(section.id, "Team Topp", null, "Z990001")
		const appId = await insertApp("Blå Topp App")
		await linkAppToTeam(appId, team.id)
		const controlId = await insertFrameworkControl()

		const routine = await createRoutine({
			sectionId: section.id,
			name: "Månedlig seksjonsrutine",
			description: null,
			frequency: "monthly",
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
			createdBy: "Z990001",
		})
		const db = getTestDb()
		await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)
		await insertApplicationControl(appId, controlId, [routine.id])

		// Reviewed 5 days ago — within 30-day monthly period
		const recentReview = new Date()
		recentReview.setDate(recentReview.getDate() - 5)
		await insertCompletedReview(routine.id, null, recentReview)

		const result = await countSectionRoutinesIncomplete([appId])
		expect(result).toBe(0)
	})

	it("does not count app routines (only section routines)", async () => {
		const section = await createSection("Rask Skog Seksjon", null, "Z990001")
		const team = await createTeam(section.id, "Team Skog", null, "Z990001")
		const appId = await insertApp("Rask Skog App")
		await linkAppToTeam(appId, team.id)
		const controlId = await insertFrameworkControl()

		const routine = await createRoutine({
			sectionId: section.id,
			name: "Applikasjonsrutine (ikke seksjonsrutine)",
			description: null,
			frequency: "monthly",
			screeningQuestionId: null,
			screeningChoiceValue: null,
			appliesToAllInSection: false,
			responsibleRole: null,
			isSectionRoutine: false,
			sectionRoutineOwnerRole: null,
			persistenceLinks: [],
			technologyElementIds: [],
			controlIds: [],
			groupClassifications: [],
			oracleRoleCriticalities: [],
			createdBy: "Z990001",
		})
		const db = getTestDb()
		await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)
		await insertApplicationControl(appId, controlId, [routine.id])

		const result = await countSectionRoutinesIncomplete([appId])
		// App routines should not be counted — only section routines
		expect(result).toBe(0)
	})
})
