import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { getTestDb, setupTestDatabase, teardownTestDatabase } from "./setup"

vi.mock("~/db/connection.server", () => ({
	get db() {
		return getTestDb()
	},
	get pool() {
		return null
	},
}))

const {
	createTechnologyElement,
	updateTechnologyElement,
	archiveTechnologyElement,
	unarchiveTechnologyElement,
	getAllTechnologyElements,
	addControlElement,
	removeControlElement,
	getControlElements,
	getTechnologyElementWithCounts,
	addApplicationElement,
	getApplicationElements,
} = await import("~/db/queries/technology-elements.server")

async function createApp(name: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `INSERT INTO monitored_applications (name, created_by, updated_by) VALUES ('${name}', 'test', 'test') RETURNING id`,
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

async function getAuditEntries(action: string, entityId: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `SELECT action, performed_by FROM audit_log WHERE action = '${action}' AND entity_id = '${entityId}'`,
	)
	return r.rows as Array<{ action: string; performed_by: string }>
}

describe("technology-elements.server integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	}, 120_000)

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM screening_question_technology_elements;
			DELETE FROM screening_questions;
			DELETE FROM application_technology_elements;
			DELETE FROM control_technology_elements;
			DELETE FROM technology_elements;
			DELETE FROM framework_controls;
			DELETE FROM monitored_applications;
			DELETE FROM audit_log;
		`)
	})

	describe("CRUD", () => {
		it("creates a technology element with audit log", async () => {
			const el = await createTechnologyElement("Kubernetes", "kubernetes", "Container orchestration", 1, "admin")
			expect(el.name).toBe("Kubernetes")
			expect(el.slug).toBe("kubernetes")
			expect(el.displayOrder).toBe(1)

			const audit = await getAuditEntries("technology_element_created", el.id)
			expect(audit).toHaveLength(1)
		})

		it("updates a technology element", async () => {
			const el = await createTechnologyElement("Docker", "docker", null, 2, "admin")
			const updated = await updateTechnologyElement(el.id, { name: "Containerd", slug: "containerd" }, "editor")
			expect(updated.name).toBe("Containerd")
			expect(updated.slug).toBe("containerd")

			const audit = await getAuditEntries("technology_element_updated", el.id)
			expect(audit).toHaveLength(1)
		})

		it("returns elements ordered by displayOrder", async () => {
			await createTechnologyElement("B", "b", null, 5, "admin")
			await createTechnologyElement("A", "a", null, 1, "admin")
			await createTechnologyElement("C", "c", null, 3, "admin")

			const all = await getAllTechnologyElements()
			expect(all.map((e) => e.slug)).toEqual(["a", "c", "b"])
		})

		it("archives an element and reactivates it (idempotent + atomic + audit-in-tx)", async () => {
			const el = await createTechnologyElement("Temp", "temp", null, 0, "admin")
			const archived = await archiveTechnologyElement(el.id, "admin")
			expect(archived.archivedAt).toBeInstanceOf(Date)
			expect(archived.archivedBy).toBe("admin")

			// Idempotent: andre kall returnerer samme rad uten ekstra audit
			await archiveTechnologyElement(el.id, "admin")
			let audit = await getAuditEntries("technology_element_archived", el.id)
			expect(audit).toHaveLength(1)

			// Default getAllTechnologyElements skjuler arkiverte
			const active = await getAllTechnologyElements()
			expect(active.find((e) => e.id === el.id)).toBeUndefined()
			const all = await getAllTechnologyElements({ includeArchived: true })
			expect(all.find((e) => e.id === el.id)).toBeDefined()

			// Reactivate
			const reactivated = await unarchiveTechnologyElement(el.id, "reactivator")
			expect(reactivated.archivedAt).toBeNull()
			expect(reactivated.archivedBy).toBeNull()
			audit = await getAuditEntries("technology_element_unarchived", el.id)
			expect(audit).toHaveLength(1)
		})

		it("hard delete is blocked by FK RESTRICT when used by a control", async () => {
			const el = await createTechnologyElement("Used", "used", null, 0, "admin")
			const controlId = await createControl("K-XX.01")
			await addControlElement(controlId, el.id, "admin")

			const db = getTestDb()
			await expect(db.execute(/* sql */ `DELETE FROM technology_elements WHERE id = '${el.id}'`)).rejects.toThrow()
		})

		it("rejects updateTechnologyElement on archived element", async () => {
			const el = await createTechnologyElement("Frozen", "frozen", null, 0, "admin")
			await archiveTechnologyElement(el.id, "admin")
			await expect(updateTechnologyElement(el.id, { name: "X" }, "admin")).rejects.toThrow(/arkivert/i)
		})

		it("rejects updateTechnologyElement with not-found error for unknown id", async () => {
			await expect(
				updateTechnologyElement("00000000-0000-0000-0000-000000000000", { name: "X" }, "admin"),
			).rejects.toThrow(/ikke funnet/i)
		})

		it("rejects addControlElement to archived element", async () => {
			const el = await createTechnologyElement("Old", "old", null, 0, "admin")
			await archiveTechnologyElement(el.id, "admin")
			const controlId = await createControl("K-YY.01")
			await expect(addControlElement(controlId, el.id, "admin")).rejects.toThrow(/arkivert/i)
		})

		it("rejects addApplicationElement to archived element", async () => {
			const el = await createTechnologyElement("Old2", "old2", null, 0, "admin")
			await archiveTechnologyElement(el.id, "admin")
			const appId = await createApp("App1")
			await expect(addApplicationElement(appId, el.id, "test-user")).rejects.toThrow(/arkivert/i)
		})
	})

	describe("Control element linking", () => {
		it("adds and removes control element with audit", async () => {
			const el = await createTechnologyElement("Postgres", "postgres", null, 0, "admin")
			const controlId = await createControl("K-DB.01")

			await addControlElement(controlId, el.id, "admin")
			const linked = await getControlElements(controlId)
			expect(linked.map((e) => e.slug)).toEqual(["postgres"])
			const addedAuditEntries = await getAuditEntries("control_element_added", controlId)
			expect(addedAuditEntries).toHaveLength(1)
			expect(addedAuditEntries[0]).toEqual({
				action: "control_element_added",
				performed_by: "admin",
			})

			await removeControlElement(controlId, el.id, "admin")
			const after = await getControlElements(controlId)
			expect(after).toHaveLength(0)
			const removedAuditEntries = await getAuditEntries("control_element_removed", controlId)
			expect(removedAuditEntries).toHaveLength(1)
			expect(removedAuditEntries[0]).toEqual({
				action: "control_element_removed",
				performed_by: "admin",
			})
		})
	})

	describe("Application elements", () => {
		it("counts control and application usage", async () => {
			const el = await createTechnologyElement("Logging", "logging", null, 0, "admin")
			const c1 = await createControl("K-L.01")
			const c2 = await createControl("K-L.02")
			const app = await createApp("LogApp")
			await addControlElement(c1, el.id, "admin")
			await addControlElement(c2, el.id, "admin")
			await addApplicationElement(app, el.id, "test-user")

			const result = await getTechnologyElementWithCounts(el.id)
			expect(result?.controlCount).toBe(2)
			expect(result?.appCount).toBe(1)
		})

		it("getApplicationElements lists linked elements", async () => {
			const el = await createTechnologyElement("Cache", "cache", null, 0, "admin")
			const app = await createApp("AppX")
			await addApplicationElement(app, el.id, "test-user")

			const linked = await getApplicationElements(app)
			expect(linked.map((e) => e.slug)).toEqual(["cache"])
			expect(linked[0].source).toBe("manual")
		})

		it("syncApplicationTechnologyElements bevarer auto-koblinger til arkiverte elementer", async () => {
			const { syncApplicationTechnologyElements } = await import("~/db/queries/technology-elements.server")
			const el = await createTechnologyElement("Applikasjon", "applikasjon", null, 0, "admin")
			const app = await createApp("PreservedApp")

			// Første sync gir auto-kobling (slug "applikasjon" tildeles alle apper)
			await syncApplicationTechnologyElements(app)
			let linked = await getApplicationElements(app)
			expect(linked.map((e) => e.slug)).toEqual(["applikasjon"])

			// Arkiver elementet
			await archiveTechnologyElement(el.id, "admin")

			// Re-sync skal IKKE fjerne den eksisterende auto-koblingen
			await syncApplicationTechnologyElements(app)
			linked = await getApplicationElements(app)
			expect(linked.map((e) => e.slug)).toEqual(["applikasjon"])
		})

		it("setQuestionTechnologyElements bevarer arkiverte koblinger ved full replacement", async () => {
			const { setQuestionTechnologyElements, getQuestionTechnologyElements } = await import(
				"~/db/queries/screening.server"
			)
			const db = getTestDb()
			const elActive = await createTechnologyElement("Aktiv", "aktiv-q", null, 0, "admin")
			const elArchived = await createTechnologyElement("Arkivert", "arkivert-q", null, 0, "admin")
			const r = await db.execute(
				/* sql */ `INSERT INTO screening_questions (question_text, answer_type, display_order, created_by, updated_by) VALUES ('Q1', 'boolean', 0, 'test', 'test') RETURNING id`,
			)
			const qId = (r.rows[0] as { id: string }).id

			await setQuestionTechnologyElements(qId, [elActive.id, elArchived.id], "test-user")
			await archiveTechnologyElement(elArchived.id, "admin")

			// Edit-skjema rendrer kun aktive elementer; vi sender derfor bare elActive
			await setQuestionTechnologyElements(qId, [elActive.id], "test-user")

			const linked = await getQuestionTechnologyElements(qId)
			expect(linked.map((l) => l.elementId).sort()).toEqual([elActive.id, elArchived.id].sort())
		})
	})

	describe("SD6 audit logging", () => {
		it("addApplicationElement and removeApplicationElement write audit", async () => {
			const { removeApplicationElement } = await import("~/db/queries/technology-elements.server")
			const el = await createTechnologyElement("Audit", "audit-app-el", null, 0, "admin")
			const app = await createApp("AuditApp")

			await addApplicationElement(app, el.id, "alice")
			let added = await getAuditEntries("application_technology_element_added", app)
			expect(added).toHaveLength(1)
			expect(added[0].performed_by).toBe("alice")

			// Re-add must be silent (ON CONFLICT DO NOTHING returns no row).
			await addApplicationElement(app, el.id, "alice")
			added = await getAuditEntries("application_technology_element_added", app)
			expect(added).toHaveLength(1)

			await removeApplicationElement(app, el.id, "bob")
			let removed = await getAuditEntries("application_technology_element_removed", app)
			expect(removed).toHaveLength(1)
			expect(removed[0].performed_by).toBe("bob")

			// Re-remove must be silent.
			await removeApplicationElement(app, el.id, "bob")
			removed = await getAuditEntries("application_technology_element_removed", app)
			expect(removed).toHaveLength(1)
		})

		it("removeControlElement does not audit when nothing was deleted", async () => {
			const el = await createTechnologyElement("NoOp", "noop-el", null, 0, "admin")
			const controlId = await createControl("K-NOOP.01")

			// No prior link — remove should be a silent no-op (no audit row).
			await removeControlElement(controlId, el.id, "alice")
			const removed = await getAuditEntries("control_element_removed", controlId)
			expect(removed).toHaveLength(0)
		})
	})
})
