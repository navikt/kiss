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
	createScreeningQuestion,
	updateScreeningQuestion,
	archiveScreeningQuestion,
	unarchiveScreeningQuestion,
	reorderScreeningQuestions,
	getScreeningQuestions,
	getSectionScreeningQuestions,
	getChoicesForQuestion,
	createChoice,
	updateChoice,
	archiveChoice,
	unarchiveChoice,
	addChoiceEffect,
	getChoiceEffects,
	archiveChoiceEffect,
	unarchiveChoiceEffect,
	saveScreeningAnswer,
	getScreeningAnswersForApp,
	setQuestionTechnologyElements,
	getQuestionTechnologyElements,
	changeScreeningQuestionStatus,
	getScreeningDataForApp,
	isEffectOwnedByQuestion,
} = await import("~/db/queries/screening.server")

async function createApp(name: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `INSERT INTO monitored_applications (name, created_by, updated_by) VALUES ('${name}', 'test', 'test') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function createSectionRow(slug: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `INSERT INTO sections (name, slug, created_by, updated_by) VALUES ('Sec ${slug}', '${slug}', 'test', 'test') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function createControl(controlId: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `INSERT INTO framework_controls (control_id, requirement) VALUES ('${controlId}', 'req') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function createTechElement(slug: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `INSERT INTO technology_elements (name, slug) VALUES ('${slug}', '${slug}') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function createNaisTeam(slug: string, sectionId: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `INSERT INTO nais_teams (slug, section_id) VALUES ('${slug}', '${sectionId}') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function createAppEnvironment(appId: string, naisTeamId: string, cluster: string = "prod-gcp") {
	const db = getTestDb()
	await db.execute(
		/* sql */ `INSERT INTO application_environments (application_id, cluster, namespace, nais_team_id) VALUES ('${appId}', '${cluster}', 'team-ns', '${naisTeamId}')`,
	)
}

async function getAuditByAction(action: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `SELECT action, entity_id, performed_by, new_value FROM audit_log WHERE action = '${action}'`,
	)
	return r.rows as Array<{ action: string; entity_id: string; performed_by: string; new_value: string | null }>
}

describe("screening.server integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	}, 120_000)

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM screening_routine_selections;
			DELETE FROM screening_answers;
			DELETE FROM screening_choice_effects;
			DELETE FROM screening_question_choices;
			DELETE FROM screening_question_effects;
			DELETE FROM screening_question_technology_elements;
			DELETE FROM screening_questions;
			DELETE FROM application_technology_elements;
			DELETE FROM technology_elements;
			DELETE FROM control_technology_elements;
			DELETE FROM framework_controls;
			DELETE FROM application_environments;
			DELETE FROM section_environments;
			DELETE FROM nais_teams;
			DELETE FROM monitored_applications;
			DELETE FROM sections;
			DELETE FROM audit_log;
		`)
	})

	describe("Questions CRUD", () => {
		it("auto-creates Ja/Nei choices for a boolean question and writes audit log", async () => {
			const q = await createScreeningQuestion("Brukes MFA?", "Beskrivelse", "admin")
			expect(q.questionText).toBe("Brukes MFA?")

			const choices = await getChoicesForQuestion(q.id)
			expect(choices.map((c) => c.label)).toEqual(["Ja", "Nei"])

			const audit = await getAuditByAction("screening_question_created")
			expect(audit.find((a) => a.entity_id === q.id)).toBeDefined()
		})

		it("does not auto-create choices for non-boolean questions", async () => {
			const q = await createScreeningQuestion("Hva er verdi?", null, "admin", null, "text")
			const choices = await getChoicesForQuestion(q.id)
			expect(choices).toHaveLength(0)
		})

		it("scopes questions to a section", async () => {
			const sectionId = await createSectionRow("sec1")
			await createScreeningQuestion("Global?", null, "admin")
			await createScreeningQuestion("Sec scoped?", null, "admin", sectionId)

			const globals = await getScreeningQuestions()
			const sectionQs = await getSectionScreeningQuestions(sectionId)
			expect(globals).toHaveLength(1)
			expect(globals[0].questionText).toBe("Global?")
			expect(sectionQs).toHaveLength(1)
			expect(sectionQs[0].questionText).toBe("Sec scoped?")
		})

		it("updates a question with audit log", async () => {
			const q = await createScreeningQuestion("Old?", null, "admin")
			const updated = await updateScreeningQuestion(q.id, "New?", "desc", "editor")
			expect(updated.questionText).toBe("New?")

			const audit = await getAuditByAction("screening_question_updated")
			expect(audit.find((a) => a.entity_id === q.id)?.new_value).toBe("New?")
		})

		it("reorders questions", async () => {
			const a = await createScreeningQuestion("A", null, "admin")
			const b = await createScreeningQuestion("B", null, "admin")
			const c = await createScreeningQuestion("C", null, "admin")

			await reorderScreeningQuestions([c.id, a.id, b.id], "admin")

			const all = await getScreeningQuestions()
			expect(all.map((q) => q.questionText)).toEqual(["C", "A", "B"])
		})

		it("archives a question (soft-delete) with audit log and supports unarchive", async () => {
			const q = await createScreeningQuestion("ToArchive", null, "admin")
			await archiveScreeningQuestion(q.id, "admin")

			// Default lookup hides archived
			const visible = await getScreeningQuestions()
			expect(visible.find((x) => x.id === q.id)).toBeUndefined()

			// includeArchived shows them
			const all = await getScreeningQuestions({ includeArchived: true })
			const archived = all.find((x) => x.id === q.id)
			expect(archived).toBeDefined()
			expect(archived?.archivedAt).not.toBeNull()
			expect(archived?.archivedBy).toBe("admin")

			const audit = await getAuditByAction("screening_question_archived")
			expect(audit.find((a) => a.entity_id === q.id)).toBeDefined()

			// Idempotent: archiving twice should not produce a second audit entry
			await archiveScreeningQuestion(q.id, "admin")
			const auditAgain = await getAuditByAction("screening_question_archived")
			expect(auditAgain.filter((a) => a.entity_id === q.id)).toHaveLength(1)

			// Unarchive
			await unarchiveScreeningQuestion(q.id, "admin")
			const visibleAfter = await getScreeningQuestions()
			expect(visibleAfter.find((x) => x.id === q.id)).toBeDefined()

			const unarchiveAudit = await getAuditByAction("screening_question_unarchived")
			expect(unarchiveAudit.find((a) => a.entity_id === q.id)).toBeDefined()
		})

		it("returns null when archiving a missing question", async () => {
			const result = await archiveScreeningQuestion("00000000-0000-0000-0000-000000000000", "admin")
			expect(result).toBeNull()
		})
	})

	describe("Choices CRUD", () => {
		it("creates, updates and archives choices", async () => {
			const q = await createScreeningQuestion("Q", null, "admin", null, "single")
			const choice = await createChoice({ questionId: q.id, label: "Maybe", displayOrder: 0 })
			expect(choice.label).toBe("Maybe")

			const updated = await updateChoice(choice.id, { label: "Possibly", requiresComment: true })
			expect(updated.label).toBe("Possibly")
			expect(updated.requiresComment).toBe(true)

			await archiveChoice(choice.id, "admin")
			const remaining = await getChoicesForQuestion(q.id)
			expect(remaining).toHaveLength(0)

			const all = await getChoicesForQuestion(q.id, { includeArchived: true })
			expect(all).toHaveLength(1)
			expect(all[0].archivedAt).not.toBeNull()

			const audit = await getAuditByAction("screening_choice_archived")
			expect(audit.find((a) => a.entity_id === choice.id)).toBeDefined()

			// Idempotent
			await archiveChoice(choice.id, "admin")
			const auditAgain = await getAuditByAction("screening_choice_archived")
			expect(auditAgain.filter((a) => a.entity_id === choice.id)).toHaveLength(1)

			// Unarchive
			await unarchiveChoice(choice.id, "admin")
			const remainingAfter = await getChoicesForQuestion(q.id)
			expect(remainingAfter).toHaveLength(1)
		})

		it("cascade-archives child effects when choice is archived (with audit entries)", async () => {
			const q = await createScreeningQuestion("Q?", null, "admin")
			const choices = await getChoicesForQuestion(q.id)
			const ja = choices.find((c) => c.label === "Ja")
			if (!ja) throw new Error("Expected 'Ja' choice")
			await createControl("K-CASCADE.01")
			const eff = await addChoiceEffect({
				choiceId: ja.id,
				controlTextId: "K-CASCADE.01",
				effect: "implemented",
				comment: null,
			})

			// Confirm effect is active before archiving choice
			expect(await getChoiceEffects(ja.id)).toHaveLength(1)

			await archiveChoice(ja.id, "admin")

			// Choice is archived
			const archivedChoice = (await getChoicesForQuestion(q.id, { includeArchived: true })).find((c) => c.id === ja.id)
			expect(archivedChoice?.archivedAt).not.toBeNull()

			// Effect should also be archived
			expect(await getChoiceEffects(ja.id)).toHaveLength(0)
			const effectsIncludingArchived = await getChoiceEffects(ja.id, { includeArchived: true })
			expect(effectsIncludingArchived).toHaveLength(1)
			expect(effectsIncludingArchived[0].archivedAt).not.toBeNull()

			// Audit entry exists for cascaded effect
			const effAudit = await getAuditByAction("screening_choice_effect_archived")
			expect(effAudit.find((a) => a.entity_id === eff.id)).toBeDefined()
		})
	})

	describe("Choice effects", () => {
		it("adds and lists choice effects with control text id", async () => {
			const q = await createScreeningQuestion("Q?", null, "admin")
			const choices = await getChoicesForQuestion(q.id)
			const ja = choices.find((c) => c.label === "Ja")
			expect(ja).toBeDefined()
			if (!ja) throw new Error("Expected 'Ja' choice to exist")
			await createControl("K-S.01")

			const eff = await addChoiceEffect({
				choiceId: ja.id,
				controlTextId: "K-S.01",
				effect: "implemented",
				comment: "Godkjent gjennom MFA",
			})
			expect(eff.effect).toBe("implemented")

			const list = await getChoiceEffects(ja.id)
			expect(list).toHaveLength(1)
			expect(list[0].controlTextId).toBe("K-S.01")

			await archiveChoiceEffect(eff.id, "admin")
			const empty = await getChoiceEffects(ja.id)
			expect(empty).toHaveLength(0)

			const all = await getChoiceEffects(ja.id, { includeArchived: true })
			expect(all).toHaveLength(1)
			expect(all[0].archivedAt).not.toBeNull()

			const audit = await getAuditByAction("screening_choice_effect_archived")
			expect(audit.find((a) => a.entity_id === eff.id)).toBeDefined()

			// Unarchive
			await unarchiveChoiceEffect(eff.id, "admin")
			const after = await getChoiceEffects(ja.id)
			expect(after).toHaveLength(1)
		})

		it("throws if control text id does not exist", async () => {
			const q = await createScreeningQuestion("Q?", null, "admin")
			const choices = await getChoicesForQuestion(q.id)
			await expect(
				addChoiceEffect({
					choiceId: choices[0].id,
					controlTextId: "K-NONE.99",
					effect: "implemented",
					comment: null,
				}),
			).rejects.toThrow(/ikke funnet/)
		})
	})

	describe("Tech element scoping", () => {
		it("sets and replaces technology elements for a question", async () => {
			const q = await createScreeningQuestion("Q?", null, "admin")
			const e1 = await createTechElement("kubernetes")
			const e2 = await createTechElement("postgres")

			await setQuestionTechnologyElements(q.id, [e1, e2], "test-user")
			let links = await getQuestionTechnologyElements(q.id)
			expect(links.map((l) => l.elementId).sort()).toEqual([e1, e2].sort())

			await setQuestionTechnologyElements(q.id, [e2], "test-user")
			links = await getQuestionTechnologyElements(q.id)
			expect(links.map((l) => l.elementId)).toEqual([e2])

			await setQuestionTechnologyElements(q.id, [], "test-user")
			links = await getQuestionTechnologyElements(q.id)
			expect(links).toHaveLength(0)
		})

		it("writes diff-audit on add and remove and emits no audit on no-op", async () => {
			const { getAuditLogForEntity } = await import("~/db/queries/audit.server")
			const q = await createScreeningQuestion("AuditQ?", null, "admin")
			const e1 = await createTechElement("k8s-aud")
			const e2 = await createTechElement("pg-aud")

			await setQuestionTechnologyElements(q.id, [e1, e2], "alice")
			let log = await getAuditLogForEntity("screening_question_technology_element", q.id)
			expect(log.filter((r) => r.action === "screening_question_technology_element_added")).toHaveLength(2)

			// No-op resave must not emit any audit.
			await setQuestionTechnologyElements(q.id, [e1, e2], "alice")
			log = await getAuditLogForEntity("screening_question_technology_element", q.id)
			expect(log).toHaveLength(2)

			// Removing one element emits exactly one removed-audit.
			await setQuestionTechnologyElements(q.id, [e1], "bob")
			log = await getAuditLogForEntity("screening_question_technology_element", q.id)
			expect(log.filter((r) => r.action === "screening_question_technology_element_removed")).toHaveLength(1)
		})
	})

	describe("Answers", () => {
		it("upserts an answer and writes audit log", async () => {
			const app = await createApp("App1")
			const q = await createScreeningQuestion("Q?", null, "admin")

			await saveScreeningAnswer(app, q.id, "Ja", "X1", "kommentar", "https://example.com")

			let answers = await getScreeningAnswersForApp(app)
			expect(answers).toHaveLength(1)
			expect(answers[0].answer).toBe("Ja")
			expect(answers[0].comment).toBe("kommentar")
			expect(answers[0].link).toBe("https://example.com")

			// upsert: changes existing answer
			await saveScreeningAnswer(app, q.id, "Nei", "X2", null, null)
			answers = await getScreeningAnswersForApp(app)
			expect(answers).toHaveLength(1)
			expect(answers[0].answer).toBe("Nei")
			expect(answers[0].comment).toBeNull()

			const audit = await getAuditByAction("screening_answer_saved")
			expect(audit.length).toBeGreaterThanOrEqual(2)
			const entityIds = audit.map((a) => a.entity_id)
			expect(entityIds).toContain(`${app}/${q.id}`)
		})
	})

	describe("changeScreeningQuestionStatus", () => {
		it("allows valid transitions: draft → ready → approved", async () => {
			const section = await createSectionRow("status-transitions")
			const q = await createScreeningQuestion("Transition test", null, "test", section, "boolean")
			expect(q.status).toBe("draft")

			// draft → ready
			const ready = await changeScreeningQuestionStatus(q.id, "ready", "test")
			expect(ready?.status).toBe("ready")

			// ready → approved
			const approved = await changeScreeningQuestionStatus(q.id, "approved", "test")
			expect(approved?.status).toBe("approved")

			// approved → draft (reset)
			const reset = await changeScreeningQuestionStatus(q.id, "draft", "test")
			expect(reset?.status).toBe("draft")
		})

		it("rejects invalid transitions", async () => {
			const section = await createSectionRow("invalid-transitions")
			const q = await createScreeningQuestion("Invalid transition test", null, "test", section, "boolean")

			// draft → approved is not allowed
			await expect(changeScreeningQuestionStatus(q.id, "approved", "test")).rejects.toMatchObject({ status: 400 })
		})

		it("rejects status change on archived questions", async () => {
			const section = await createSectionRow("archived-status")
			const q = await createScreeningQuestion("Archived test", null, "test", section, "boolean")
			await archiveScreeningQuestion(q.id, "test")

			await expect(changeScreeningQuestionStatus(q.id, "ready", "test")).rejects.toMatchObject({ status: 403 })
		})

		it("writes audit log with correct action and values", async () => {
			const section = await createSectionRow("audit-status")
			const q = await createScreeningQuestion("Audit status test", null, "test", section, "boolean")

			await changeScreeningQuestionStatus(q.id, "ready", "tester")

			const audit = await getAuditByAction("screening_question_status_changed")
			const entry = audit.find((a) => a.entity_id === q.id)
			expect(entry).toBeDefined()
			expect(entry?.performed_by).toBe("tester")

			const db = getTestDb()
			const fullEntry = await db.execute(
				/* sql */ `SELECT previous_value, new_value FROM audit_log WHERE action = 'screening_question_status_changed' AND entity_id = '${q.id}'`,
			)
			const row = fullEntry.rows[0] as { previous_value: string; new_value: string }
			expect(JSON.parse(row.previous_value)).toEqual({ status: "draft" })
			expect(JSON.parse(row.new_value)).toEqual({ status: "ready" })
		})

		it("returns existing question unchanged when status matches", async () => {
			const section = await createSectionRow("noop-status")
			const q = await createScreeningQuestion("Noop test", null, "test", section, "boolean")
			const result = await changeScreeningQuestionStatus(q.id, "draft", "test")
			expect(result?.status).toBe("draft")
		})
	})

	describe("getScreeningDataForApp", () => {
		it("viser alle godkjente spørsmål uavhengig av appens teknologielementer", async () => {
			const section = await createSectionRow("test-section")
			const naisTeamId = await createNaisTeam("test-team", section)
			const appId = await createApp("test-app")
			await createAppEnvironment(appId, naisTeamId)

			const techElemId = await createTechElement("database")

			// Create 3 section questions, all approved
			const q1 = await createScreeningQuestion("Boolean question?", null, "test", section, "boolean")
			await changeScreeningQuestionStatus(q1.id, "ready", "test")
			await changeScreeningQuestionStatus(q1.id, "approved", "test")

			const q2 = await createScreeningQuestion("Persistence question?", null, "test", section, "persistence")
			await changeScreeningQuestionStatus(q2.id, "ready", "test")
			await changeScreeningQuestionStatus(q2.id, "approved", "test")

			const q3 = await createScreeningQuestion("Entra groups?", null, "test", section, "entra_id_groups")
			await changeScreeningQuestionStatus(q3.id, "ready", "test")
			await changeScreeningQuestionStatus(q3.id, "approved", "test")

			// Link all 3 questions to the "database" tech element
			await setQuestionTechnologyElements(q1.id, [techElemId], "test")
			await setQuestionTechnologyElements(q2.id, [techElemId], "test")
			await setQuestionTechnologyElements(q3.id, [techElemId], "test")

			// App has NO tech elements — alle 3 spørsmål skal vises uansett
			const result = await getScreeningDataForApp(appId)

			expect(result.questions).toHaveLength(3)
			const types = result.questions.map((q) => q.answerType)
			expect(types).toContain("persistence")
			expect(types).toContain("entra_id_groups")
			expect(types).toContain("boolean")
		})

		it("viser spørsmål med tech-element-kobling selv om appen mangler elementet", async () => {
			const section = await createSectionRow("test-section-2")
			const naisTeamId = await createNaisTeam("test-team-2", section)
			const appId = await createApp("test-app-2")
			await createAppEnvironment(appId, naisTeamId)

			const techElemId = await createTechElement("database")

			const q1 = await createScreeningQuestion("Boolean question?", null, "test", section, "boolean")
			await changeScreeningQuestionStatus(q1.id, "ready", "test")
			await changeScreeningQuestionStatus(q1.id, "approved", "test")
			await setQuestionTechnologyElements(q1.id, [techElemId], "test")

			const q2 = await createScreeningQuestion("Persistence question?", null, "test", section, "persistence")
			await changeScreeningQuestionStatus(q2.id, "ready", "test")
			await changeScreeningQuestionStatus(q2.id, "approved", "test")
			await setQuestionTechnologyElements(q2.id, [techElemId], "test")

			const result = await getScreeningDataForApp(appId)

			// Begge vises — appen trenger ikke ha tech-elementet for å se spørsmålene
			expect(result.questions).toHaveLength(2)
			const types = result.questions.map((q) => q.answerType)
			expect(types).toContain("boolean")
			expect(types).toContain("persistence")
		})

		it("includes questions with no tech element links for all apps", async () => {
			const section = await createSectionRow("test-section-3")
			const naisTeamId = await createNaisTeam("test-team-3", section)
			const appId = await createApp("test-app-3")
			await createAppEnvironment(appId, naisTeamId)

			const q1 = await createScreeningQuestion("No tech links?", null, "test", section, "boolean")
			await changeScreeningQuestionStatus(q1.id, "ready", "test")
			await changeScreeningQuestionStatus(q1.id, "approved", "test")
			// No tech elements linked → applies to all apps

			const result = await getScreeningDataForApp(appId)
			expect(result.questions).toHaveLength(1)
			expect(result.questions[0].questionText).toBe("No tech links?")
		})

		it("excludes section questions for apps in disabled environments", async () => {
			const db = getTestDb()
			const section = await createSectionRow("test-disabled-env")
			const naisTeamId = await createNaisTeam("test-team-disabled", section)
			const appId = await createApp("test-app-disabled")
			await createAppEnvironment(appId, naisTeamId, "dev-gcp")

			// Disable the dev-gcp cluster
			await db.execute(
				`INSERT INTO section_environments (section_id, cluster, included, added_by, updated_by) VALUES ('${section}', 'dev-gcp', false, 'test', 'test')`,
			)

			const q1 = await createScreeningQuestion("Section question?", null, "test", section, "boolean")
			await changeScreeningQuestionStatus(q1.id, "ready", "test")
			await changeScreeningQuestionStatus(q1.id, "approved", "test")

			const result = await getScreeningDataForApp(appId)
			// App is in disabled environment, so it should not see section-scoped questions
			expect(result.questions).toHaveLength(0)
		})

		it("includes app if it has at least one enabled environment", async () => {
			const db = getTestDb()
			const section = await createSectionRow("test-multi-env-section")
			const naisTeamId = await createNaisTeam("test-team-multi", section)
			const appId = await createApp("test-app-multi")
			await createAppEnvironment(appId, naisTeamId, "dev-gcp")
			await createAppEnvironment(appId, naisTeamId, "prod-gcp")

			// Disable only dev-gcp
			await db.execute(
				`INSERT INTO section_environments (section_id, cluster, included, added_by, updated_by) VALUES ('${section}', 'dev-gcp', false, 'test', 'test')`,
			)

			const q1 = await createScreeningQuestion("Section question?", null, "test", section, "boolean")
			await changeScreeningQuestionStatus(q1.id, "ready", "test")
			await changeScreeningQuestionStatus(q1.id, "approved", "test")

			const result = await getScreeningDataForApp(appId)
			// App has prod-gcp enabled, so it should see section questions
			expect(result.questions).toHaveLength(1)
			expect(result.questions[0].questionText).toBe("Section question?")
		})
	})

	describe("isEffectOwnedByQuestion", () => {
		it("returnerer true når effect tilhører spørsmålet via choice", async () => {
			const sectionId = await createSectionRow("effect-own")
			await createControl("K-EO.01")
			const q = await createScreeningQuestion("Eier-test?", null, "test", sectionId)
			const choice = await createChoice({ questionId: q.id, label: "Ja" })
			const effect = await addChoiceEffect({
				choiceId: choice.id,
				controlTextId: "K-EO.01",
				effect: "not_relevant",
				comment: null,
			})

			const result = await isEffectOwnedByQuestion(effect.id, q.id)
			expect(result).toBe(true)
		})

		it("returnerer false når effect tilhører et annet spørsmål", async () => {
			const sectionId = await createSectionRow("effect-own2")
			await createControl("K-EO.02")
			const q1 = await createScreeningQuestion("Spørsmål 1?", null, "test", sectionId)
			const q2 = await createScreeningQuestion("Spørsmål 2?", null, "test", sectionId)
			const choice1 = await createChoice({ questionId: q1.id, label: "Ja" })
			const effect = await addChoiceEffect({
				choiceId: choice1.id,
				controlTextId: "K-EO.02",
				effect: "not_relevant",
				comment: null,
			})

			const result = await isEffectOwnedByQuestion(effect.id, q2.id)
			expect(result).toBe(false)
		})

		it("returnerer false for ikke-eksisterende effect-ID", async () => {
			const sectionId = await createSectionRow("effect-own3")
			const q = await createScreeningQuestion("Finnes ikke?", null, "test", sectionId)

			const result = await isEffectOwnedByQuestion("00000000-0000-0000-0000-000000000000", q.id)
			expect(result).toBe(false)
		})
	})
})
