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

// Import AFTER mocking
const {
	createRoutine,
	updateRoutine,
	createReview,
	copyRoutine,
	autoCreateActivitiesForReview,
	getRoutine,
	getRoutineActivityLinks,
	reorderRoutineActivities,
	getReviewActivityByType,
	getReviewActivities,
	seedManualActivity,
} = await import("~/db/queries/routines.server")

// ─── Helpers ─────────────────────────────────────────────────────────────

async function createTestSection(name: string, slug: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO sections (name, slug, created_by, updated_by) VALUES ('${name}', '${slug}', 'test', 'test') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function createTestApp(name: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO monitored_applications (name, created_by, updated_by) VALUES ('${name}', 'test', 'test') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function markRoutineApproved(routineId: string) {
	const db = getTestDb()
	await db.execute(/* sql */ `UPDATE routines SET status = 'approved', updated_by = 'test' WHERE id = '${routineId}'`)
}

// ─── Test Suite ──────────────────────────────────────────────────────────

describe("Routine Activity Links integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	})

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM routine_review_activity_entra_changes;
			DELETE FROM routine_review_evidence_downloads;
			DELETE FROM routine_review_activities;
			DELETE FROM routine_review_attachments;
			DELETE FROM routine_review_participants;
			DELETE FROM routine_reviews;
			DELETE FROM routine_activity_links;
			DELETE FROM routine_persistence_links;
			DELETE FROM routine_group_classification_links;
			DELETE FROM routine_oracle_role_criticality_links;
			DELETE FROM routine_screening_questions;
			DELETE FROM routine_controls;
			DELETE FROM routine_technology_elements;
			DELETE FROM ruleset_routines;
			DELETE FROM rulesets;
			DELETE FROM routines;
			DELETE FROM monitored_applications;
			DELETE FROM sections;
			DELETE FROM audit_log;
		`)
	})

	// ─── createRoutine with activityTypes ────────────────────────────────

	describe("createRoutine with activityTypes", () => {
		it("creates activity links with correct sort order", async () => {
			const sectionId = await createTestSection("Test", "test")

			const routine = await createRoutine({
				sectionId,
				name: "Multi-activity routine",
				description: null,
				frequency: "quarterly",
				activityTypes: ["oracle_evidence_audit", "entra_id_group_maintenance"],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			const links = await getRoutineActivityLinks(routine.id)
			expect(links).toHaveLength(2)
			expect(links[0].activityType).toBe("oracle_evidence_audit")
			expect(links[0].sortOrder).toBe(0)
			expect(links[1].activityType).toBe("entra_id_group_maintenance")
			expect(links[1].sortOrder).toBe(1)
		})

		it("creates no links for section routines even with activityTypes", async () => {
			const sectionId = await createTestSection("Test", "test")

			const routine = await createRoutine({
				sectionId,
				name: "Section routine",
				description: null,
				frequency: "quarterly",
				isSectionRoutine: true,
				sectionRoutineOwnerRole: "seksjonsleder",
				activityTypes: ["oracle_evidence_audit"],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: true,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			const links = await getRoutineActivityLinks(routine.id)
			expect(links).toHaveLength(0)
		})

		it("creates no links when activityTypes is empty", async () => {
			const sectionId = await createTestSection("Test", "test")

			const routine = await createRoutine({
				sectionId,
				name: "No activities",
				description: null,
				frequency: "quarterly",
				activityTypes: [],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			const links = await getRoutineActivityLinks(routine.id)
			expect(links).toHaveLength(0)
		})
	})

	// ─── getRoutineActivityLinks ─────────────────────────────────────────

	describe("getRoutineActivityLinks", () => {
		it("excludes archived links", async () => {
			const sectionId = await createTestSection("Test", "test")
			const db = getTestDb()

			const routine = await createRoutine({
				sectionId,
				name: "Archive test",
				description: null,
				frequency: "quarterly",
				activityTypes: ["oracle_evidence_audit", "entra_id_group_maintenance"],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			// Archive one link
			await db.execute(/* sql */ `
				UPDATE routine_activity_links
				SET archived_at = NOW(), archived_by = 'test'
				WHERE routine_id = '${routine.id}' AND activity_type = 'oracle_evidence_audit'
			`)

			const links = await getRoutineActivityLinks(routine.id)
			expect(links).toHaveLength(1)
			expect(links[0].activityType).toBe("entra_id_group_maintenance")
		})

		it("returns links in sort order", async () => {
			const sectionId = await createTestSection("Test", "test")

			const routine = await createRoutine({
				sectionId,
				name: "Ordered",
				description: null,
				frequency: "quarterly",
				activityTypes: ["entra_id_group_maintenance", "oracle_evidence_audit", "deployment_evidence_report"],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			const links = await getRoutineActivityLinks(routine.id)
			expect(links.map((l) => l.activityType)).toEqual([
				"entra_id_group_maintenance",
				"oracle_evidence_audit",
				"deployment_evidence_report",
			])
			expect(links.map((l) => l.sortOrder)).toEqual([0, 1, 2])
		})

		it("getRoutine returns activityTypes in sortOrder", async () => {
			const sectionId = await createTestSection("Test", "test")

			const routine = await createRoutine({
				sectionId,
				name: "getRoutine activity order",
				description: null,
				frequency: "quarterly",
				activityTypes: ["entra_id_group_maintenance", "oracle_evidence_audit", "deployment_evidence_report"],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			const fetched = await getRoutine(routine.id)
			expect(fetched).not.toBeNull()
			expect(fetched?.activityTypes).toEqual([
				"entra_id_group_maintenance",
				"oracle_evidence_audit",
				"deployment_evidence_report",
			])
		})

		it("getRoutine reflects updated sortOrder after reorder", async () => {
			const sectionId = await createTestSection("Test", "test")

			const routine = await createRoutine({
				sectionId,
				name: "getRoutine reorder check",
				description: null,
				frequency: "quarterly",
				activityTypes: ["oracle_evidence_audit", "entra_id_group_maintenance"],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			const links = await getRoutineActivityLinks(routine.id)
			const reversedIds = [...links].reverse().map((l) => l.id)
			await reorderRoutineActivities(routine.id, reversedIds, "Z990001")

			const fetched = await getRoutine(routine.id)
			expect(fetched?.activityTypes).toEqual(["entra_id_group_maintenance", "oracle_evidence_audit"])
		})
	})

	// ─── reorderRoutineActivities ────────────────────────────────────────

	describe("reorderRoutineActivities", () => {
		it("updates sort order for all links", async () => {
			const sectionId = await createTestSection("Test", "test")

			const routine = await createRoutine({
				sectionId,
				name: "Reorder test",
				description: null,
				frequency: "quarterly",
				activityTypes: ["oracle_evidence_audit", "entra_id_group_maintenance", "deployment_evidence_report"],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			const links = await getRoutineActivityLinks(routine.id)
			// Reverse the order
			const reversedIds = [...links].reverse().map((l) => l.id)

			await reorderRoutineActivities(routine.id, reversedIds, "Z990001")

			const reordered = await getRoutineActivityLinks(routine.id)
			expect(reordered.map((l) => l.activityType)).toEqual([
				"deployment_evidence_report",
				"entra_id_group_maintenance",
				"oracle_evidence_audit",
			])
		})

		it("only updates links belonging to the specified routine", async () => {
			const sectionId = await createTestSection("Test", "test")

			const routine1 = await createRoutine({
				sectionId,
				name: "Routine 1",
				description: null,
				frequency: "quarterly",
				activityTypes: ["oracle_evidence_audit", "entra_id_group_maintenance"],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			const routine2 = await createRoutine({
				sectionId,
				name: "Routine 2",
				description: null,
				frequency: "monthly",
				activityTypes: ["deployment_evidence_report"],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			const links1 = await getRoutineActivityLinks(routine1.id)
			const reversedIds = [...links1].reverse().map((l) => l.id)

			await reorderRoutineActivities(routine1.id, reversedIds, "Z990001")

			// routine2 should be unaffected
			const links2 = await getRoutineActivityLinks(routine2.id)
			expect(links2).toHaveLength(1)
			expect(links2[0].activityType).toBe("deployment_evidence_report")
			expect(links2[0].sortOrder).toBe(0)
		})

		it("rejects when IDs are omitted (subset of actual links)", async () => {
			const sectionId = await createTestSection("Test", "test")
			const routine = await createRoutine({
				sectionId,
				name: "Reject subset",
				description: null,
				frequency: "quarterly",
				activityTypes: ["oracle_evidence_audit", "entra_id_group_maintenance"],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})
			const links = await getRoutineActivityLinks(routine.id)
			// Only supply one of two IDs
			await expect(reorderRoutineActivities(routine.id, [links[0].id], "Z990001")).rejects.toThrow(
				"orderedIds must exactly match",
			)
		})

		it("rejects when IDs contain duplicates", async () => {
			const sectionId = await createTestSection("Test", "test")
			const routine = await createRoutine({
				sectionId,
				name: "Reject duplicates",
				description: null,
				frequency: "quarterly",
				activityTypes: ["oracle_evidence_audit", "entra_id_group_maintenance"],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})
			const links = await getRoutineActivityLinks(routine.id)
			// Duplicate first ID
			await expect(reorderRoutineActivities(routine.id, [links[0].id, links[0].id], "Z990001")).rejects.toThrow(
				"orderedIds must exactly match",
			)
		})

		it("rejects when IDs belong to another routine", async () => {
			const sectionId = await createTestSection("Test", "test")
			const routine1 = await createRoutine({
				sectionId,
				name: "Routine A",
				description: null,
				frequency: "quarterly",
				activityTypes: ["oracle_evidence_audit"],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})
			const routine2 = await createRoutine({
				sectionId,
				name: "Routine B",
				description: null,
				frequency: "quarterly",
				activityTypes: ["entra_id_group_maintenance"],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})
			const links2 = await getRoutineActivityLinks(routine2.id)
			// Try to reorder routine1 with routine2's IDs
			await expect(reorderRoutineActivities(routine1.id, [links2[0].id], "Z990001")).rejects.toThrow(
				"orderedIds must exactly match",
			)
		})
	})

	// ─── autoCreateActivitiesForReview ───────────────────────────────────

	describe("autoCreateActivitiesForReview", () => {
		it("creates review activities from routine activity links", async () => {
			const sectionId = await createTestSection("Test", "test")
			const appId = await createTestApp("Test app")

			const routine = await createRoutine({
				sectionId,
				name: "Auto-create test",
				description: null,
				frequency: "quarterly",
				activityTypes: ["oracle_evidence_audit", "entra_id_group_maintenance"],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})
			await markRoutineApproved(routine.id)

			const review = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "Test review",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "Z990001",
				participants: [],
			})

			await autoCreateActivitiesForReview(review.id, routine.id, appId, "Z990001")

			const activities = await getReviewActivities(review.id)
			expect(activities).toHaveLength(2)
			const types = activities.map((a) => a.type)
			expect(types).toContain("oracle_evidence_audit")
			expect(types).toContain("entra_id_group_maintenance")
		})

		it("handles duplicate calls without error (onConflictDoNothing)", async () => {
			const sectionId = await createTestSection("Test", "test")
			const appId = await createTestApp("Test app")

			const routine = await createRoutine({
				sectionId,
				name: "Idempotent test",
				description: null,
				frequency: "quarterly",
				activityTypes: ["oracle_evidence_audit"],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})
			await markRoutineApproved(routine.id)

			const review = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "Test review",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "Z990001",
				participants: [],
			})

			// Call twice — second should be a no-op
			await autoCreateActivitiesForReview(review.id, routine.id, appId, "Z990001")
			await autoCreateActivitiesForReview(review.id, routine.id, appId, "Z990001")

			const activities = await getReviewActivities(review.id)
			expect(activities).toHaveLength(1)
		})

		it("passes providerConfigs to created activities", async () => {
			const sectionId = await createTestSection("Test", "test")
			const appId = await createTestApp("Test app")

			const routine = await createRoutine({
				sectionId,
				name: "Config test",
				description: null,
				frequency: "quarterly",
				activityTypes: ["oracle_evidence_audit"],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})
			await markRoutineApproved(routine.id)

			const review = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "Test review",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "Z990001",
				participants: [],
			})

			await autoCreateActivitiesForReview(review.id, routine.id, appId, "Z990001", {
				oracle_evidence_audit: { instanceId: "PENSJON_PROD" },
			})

			const activities = await getReviewActivities(review.id)
			expect(activities).toHaveLength(1)
			expect(activities[0].providerConfig).toEqual({ instanceId: "PENSJON_PROD" })
		})
	})

	// ─── getReviewActivityByType ─────────────────────────────────────────

	describe("getReviewActivityByType", () => {
		it("returns the activity matching the specified type", async () => {
			const sectionId = await createTestSection("Test", "test")
			const appId = await createTestApp("Test app")

			const routine = await createRoutine({
				sectionId,
				name: "By-type test",
				description: null,
				frequency: "quarterly",
				activityTypes: ["oracle_evidence_audit", "entra_id_group_maintenance"],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})
			await markRoutineApproved(routine.id)

			const review = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "Test review",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "Z990001",
				participants: [],
			})

			await autoCreateActivitiesForReview(review.id, routine.id, appId, "Z990001")

			const entraActivity = await getReviewActivityByType(review.id, "entra_id_group_maintenance")
			expect(entraActivity).not.toBeNull()
			expect(entraActivity?.type).toBe("entra_id_group_maintenance")

			const oracleActivity = await getReviewActivityByType(review.id, "oracle_evidence_audit")
			expect(oracleActivity).not.toBeNull()
			expect(oracleActivity?.type).toBe("oracle_evidence_audit")
		})

		it("returns null when type does not exist", async () => {
			const sectionId = await createTestSection("Test", "test")
			const appId = await createTestApp("Test app")

			const routine = await createRoutine({
				sectionId,
				name: "Missing type",
				description: null,
				frequency: "quarterly",
				activityTypes: ["oracle_evidence_audit"],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})
			await markRoutineApproved(routine.id)

			const review = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "Test review",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "Z990001",
				participants: [],
			})

			await autoCreateActivitiesForReview(review.id, routine.id, appId, "Z990001")

			const result = await getReviewActivityByType(review.id, "entra_id_group_maintenance")
			expect(result).toBeNull()
		})
	})

	// ─── updateRoutine activity links diff ───────────────────────────────

	describe("updateRoutine activity links", () => {
		it("replaces activity links when types change", async () => {
			const sectionId = await createTestSection("Test", "test")

			const routine = await createRoutine({
				sectionId,
				name: "Update links",
				description: null,
				frequency: "quarterly",
				activityTypes: ["oracle_evidence_audit", "entra_id_group_maintenance"],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			await updateRoutine({
				id: routine.id,
				name: "Update links",
				description: null,
				frequency: "quarterly",
				activityTypes: ["deployment_evidence_report"],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				updatedBy: "Z990001",
			})

			const links = await getRoutineActivityLinks(routine.id)
			expect(links).toHaveLength(1)
			expect(links[0].activityType).toBe("deployment_evidence_report")
			expect(links[0].sortOrder).toBe(0)
		})

		it("does not touch links when types are unchanged", async () => {
			const sectionId = await createTestSection("Test", "test")

			const routine = await createRoutine({
				sectionId,
				name: "No change",
				description: null,
				frequency: "quarterly",
				activityTypes: ["oracle_evidence_audit"],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			const linksBefore = await getRoutineActivityLinks(routine.id)

			await updateRoutine({
				id: routine.id,
				name: "No change renamed",
				description: null,
				frequency: "quarterly",
				activityTypes: ["oracle_evidence_audit"],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				updatedBy: "Z990001",
			})

			const linksAfter = await getRoutineActivityLinks(routine.id)
			// Same IDs = links weren't touched
			expect(linksAfter.map((l) => l.id)).toEqual(linksBefore.map((l) => l.id))
		})

		it("clears activity links when converting to section routine", async () => {
			const sectionId = await createTestSection("Test", "test")

			const routine = await createRoutine({
				sectionId,
				name: "Section convert",
				description: null,
				frequency: "quarterly",
				activityTypes: ["oracle_evidence_audit", "entra_id_group_maintenance"],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			await updateRoutine({
				id: routine.id,
				name: "Section convert",
				description: null,
				frequency: "quarterly",
				isSectionRoutine: true,
				sectionRoutineOwnerRole: "seksjonsleder",
				activityTypes: ["oracle_evidence_audit"],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: true,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				updatedBy: "Z990001",
			})

			const links = await getRoutineActivityLinks(routine.id)
			expect(links).toHaveLength(0)
		})

		it("preserves existing activity links when activityTypes is omitted", async () => {
			// Regression test: updateRoutine must NOT archive/recreate links when
			// neither activityTypes nor isSectionRoutine:true is provided.
			// isSectionRoutine:false alone must not trigger a link sync.
			const sectionId = await createTestSection("Test", "test")

			const routine = await createRoutine({
				sectionId,
				name: "Preserve links",
				description: null,
				frequency: "quarterly",
				activityTypes: ["oracle_evidence_audit", "entra_id_group_maintenance"],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			const linksBefore = await getRoutineActivityLinks(routine.id)
			expect(linksBefore).toHaveLength(2)

			// Update only metadata — no activityTypes, no isSectionRoutine
			await updateRoutine({
				id: routine.id,
				name: "Preserve links renamed",
				description: "ny beskrivelse",
				frequency: "monthly",
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				updatedBy: "Z990001",
			})

			const linksAfter = await getRoutineActivityLinks(routine.id)
			// Links must be identical — same IDs, same types, same order
			expect(linksAfter.map((l) => l.id)).toEqual(linksBefore.map((l) => l.id))
			expect(linksAfter.map((l) => l.activityType)).toEqual(linksBefore.map((l) => l.activityType))
		})

		it("preserves existing activity links when only isSectionRoutine:false is provided", async () => {
			// Regression test: isSectionRoutine:false without activityTypes must not clear links.
			const sectionId = await createTestSection("Test", "test")

			const routine = await createRoutine({
				sectionId,
				name: "Preserve links isSectionRoutine false",
				description: null,
				frequency: "quarterly",
				activityTypes: ["oracle_evidence_audit"],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			const linksBefore = await getRoutineActivityLinks(routine.id)
			expect(linksBefore).toHaveLength(1)

			await updateRoutine({
				id: routine.id,
				name: "Preserve links isSectionRoutine false",
				description: null,
				frequency: "quarterly",
				isSectionRoutine: false,
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				updatedBy: "Z990001",
			})

			const linksAfter = await getRoutineActivityLinks(routine.id)
			expect(linksAfter.map((l) => l.id)).toEqual(linksBefore.map((l) => l.id))
		})
	})

	// ─── copyRoutine with activity links ─────────────────────────────────

	describe("copyRoutine with activity links", () => {
		it("copies activity links to new routine", async () => {
			const sectionId = await createTestSection("Test", "test")

			const routine = await createRoutine({
				sectionId,
				name: "Copy source",
				description: null,
				frequency: "quarterly",
				activityTypes: ["oracle_evidence_audit", "entra_id_group_maintenance", "deployment_evidence_report"],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})
			await markRoutineApproved(routine.id)

			const copy = await copyRoutine(routine.id, "Z990001")
			expect(copy).not.toBeNull()
			const copyId = copy?.id as string

			const sourceLinks = await getRoutineActivityLinks(routine.id)
			const copyLinks = await getRoutineActivityLinks(copyId)

			expect(copyLinks).toHaveLength(sourceLinks.length)
			expect(copyLinks.map((l) => l.activityType)).toEqual(sourceLinks.map((l) => l.activityType))
			expect(copyLinks.map((l) => l.sortOrder)).toEqual(sourceLinks.map((l) => l.sortOrder))
			// IDs should be different
			expect(copyLinks.map((l) => l.id)).not.toEqual(sourceLinks.map((l) => l.id))
		})

		it("does not copy archived links", async () => {
			const sectionId = await createTestSection("Test", "test")
			const db = getTestDb()

			const routine = await createRoutine({
				sectionId,
				name: "Copy archived",
				description: null,
				frequency: "quarterly",
				activityTypes: ["oracle_evidence_audit", "entra_id_group_maintenance"],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})
			await markRoutineApproved(routine.id)

			// Archive one link
			await db.execute(/* sql */ `
				UPDATE routine_activity_links
				SET archived_at = NOW(), archived_by = 'test'
				WHERE routine_id = '${routine.id}' AND activity_type = 'oracle_evidence_audit'
			`)

			const copy = await copyRoutine(routine.id, "Z990001")
			expect(copy).not.toBeNull()
			const copyId = copy?.id as string

			const copyLinks = await getRoutineActivityLinks(copyId)
			expect(copyLinks).toHaveLength(1)
			expect(copyLinks[0].activityType).toBe("entra_id_group_maintenance")
		})

		it("copies manual_activity stepTitle and stepDescription", async () => {
			const sectionId = await createTestSection("Test", "copy-checklist-step")

			const routine = await createRoutine({
				sectionId,
				name: "Kopier sjekkliste-steg",
				description: null,
				frequency: "quarterly",
				activityItems: [
					{ type: "manual_activity", stepTitle: "Steg A", stepDescription: "Beskrivelse A" },
					{ type: "manual_activity", stepTitle: "Steg B", stepDescription: null },
				],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})
			await markRoutineApproved(routine.id)

			const copy = await copyRoutine(routine.id, "Z990001")
			expect(copy).not.toBeNull()
			const copyId = copy?.id as string

			const copyLinks = await getRoutineActivityLinks(copyId)
			expect(copyLinks).toHaveLength(2)
			expect(copyLinks[0].stepTitle).toBe("Steg A")
			expect(copyLinks[0].stepDescription).toBe("Beskrivelse A")
			expect(copyLinks[1].stepTitle).toBe("Steg B")
			expect(copyLinks[1].stepDescription).toBeNull()
		})
	})

	// ─── createRoutine with activityItems (manual_activity) ─────────────

	describe("createRoutine with activityItems (manual_activity)", () => {
		it("stores stepTitle and stepDescription for manual_activity items", async () => {
			const sectionId = await createTestSection("Test", "checklist-create")

			const routine = await createRoutine({
				sectionId,
				name: "Rutine med sjekkliste-steg",
				description: null,
				frequency: "quarterly",
				activityItems: [
					{
						type: "manual_activity",
						stepTitle: "Verifiser tilgang",
						stepDescription: "Sjekk at alle brukere har rett tilgang",
					},
					{ type: "manual_activity", stepTitle: "Oppdater dokumentasjon", stepDescription: null },
				],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			const links = await getRoutineActivityLinks(routine.id)
			expect(links).toHaveLength(2)
			expect(links[0].activityType).toBe("manual_activity")
			expect(links[0].stepTitle).toBe("Verifiser tilgang")
			expect(links[0].stepDescription).toBe("Sjekk at alle brukere har rett tilgang")
			expect(links[0].sortOrder).toBe(0)
			expect(links[1].activityType).toBe("manual_activity")
			expect(links[1].stepTitle).toBe("Oppdater dokumentasjon")
			expect(links[1].stepDescription).toBeNull()
			expect(links[1].sortOrder).toBe(1)
		})

		it("allows mixing manual_activity items with other activity types", async () => {
			const sectionId = await createTestSection("Test", "checklist-mixed")

			const routine = await createRoutine({
				sectionId,
				name: "Blandet aktivitetsliste",
				description: null,
				frequency: "quarterly",
				activityItems: [
					{ type: "entra_id_group_maintenance" },
					{ type: "manual_activity", stepTitle: "Manuelt steg", stepDescription: null },
					{ type: "oracle_evidence_audit" },
				],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			const links = await getRoutineActivityLinks(routine.id)
			expect(links).toHaveLength(3)
			expect(links[0].activityType).toBe("entra_id_group_maintenance")
			expect(links[0].stepTitle).toBeNull()
			expect(links[1].activityType).toBe("manual_activity")
			expect(links[1].stepTitle).toBe("Manuelt steg")
			expect(links[2].activityType).toBe("oracle_evidence_audit")
			expect(links[2].stepTitle).toBeNull()
		})

		it("getRoutine returns activityItems with stepTitle and stepDescription", async () => {
			const sectionId = await createTestSection("Test", "checklist-get-routine")

			const routine = await createRoutine({
				sectionId,
				name: "GetRoutine sjekk",
				description: null,
				frequency: "monthly",
				activityItems: [{ type: "manual_activity", stepTitle: "Steg 1", stepDescription: "Detaljer" }],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			const fetched = await getRoutine(routine.id)
			expect(fetched).not.toBeNull()
			expect(fetched?.activityItems).toHaveLength(1)
			expect(fetched?.activityItems[0].type).toBe("manual_activity")
			expect(fetched?.activityItems[0].stepTitle).toBe("Steg 1")
			expect(fetched?.activityItems[0].stepDescription).toBe("Detaljer")
		})
	})

	// ─── updateRoutine with activityItems (manual_activity) ─────────────

	describe("updateRoutine with activityItems (manual_activity)", () => {
		it("replaces activity links when activityItems changes", async () => {
			const sectionId = await createTestSection("Test", "checklist-update")

			const routine = await createRoutine({
				sectionId,
				name: "Oppdater sjekkliste",
				description: null,
				frequency: "quarterly",
				activityItems: [{ type: "manual_activity", stepTitle: "Gammelt steg", stepDescription: null }],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})

			await updateRoutine({
				id: routine.id,
				name: "Oppdater sjekkliste",
				description: null,
				frequency: "quarterly",
				activityItems: [
					{ type: "manual_activity", stepTitle: "Nytt steg A", stepDescription: "Ny beskrivelse" },
					{ type: "manual_activity", stepTitle: "Nytt steg B", stepDescription: null },
				],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				updatedBy: "Z990001",
			})

			const links = await getRoutineActivityLinks(routine.id)
			expect(links).toHaveLength(2)
			expect(links[0].stepTitle).toBe("Nytt steg A")
			expect(links[0].stepDescription).toBe("Ny beskrivelse")
			expect(links[1].stepTitle).toBe("Nytt steg B")
		})
	})

	// ─── autoCreateActivitiesForReview — manual_activity idempotency ────

	describe("autoCreateActivitiesForReview — manual_activity", () => {
		it("creates one review activity per manual_activity link", async () => {
			const sectionId = await createTestSection("Test", "checklist-autocreate")
			const appId = await createTestApp("Sjekkliste-app")

			const routine = await createRoutine({
				sectionId,
				name: "Sjekkliste-rutine",
				description: null,
				frequency: "quarterly",
				activityItems: [
					{ type: "manual_activity", stepTitle: "Steg 1", stepDescription: null },
					{ type: "manual_activity", stepTitle: "Steg 2", stepDescription: null },
				],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})
			await markRoutineApproved(routine.id)

			const review = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "Sjekkliste-gjennomgang",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "Z990001",
				participants: [],
			})

			await autoCreateActivitiesForReview(review.id, routine.id, appId, "Z990001")

			const activities = await getReviewActivities(review.id)
			const checklistActivities = activities.filter((a) => a.type === "manual_activity")
			expect(checklistActivities).toHaveLength(2)
		})

		it("is idempotent for manual_activity — repeated calls do not create duplicates", async () => {
			const sectionId = await createTestSection("Test", "checklist-idempotent")
			const appId = await createTestApp("Idem-app")

			const routine = await createRoutine({
				sectionId,
				name: "Idempotent sjekkliste",
				description: null,
				frequency: "quarterly",
				activityItems: [
					{ type: "manual_activity", stepTitle: "Verifiser", stepDescription: null },
					{ type: "manual_activity", stepTitle: "Bekreft", stepDescription: null },
				],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})
			await markRoutineApproved(routine.id)

			const review = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "Idem-gjennomgang",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "Z990001",
				participants: [],
			})

			// Call three times — should still yield exactly 2 activities
			await autoCreateActivitiesForReview(review.id, routine.id, appId, "Z990001")
			await autoCreateActivitiesForReview(review.id, routine.id, appId, "Z990001")
			await autoCreateActivitiesForReview(review.id, routine.id, appId, "Z990001")

			const activities = await getReviewActivities(review.id)
			const checklistActivities = activities.filter((a) => a.type === "manual_activity")
			expect(checklistActivities).toHaveLength(2)
		})

		it("stores snapshotBefore with stepTitle/stepDescription for each checklist activity", async () => {
			const sectionId = await createTestSection("Test", "checklist-snapshot")
			const appId = await createTestApp("Snapshot-app")

			const routine = await createRoutine({
				sectionId,
				name: "Snapshot-sjekkliste",
				description: null,
				frequency: "quarterly",
				activityItems: [
					{ type: "manual_activity", stepTitle: "Sjekk konfigurasjon", stepDescription: "Valider alle innstillinger" },
				],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})
			await markRoutineApproved(routine.id)

			const review = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "Snapshot-gjennomgang",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "Z990001",
				participants: [],
			})

			await autoCreateActivitiesForReview(review.id, routine.id, appId, "Z990001")

			const activities = await getReviewActivities(review.id)
			const checklistActivity = activities.find((a) => a.type === "manual_activity")
			expect(checklistActivity).not.toBeNull()
			const snapshot = checklistActivity?.snapshotBefore as Record<string, unknown> | null
			expect(snapshot?.stepTitle).toBe("Sjekk konfigurasjon")
			expect(snapshot?.stepDescription).toBe("Valider alle innstillinger")
		})
	})

	// ─── seedManualActivity — single-step path ─────────────────

	describe("seedManualActivity", () => {
		it("seeds staged_data from snapshotBefore (single-step model)", async () => {
			const sectionId = await createTestSection("Test", "checklist-seed")
			const appId = await createTestApp("Seed-app")

			const routine = await createRoutine({
				sectionId,
				name: "Seed-sjekkliste",
				description: null,
				frequency: "quarterly",
				activityItems: [{ type: "manual_activity", stepTitle: "Kontroller tilgang", stepDescription: "Detaljer her" }],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})
			await markRoutineApproved(routine.id)

			const review = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "Seed-gjennomgang",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "Z990001",
				participants: [],
			})

			await autoCreateActivitiesForReview(review.id, routine.id, appId, "Z990001")

			const activities = await getReviewActivities(review.id)
			const activity = activities.find((a) => a.type === "manual_activity")
			if (!activity) throw new Error("Expected manual_activity activity to exist")

			const stagedData = await seedManualActivity(activity.id, routine.id, "Z990001")
			expect(stagedData.steps).toHaveLength(1)
			expect(stagedData.steps[0].title).toBe("Kontroller tilgang")
			expect(stagedData.steps[0].description).toBe("Detaljer her")
			expect(stagedData.steps[0].completedAt).toBeNull()
		})

		it("is idempotent — repeated seed calls return the same staged_data", async () => {
			const sectionId = await createTestSection("Test", "checklist-seed-idem")
			const appId = await createTestApp("Seed-idem-app")

			const routine = await createRoutine({
				sectionId,
				name: "Seed-idem-sjekkliste",
				description: null,
				frequency: "quarterly",
				activityItems: [{ type: "manual_activity", stepTitle: "Idempotent steg", stepDescription: null }],
				screeningQuestionId: null,
				screeningChoiceValue: null,
				appliesToAllInSection: false,
				responsibleRole: null,
				persistenceLinks: [],
				controlIds: [],
				technologyElementIds: [],
				createdBy: "Z990001",
			})
			await markRoutineApproved(routine.id)

			const review = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "Seed-idem-gjennomgang",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "Z990001",
				participants: [],
			})

			await autoCreateActivitiesForReview(review.id, routine.id, appId, "Z990001")
			const activities = await getReviewActivities(review.id)
			const activity = activities.find((a) => a.type === "manual_activity")
			if (!activity) throw new Error("Expected manual_activity activity to exist")

			const firstSeed = await seedManualActivity(activity.id, routine.id, "Z990001")
			const secondSeed = await seedManualActivity(activity.id, routine.id, "Z990001")

			expect(firstSeed.steps[0].stepId).toBe(secondSeed.steps[0].stepId)
			expect(firstSeed.steps[0].title).toBe(secondSeed.steps[0].title)
		})
	})
})
