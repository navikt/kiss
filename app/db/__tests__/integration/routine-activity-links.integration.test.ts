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
	getRoutine,
	updateRoutine,
	createReview,
	copyRoutine,
	autoCreateActivitiesForReview,
	getRoutineActivityLinks,
	reorderRoutineActivities,
	getReviewActivityByType,
	getReviewActivities,
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
				createdBy: "test-user",
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
				createdBy: "test-user",
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
				createdBy: "test-user",
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
				createdBy: "test-user",
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
				createdBy: "test-user",
			})

			const links = await getRoutineActivityLinks(routine.id)
			expect(links.map((l) => l.activityType)).toEqual([
				"entra_id_group_maintenance",
				"oracle_evidence_audit",
				"deployment_evidence_report",
			])
			expect(links.map((l) => l.sortOrder)).toEqual([0, 1, 2])
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
				createdBy: "test-user",
			})

			const links = await getRoutineActivityLinks(routine.id)
			// Reverse the order
			const reversedIds = [...links].reverse().map((l) => l.id)

			await reorderRoutineActivities(routine.id, reversedIds, "test-user")

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
				createdBy: "test-user",
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
				createdBy: "test-user",
			})

			const links1 = await getRoutineActivityLinks(routine1.id)
			const reversedIds = [...links1].reverse().map((l) => l.id)

			await reorderRoutineActivities(routine1.id, reversedIds, "test-user")

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
				createdBy: "test-user",
			})
			const links = await getRoutineActivityLinks(routine.id)
			// Only supply one of two IDs
			await expect(reorderRoutineActivities(routine.id, [links[0].id], "test-user")).rejects.toThrow(
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
				createdBy: "test-user",
			})
			const links = await getRoutineActivityLinks(routine.id)
			// Duplicate first ID
			await expect(reorderRoutineActivities(routine.id, [links[0].id, links[0].id], "test-user")).rejects.toThrow(
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
				createdBy: "test-user",
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
				createdBy: "test-user",
			})
			const links2 = await getRoutineActivityLinks(routine2.id)
			// Try to reorder routine1 with routine2's IDs
			await expect(reorderRoutineActivities(routine1.id, [links2[0].id], "test-user")).rejects.toThrow(
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
				createdBy: "test-user",
			})
			await markRoutineApproved(routine.id)

			const review = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "Test review",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "test-user",
				participants: [],
			})

			await autoCreateActivitiesForReview(review.id, routine.id, appId, "test-user")

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
				createdBy: "test-user",
			})
			await markRoutineApproved(routine.id)

			const review = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "Test review",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "test-user",
				participants: [],
			})

			// Call twice — second should be a no-op
			await autoCreateActivitiesForReview(review.id, routine.id, appId, "test-user")
			await autoCreateActivitiesForReview(review.id, routine.id, appId, "test-user")

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
				createdBy: "test-user",
			})
			await markRoutineApproved(routine.id)

			const review = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "Test review",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "test-user",
				participants: [],
			})

			await autoCreateActivitiesForReview(review.id, routine.id, appId, "test-user", {
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
				createdBy: "test-user",
			})
			await markRoutineApproved(routine.id)

			const review = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "Test review",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "test-user",
				participants: [],
			})

			await autoCreateActivitiesForReview(review.id, routine.id, appId, "test-user")

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
				createdBy: "test-user",
			})
			await markRoutineApproved(routine.id)

			const review = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "Test review",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "test-user",
				participants: [],
			})

			await autoCreateActivitiesForReview(review.id, routine.id, appId, "test-user")

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
				createdBy: "test-user",
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
				updatedBy: "test-user",
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
				createdBy: "test-user",
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
				updatedBy: "test-user",
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
				createdBy: "test-user",
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
				updatedBy: "test-user",
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
				createdBy: "test-user",
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
				updatedBy: "test-user",
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
				createdBy: "test-user",
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
				updatedBy: "test-user",
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
				createdBy: "test-user",
			})
			await markRoutineApproved(routine.id)

			const copy = await copyRoutine(routine.id, "test-user")
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
				createdBy: "test-user",
			})
			await markRoutineApproved(routine.id)

			// Archive one link
			await db.execute(/* sql */ `
				UPDATE routine_activity_links
				SET archived_at = NOW(), archived_by = 'test'
				WHERE routine_id = '${routine.id}' AND activity_type = 'oracle_evidence_audit'
			`)

			const copy = await copyRoutine(routine.id, "test-user")
			expect(copy).not.toBeNull()
			const copyId = copy?.id as string

			const copyLinks = await getRoutineActivityLinks(copyId)
			expect(copyLinks).toHaveLength(1)
			expect(copyLinks[0].activityType).toBe("entra_id_group_maintenance")
		})
	})
})
