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

const {
	archiveRoutine,
	unarchiveRoutine,
	deleteDraftRoutine,
	createRoutine,
	getRoutine,
	getRoutinesForSection,
	createReview,
	approveRoutine,
	copyRoutine,
	discardReview,
	addReviewLink,
	deleteReviewLink,
	updateReview,
	completeReview,
} = await import("~/db/queries/routines.server")

async function getAuditByEntity(entityType: string, entityId: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `SELECT action, previous_value, new_value, performed_by FROM audit_log WHERE entity_type = '${entityType}' AND entity_id = '${entityId}' ORDER BY performed_at`,
	)
	return r.rows as Array<{
		action: string
		previous_value: string | null
		new_value: string | null
		performed_by: string
	}>
}

async function createTestSection(name: string, slug: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `INSERT INTO sections (name, slug, created_by, updated_by) VALUES ('${name}', '${slug}', 'test', 'test') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function createTestApp(name: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `INSERT INTO monitored_applications (name, created_by, updated_by) VALUES ('${name}', 'test', 'test') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function createTestRoutine(sectionId: string, name: string) {
	return createRoutine({
		sectionId,
		name,
		description: null,
		frequency: "annually",
		screeningQuestionId: null,
		screeningChoiceValue: null,
		appliesToAllInSection: false,
		responsibleRole: null,
		activityType: null,
		persistenceLinks: [],
		technologyElementIds: [],
		controlIds: [],
		groupClassifications: [],
		oracleRoleCriticalities: [],
		createdBy: "test",
	})
}

async function approveForArchiving(routineId: string) {
	const db = getTestDb()
	await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routineId}'`)
}

describe("Routine archive (soft-delete) integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	}, 120_000)

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM routine_review_attachments;
			DELETE FROM routine_review_links;
			DELETE FROM routine_review_participants;
			DELETE FROM routine_review_activities;
			DELETE FROM routine_reviews;
			DELETE FROM routine_persistence_links;
			DELETE FROM routine_group_classification_links;
			DELETE FROM routine_oracle_role_criticality_links;
			DELETE FROM routine_screening_questions;
			DELETE FROM routine_controls;
			DELETE FROM routine_technology_elements;
			DELETE FROM ruleset_routines;
			DELETE FROM ruleset_controls;
			DELETE FROM rulesets;
			DELETE FROM screening_question_choices;
			DELETE FROM screening_questions;
			DELETE FROM control_technology_elements;
			DELETE FROM framework_controls;
			DELETE FROM framework_domains;
			DELETE FROM technology_elements;
			DELETE FROM routines;
			DELETE FROM monitored_applications;
			DELETE FROM sections;
			DELETE FROM audit_log;
		`)
	})

	it("archives a routine instead of deleting it (soft-delete)", async () => {
		const sectionId = await createTestSection("Sec", "sec")
		const routine = await createTestRoutine(sectionId, "R1")
		await approveForArchiving(routine.id)

		const archived = await archiveRoutine(routine.id, "archiver")
		expect(archived?.archivedAt).not.toBeNull()
		expect(archived?.archivedBy).toBe("archiver")

		const fetched = await getRoutine(routine.id)
		expect(fetched).not.toBeNull()
		expect(fetched?.archivedAt).not.toBeNull()

		const audit = await getAuditByEntity("routine", routine.id)
		expect(audit.find((a) => a.action === "routine_archived")?.performed_by).toBe("archiver")
	})

	it("excludes archived routines from getRoutinesForSection()", async () => {
		const sectionId = await createTestSection("Sec", "sec")
		const active = await createTestRoutine(sectionId, "Active")
		const toArchive = await createTestRoutine(sectionId, "Archived")
		await approveForArchiving(toArchive.id)
		await archiveRoutine(toArchive.id, "admin")

		const list = await getRoutinesForSection(sectionId)
		const ids = list.map((r) => r.id)
		expect(ids).toContain(active.id)
		expect(ids).not.toContain(toArchive.id)
	})

	it("reactivates an archived routine", async () => {
		const sectionId = await createTestSection("Sec", "sec")
		const routine = await createTestRoutine(sectionId, "R1")
		await approveForArchiving(routine.id)
		await archiveRoutine(routine.id, "admin")
		const reactivated = await unarchiveRoutine(routine.id, "reactivator")

		expect(reactivated?.archivedAt).toBeNull()
		expect(reactivated?.archivedBy).toBeNull()

		const audit = await getAuditByEntity("routine", routine.id)
		expect(audit.find((a) => a.action === "routine_unarchived")?.performed_by).toBe("reactivator")
	})

	it("reactivates a legacy hard-soft-deleted routine (status='deleted' + backfilled archivedAt)", async () => {
		const sectionId = await createTestSection("Sec", "sec")
		const routine = await createTestRoutine(sectionId, "Legacy")
		const db = getTestDb()
		// Simuler legacy-tilstand: gammel deleteRoutine satte status='deleted',
		// migrasjon 0042 backfiller archived_at for slike rader.
		await db.execute(
			/* sql */ `UPDATE routines SET status = 'deleted', archived_at = NOW(), archived_by = 'legacy-admin' WHERE id = '${routine.id}'`,
		)

		const reactivated = await unarchiveRoutine(routine.id, "reactivator")

		expect(reactivated?.archivedAt).toBeNull()
		expect(reactivated?.archivedBy).toBeNull()
		// Status må tilbakestilles fra 'deleted' så rutinen ikke ligger i en
		// inkonsistent tilstand der status-guarder fortsatt blokkerer redigering.
		expect(reactivated?.status).toBe("draft")

		// Skal ikke lekke inn i seksjonens liste (filtrert på archivedAt) — og
		// status='draft' gjør at den faktisk vises som forventet.
		const list = await getRoutinesForSection(sectionId)
		expect(list.find((r) => r.id === routine.id)).toBeDefined()

		const audit = await getAuditByEntity("routine", routine.id)
		const entry = audit.find((a) => a.action === "routine_unarchived")
		expect(entry).toBeDefined()
		const prev = JSON.parse(entry?.previous_value ?? "{}")
		const next = JSON.parse(entry?.new_value ?? "{}")
		expect(prev.status).toBe("deleted")
		expect(next.status).toBe("draft")
	})

	it("archive is idempotent: second call writes no extra audit entry", async () => {
		const sectionId = await createTestSection("Sec", "sec")
		const routine = await createTestRoutine(sectionId, "R1")
		await approveForArchiving(routine.id)
		await archiveRoutine(routine.id, "first")
		await archiveRoutine(routine.id, "second")

		const audit = await getAuditByEntity("routine", routine.id)
		const archives = audit.filter((a) => a.action === "routine_archived")
		expect(archives).toHaveLength(1)
		expect(archives[0].performed_by).toBe("first")
	})

	it("unarchive is idempotent: second call writes no extra audit entry", async () => {
		const sectionId = await createTestSection("Sec", "sec")
		const routine = await createTestRoutine(sectionId, "R1")
		await approveForArchiving(routine.id)
		await archiveRoutine(routine.id, "admin")
		await unarchiveRoutine(routine.id, "first")
		await unarchiveRoutine(routine.id, "second")

		const audit = await getAuditByEntity("routine", routine.id)
		const unarchives = audit.filter((a) => a.action === "routine_unarchived")
		expect(unarchives).toHaveLength(1)
		expect(unarchives[0].performed_by).toBe("first")
	})

	it("throws when archiving a non-existent routine", async () => {
		await expect(archiveRoutine("00000000-0000-0000-0000-000000000000", "admin")).rejects.toMatchObject({
			status: 404,
		})
	})

	it("throws when unarchiving a non-existent routine", async () => {
		await expect(unarchiveRoutine("00000000-0000-0000-0000-000000000000", "admin")).rejects.toMatchObject({
			status: 404,
		})
	})

	it("preserves reviews after soft-delete", async () => {
		const sectionId = await createTestSection("Sec", "sec")
		const appId = await createTestApp("App")
		const routine = await createTestRoutine(sectionId, "R1")

		const db = getTestDb()
		await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)
		await createReview({
			routineId: routine.id,
			applicationId: appId,
			title: "Review",
			summary: null,
			routineSnapshotPath: null,
			reviewedAt: new Date(),
			createdBy: "test",
			participants: [],
		})

		await archiveRoutine(routine.id, "admin")

		const reviews = await db.execute(/* sql */ `SELECT id FROM routine_reviews WHERE routine_id = '${routine.id}'`)
		expect(reviews.rows).toHaveLength(1)
	})

	describe("FK RESTRICT enforcement", () => {
		it("rejects raw DELETE of routine referenced by routine_reviews", async () => {
			const sectionId = await createTestSection("Sec", "sec")
			const appId = await createTestApp("App")
			const routine = await createTestRoutine(sectionId, "R1")
			const db = getTestDb()
			await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)
			await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "Review",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "test",
				participants: [],
			})

			await expect(db.execute(/* sql */ `DELETE FROM routines WHERE id = '${routine.id}'`)).rejects.toThrow()

			const stillThere = await db.execute(/* sql */ `SELECT id FROM routines WHERE id = '${routine.id}'`)
			expect(stillThere.rows).toHaveLength(1)
		})

		it("rejects raw DELETE of routine referenced by routine_persistence_links", async () => {
			const sectionId = await createTestSection("Sec", "sec")
			const routine = await createTestRoutine(sectionId, "R1")
			const db = getTestDb()
			await db.execute(
				/* sql */ `INSERT INTO routine_persistence_links (routine_id, persistence_type) VALUES ('${routine.id}', 'cloud_sql_postgres')`,
			)

			await expect(db.execute(/* sql */ `DELETE FROM routines WHERE id = '${routine.id}'`)).rejects.toThrow()
		})

		it("rejects raw DELETE of routine referenced by routine_group_classification_links", async () => {
			const sectionId = await createTestSection("Sec", "sec")
			const routine = await createTestRoutine(sectionId, "R1")
			const db = getTestDb()
			await db.execute(
				/* sql */ `INSERT INTO routine_group_classification_links (routine_id, classification) VALUES ('${routine.id}', 'mine_tilganger')`,
			)

			await expect(db.execute(/* sql */ `DELETE FROM routines WHERE id = '${routine.id}'`)).rejects.toThrow()
		})

		it("rejects raw DELETE of routine referenced by routine_oracle_role_criticality_links", async () => {
			const sectionId = await createTestSection("Sec", "sec")
			const routine = await createTestRoutine(sectionId, "R1")
			const db = getTestDb()
			await db.execute(
				/* sql */ `INSERT INTO routine_oracle_role_criticality_links (routine_id, criticality) VALUES ('${routine.id}', 'high')`,
			)

			await expect(db.execute(/* sql */ `DELETE FROM routines WHERE id = '${routine.id}'`)).rejects.toThrow()
		})

		it("rejects raw DELETE of routine referenced by routine_screening_questions", async () => {
			const sectionId = await createTestSection("Sec", "sec")
			const routine = await createTestRoutine(sectionId, "R1")
			const db = getTestDb()
			const q = await db.execute(
				/* sql */ `INSERT INTO screening_questions (section_id, question_text, answer_type, created_by, updated_by) VALUES ('${sectionId}', 'Q?', 'boolean', 'test', 'test') RETURNING id`,
			)
			const questionId = (q.rows[0] as { id: string }).id
			await db.execute(
				/* sql */ `INSERT INTO routine_screening_questions (routine_id, question_id) VALUES ('${routine.id}', '${questionId}')`,
			)

			await expect(db.execute(/* sql */ `DELETE FROM routines WHERE id = '${routine.id}'`)).rejects.toThrow()
		})

		it("rejects raw DELETE of routine referenced by routine_controls", async () => {
			const sectionId = await createTestSection("Sec", "sec")
			const routine = await createTestRoutine(sectionId, "R1")
			const db = getTestDb()
			const ctrl = await db.execute(
				/* sql */ `INSERT INTO framework_controls (control_id, short_title, requirement) VALUES ('C-FK.01', 'Ctrl', 'req') RETURNING id`,
			)
			const controlId = (ctrl.rows[0] as { id: string }).id
			await db.execute(
				/* sql */ `INSERT INTO routine_controls (routine_id, control_id) VALUES ('${routine.id}', '${controlId}')`,
			)

			await expect(db.execute(/* sql */ `DELETE FROM routines WHERE id = '${routine.id}'`)).rejects.toThrow()
		})

		it("rejects raw DELETE of routine referenced by routine_technology_elements", async () => {
			const sectionId = await createTestSection("Sec", "sec")
			const routine = await createTestRoutine(sectionId, "R1")
			const db = getTestDb()
			const el = await db.execute(
				/* sql */ `INSERT INTO technology_elements (name, slug) VALUES ('Java', 'java') RETURNING id`,
			)
			const elementId = (el.rows[0] as { id: string }).id
			await db.execute(
				/* sql */ `INSERT INTO routine_technology_elements (routine_id, element_id) VALUES ('${routine.id}', '${elementId}')`,
			)

			await expect(db.execute(/* sql */ `DELETE FROM routines WHERE id = '${routine.id}'`)).rejects.toThrow()
		})

		it("rejects raw DELETE of routine referenced by ruleset_routines", async () => {
			const sectionId = await createTestSection("Sec", "sec")
			const routine = await createTestRoutine(sectionId, "R1")
			const db = getTestDb()
			const rs = await db.execute(
				/* sql */ `INSERT INTO rulesets (section_id, name, frequency, created_by, updated_by) VALUES ('${sectionId}', 'RS', 'annually', 'test', 'test') RETURNING id`,
			)
			const rulesetId = (rs.rows[0] as { id: string }).id
			await db.execute(
				/* sql */ `INSERT INTO ruleset_routines (ruleset_id, routine_id, created_by) VALUES ('${rulesetId}', '${routine.id}', 'test')`,
			)

			await expect(db.execute(/* sql */ `DELETE FROM routines WHERE id = '${routine.id}'`)).rejects.toThrow()
		})
	})

	describe("Audit log captures pre-update state on unarchive", () => {
		it("records the actual archivedAt timestamp in previousValue", async () => {
			const sectionId = await createTestSection("Sec", "sec")
			const routine = await createTestRoutine(sectionId, "R1")
			await approveForArchiving(routine.id)
			await archiveRoutine(routine.id, "user-a")
			await unarchiveRoutine(routine.id, "user-b")

			const audit = await getAuditByEntity("routine", routine.id)
			const entry = audit.find((e) => e.action === "routine_unarchived")
			expect(entry).toBeDefined()
			const prev = JSON.parse(entry?.previous_value ?? "{}")
			expect(prev.archivedAt).toBeTruthy()
			expect(entry?.performed_by).toBe("user-b")
		})
	})

	describe("Status-baserte mutasjoner respekterer archivedAt", () => {
		it("createReview() avviser arkivert rutine selv om status='approved'", async () => {
			const db = getTestDb()
			const sectionId = await createTestSection("Sec", "sec")
			const appId = await createTestApp("App")
			const routine = await createTestRoutine(sectionId, "R1")
			// Sett status='approved' for å passere status-guarden, og arkiver i etterkant
			await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)
			await archiveRoutine(routine.id, "admin")

			await expect(
				createReview({
					routineId: routine.id,
					applicationId: appId,
					title: "Skal feile",
					summary: null,
					routineSnapshotPath: null,
					reviewedAt: new Date(),
					createdBy: "tester",
					participants: [],
				}),
			).rejects.toMatchObject({ status: 403 })

			const reviews = await db.execute(/* sql */ `SELECT id FROM routine_reviews WHERE routine_id = '${routine.id}'`)
			expect(reviews.rows).toHaveLength(0)
		})

		it("approveRoutine() avviser arkivert rutine selv om status='ready'", async () => {
			const db = getTestDb()
			const sectionId = await createTestSection("Sec", "sec")
			const routine = await createTestRoutine(sectionId, "R1")
			await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)
			await archiveRoutine(routine.id, "admin")
			// Sett tilbake til 'ready' for å teste at archived_at-guarden fanger uavhengig av status
			await db.execute(/* sql */ `UPDATE routines SET status = 'ready' WHERE id = '${routine.id}'`)

			await expect(approveRoutine(routine.id, "approver")).rejects.toMatchObject({ status: 403 })

			const after = await getRoutine(routine.id)
			expect(after?.status).toBe("ready")
			expect(after?.approvedBy).toBeNull()
		})

		it("copyRoutine() avviser arkivert rutine", async () => {
			const sectionId = await createTestSection("Sec", "sec")
			const routine = await createTestRoutine(sectionId, "R1")
			await approveForArchiving(routine.id)
			await archiveRoutine(routine.id, "admin")

			await expect(copyRoutine(routine.id, "copier")).rejects.toMatchObject({ status: 403 })
		})

		it("discardReview() avviser kassering når foreldre-rutinen er arkivert", async () => {
			const db = getTestDb()
			const sectionId = await createTestSection("Sec", "sec")
			const appId = await createTestApp("App")
			const routine = await createTestRoutine(sectionId, "R1")
			await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)
			const review = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "R",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "tester",
				participants: [],
			})
			await archiveRoutine(routine.id, "admin")

			await expect(discardReview(review.id, "discarder")).rejects.toMatchObject({ status: 403 })

			const after = await db.execute(/* sql */ `SELECT status FROM routine_reviews WHERE id = '${review.id}'`)
			expect((after.rows[0] as { status: string }).status).toBe("draft")
		})

		it("discardReview() returnerer null (ikke 403) for ikke-draft review selv på arkivert rutine", async () => {
			// Beskytter kontrakten til /applikasjoner/.../detaljer-action som
			// forventer null-respons for ikke-draft (vil ellers boble 403 til
			// error boundary).
			const db = getTestDb()
			const sectionId = await createTestSection("Sec", "sec")
			const appId = await createTestApp("App")
			const routine = await createTestRoutine(sectionId, "R1")
			await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)
			const review = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "R",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "tester",
				participants: [],
			})
			await db.execute(/* sql */ `UPDATE routine_reviews SET status = 'completed' WHERE id = '${review.id}'`)
			await archiveRoutine(routine.id, "admin")

			const result = await discardReview(review.id, "discarder")
			expect(result).toBeNull()
		})

		it("deleteReviewLink() avviser sletting på fremmed gjennomgang (IDOR-forsvar)", async () => {
			const db = getTestDb()
			const sectionId = await createTestSection("Sec", "sec")
			const appId = await createTestApp("App")
			const routine = await createTestRoutine(sectionId, "R1")
			await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)
			const review1 = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "R1",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "tester",
				participants: [],
			})
			const review2 = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "R2",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "tester",
				participants: [],
			})
			const link = await addReviewLink({
				reviewId: review1.id,
				url: "https://example.com",
				title: "Test",
				addedBy: "tester",
			})

			// Forsøk å slette link fra review1 ved å oppgi review2 som kontekst
			await expect(deleteReviewLink(link.id, review2.id, "attacker")).rejects.toMatchObject({ status: 403 })

			// Lenken skal fortsatt finnes
			const stillThere = await db.execute(/* sql */ `SELECT id FROM routine_review_links WHERE id = '${link.id}'`)
			expect(stillThere.rows).toHaveLength(1)
		})

		it("deleteReviewLink() avviser sletting når foreldre-rutinen er arkivert", async () => {
			const db = getTestDb()
			const sectionId = await createTestSection("Sec", "sec")
			const appId = await createTestApp("App")
			const routine = await createTestRoutine(sectionId, "R1")
			await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)
			const review = await createReview({
				routineId: routine.id,
				applicationId: appId,
				title: "R",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "tester",
				participants: [],
			})
			const link = await addReviewLink({
				reviewId: review.id,
				url: "https://example.com",
				title: null,
				addedBy: "tester",
			})
			await archiveRoutine(routine.id, "admin")

			await expect(deleteReviewLink(link.id, review.id, "deleter")).rejects.toMatchObject({ status: 403 })

			const stillThere = await db.execute(/* sql */ `SELECT id FROM routine_review_links WHERE id = '${link.id}'`)
			expect(stillThere.rows).toHaveLength(1)
		})

		it("deleteReviewLink() returnerer null for ukjent linkId (kallere kan svare 404)", async () => {
			const result = await deleteReviewLink("00000000-0000-0000-0000-000000000000", "any", "tester")
			expect(result).toBeNull()
		})

		it("deleteReviewLink() er atomisk: samtidig archiveRoutine() blokkeres til delete-tx er ferdig (TOCTOU-forsvar)", async () => {
			const db = getTestDb()
			const pool = getTestPool()
			const sectionId = await createTestSection("TOCTOUSec", "toctou-sec")
			const routine = await createTestRoutine(sectionId, "TOCTOU-rutine")
			await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)
			const review = await createReview({
				routineId: routine.id,
				applicationId: null,
				title: "G",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "tester",
				participants: [],
			})
			const link = await addReviewLink({ reviewId: review.id, url: "https://x", title: null, addedBy: "tester" })

			// Ekstern connection som starter en "archive"-transaksjon med
			// FOR UPDATE-lås på rutinen, men ikke committer enda.
			const externalClient = await pool.connect()
			try {
				await externalClient.query("BEGIN")
				await externalClient.query(/* sql */ `SELECT id FROM routines WHERE id = $1 FOR UPDATE`, [routine.id])

				// deleteReviewLink kjøres parallelt — skal blokkere på FOR SHARE
				// til vi committer archive-transaksjonen.
				let resolved = false
				const deletePromise = deleteReviewLink(link.id, review.id, "deleter").then(
					(v) => {
						resolved = true
						return v
					},
					(e) => {
						resolved = true
						throw e
					},
				)
				await new Promise((r) => setTimeout(r, 200))
				expect(resolved).toBe(false) // bevis på at låsen blokkerer

				// Nå arkiverer vi og committer — deleteReviewLink skal våkne
				// og se archived_at satt → 403.
				await externalClient.query(
					/* sql */ `UPDATE routines SET archived_at = NOW(), archived_by = 'archiver' WHERE id = $1`,
					[routine.id],
				)
				await externalClient.query("COMMIT")

				await expect(deletePromise).rejects.toMatchObject({ status: 403 })
			} finally {
				externalClient.release()
			}
		})

		it("approveRoutine() har atomisk WHERE-clause: status-mismatch på UPDATE-tidspunkt avvises", async () => {
			const db = getTestDb()
			const sectionId = await createTestSection("ApprSec", "appr-sec")
			const routine = await createTestRoutine(sectionId, "ApprR")
			// Direktemanipulasjon for å verifisere at UPDATE WHERE status='ready'
			// (atomisk inne i tx) avviser når status er noe annet. Tester
			// kontrakten på WHERE-clauselen — den ekte race-bevissheten er
			// dekket av deleteReviewLink-TOCTOU-testen som beviser FOR SHARE.
			await db.execute(/* sql */ `UPDATE routines SET status = 'draft' WHERE id = '${routine.id}'`)
			await expect(approveRoutine(routine.id, "approver")).rejects.toMatchObject({ status: 400 })
		})

		it("discardReview() har atomisk WHERE-clause: 0-row UPDATE returnerer null (kontraktbevarende)", async () => {
			const db = getTestDb()
			const sectionId = await createTestSection("DiscSec", "disc-sec")
			const routine = await createTestRoutine(sectionId, "DiscR")
			await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)
			const review = await createReview({
				routineId: routine.id,
				applicationId: null,
				title: "G",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "tester",
				participants: [],
			})
			// Direktemanipulasjon: status='completed' før discardReview kalles.
			// Pre-check fanger og returnerer null — bevarer kontrakten. Den
			// atomiske WHERE-clauselen er ekstra forsvar mot ekte race.
			await db.execute(/* sql */ `UPDATE routine_reviews SET status = 'completed' WHERE id = '${review.id}'`)
			const result = await discardReview(review.id, "discarder")
			expect(result).toBeNull()
		})

		it("addReviewLink() avviser når foreldre-rutinen er arkivert", async () => {
			const db = getTestDb()
			const sectionId = await createTestSection("LinkSec", "link-sec")
			const routine = await createTestRoutine(sectionId, "LinkR")
			await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)
			const review = await createReview({
				routineId: routine.id,
				applicationId: null,
				title: "G",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "tester",
				participants: [],
			})
			await archiveRoutine(routine.id, "admin")
			await expect(
				addReviewLink({ reviewId: review.id, url: "https://x", title: null, addedBy: "adder" }),
			).rejects.toMatchObject({ status: 403 })
		})

		it("addReviewLink() kaster 404 når review ikke finnes", async () => {
			await expect(
				addReviewLink({
					reviewId: "00000000-0000-0000-0000-000000000000",
					url: "https://x",
					title: null,
					addedBy: "adder",
				}),
			).rejects.toMatchObject({ status: 404 })
		})

		it("updateReview() avviser når foreldre-rutinen er arkivert", async () => {
			const db = getTestDb()
			const sectionId = await createTestSection("UpdSec", "upd-sec")
			const routine = await createTestRoutine(sectionId, "UpdR")
			await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)
			const review = await createReview({
				routineId: routine.id,
				applicationId: null,
				title: "Original",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "tester",
				participants: [],
			})
			await archiveRoutine(routine.id, "admin")
			await expect(updateReview(review.id, { title: "Endret" }, "updater")).rejects.toMatchObject({ status: 403 })
		})

		it("completeReview() avviser når foreldre-rutinen er arkivert", async () => {
			const db = getTestDb()
			const sectionId = await createTestSection("CompSec", "comp-sec")
			const routine = await createTestRoutine(sectionId, "CompR")
			await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)
			const review = await createReview({
				routineId: routine.id,
				applicationId: null,
				title: "G",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "tester",
				participants: [],
			})
			await archiveRoutine(routine.id, "admin")
			await expect(completeReview(review.id, "completer")).rejects.toMatchObject({ status: 403 })
		})

		it("completeReview() er idempotent: dobbel-fullføring skriver kun én audit-oppføring", async () => {
			const db = getTestDb()
			const sectionId = await createTestSection("IdemSec", "idem-sec")
			const routine = await createTestRoutine(sectionId, "IdemR")
			await db.execute(/* sql */ `UPDATE routines SET status = 'approved' WHERE id = '${routine.id}'`)
			const review = await createReview({
				routineId: routine.id,
				applicationId: null,
				title: "G",
				summary: null,
				routineSnapshotPath: null,
				reviewedAt: new Date(),
				createdBy: "tester",
				participants: [],
			})
			await completeReview(review.id, "completer1")
			// Andre kall: pre-check fanger og returnerer eksisterende. Hvis
			// pre-check ble omgått (race), ville WHERE status != 'completed'
			// matche 0 rader og audit hoppes over via .returning()-sjekken.
			await completeReview(review.id, "completer2")
			const audits = await getAuditByEntity("routine_review", review.id)
			const completedAudits = audits.filter((a) => a.action === "routine_review_completed")
			expect(completedAudits).toHaveLength(1)
		})

		it("createReview() kaster Response 404 når rutinen ikke finnes (konsistent kontrakt)", async () => {
			await expect(
				createReview({
					routineId: "00000000-0000-0000-0000-000000000000",
					applicationId: null,
					title: "T",
					summary: null,
					routineSnapshotPath: null,
					reviewedAt: new Date(),
					createdBy: "tester",
					participants: [],
				}),
			).rejects.toMatchObject({ status: 404 })
		})

		it("createReview() kaster Response 400 når status ikke er aktiv eller godkjent", async () => {
			const db = getTestDb()
			const sectionId = await createTestSection("Sec", "sec")
			const routine = await createTestRoutine(sectionId, "R1")
			await db.execute(/* sql */ `UPDATE routines SET status = 'draft' WHERE id = '${routine.id}'`)
			await expect(
				createReview({
					routineId: routine.id,
					applicationId: null,
					title: "T",
					summary: null,
					routineSnapshotPath: null,
					reviewedAt: new Date(),
					createdBy: "tester",
					participants: [],
				}),
			).rejects.toMatchObject({ status: 400 })
		})
	})

	describe("deleteDraftRoutine", () => {
		it("soft-deletes a draft routine with status='deleted' and archivedAt", async () => {
			const sectionId = await createTestSection("Sec", "sec")
			const routine = await createTestRoutine(sectionId, "Draft to delete")

			const deleted = await deleteDraftRoutine(routine.id, "deleter")
			expect(deleted?.status).toBe("deleted")
			expect(deleted?.archivedAt).not.toBeNull()
			expect(deleted?.archivedBy).toBe("deleter")

			const fetched = await getRoutine(routine.id)
			expect(fetched?.archivedAt).not.toBeNull()
			expect(fetched?.status).toBe("deleted")
		})

		it("excludes deleted draft from getRoutinesForSection()", async () => {
			const sectionId = await createTestSection("Sec", "sec")
			const active = await createTestRoutine(sectionId, "Active")
			const toDelete = await createTestRoutine(sectionId, "ToDelete")
			await deleteDraftRoutine(toDelete.id, "admin")

			const listed = await getRoutinesForSection(sectionId)
			expect(listed.map((r) => r.id)).toContain(active.id)
			expect(listed.map((r) => r.id)).not.toContain(toDelete.id)
		})

		it("writes exactly one audit_log entry", async () => {
			const sectionId = await createTestSection("Sec", "sec")
			const routine = await createTestRoutine(sectionId, "Audited")
			await deleteDraftRoutine(routine.id, "admin")

			const audit = await getAuditByEntity("routine", routine.id)
			const deletes = audit.filter((a) => a.action === "routine_deleted")
			expect(deletes).toHaveLength(1)
			expect(deletes[0].performed_by).toBe("admin")
		})

		it("is idempotent: second call returns existing without extra audit", async () => {
			const sectionId = await createTestSection("Sec", "sec")
			const routine = await createTestRoutine(sectionId, "R1")
			await deleteDraftRoutine(routine.id, "first")
			await deleteDraftRoutine(routine.id, "second")

			const audit = await getAuditByEntity("routine", routine.id)
			const deletes = audit.filter((a) => a.action === "routine_deleted")
			expect(deletes).toHaveLength(1)
			expect(deletes[0].performed_by).toBe("first")
		})

		it("throws when routine does not exist", async () => {
			await expect(deleteDraftRoutine("00000000-0000-0000-0000-000000000000", "admin")).rejects.toMatchObject({
				status: 404,
			})
		})

		it("throws when routine is approved (not draft)", async () => {
			const sectionId = await createTestSection("Sec", "sec")
			const routine = await createTestRoutine(sectionId, "Approved")
			await approveForArchiving(routine.id)

			await expect(deleteDraftRoutine(routine.id, "admin")).rejects.toMatchObject({ status: 409 })
		})
	})
})
