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
	deleteTechnologyElement,
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

		it("deletes an unused element", async () => {
			const el = await createTechnologyElement("Temp", "temp", null, 0, "admin")
			await deleteTechnologyElement(el.id, "admin")

			const audit = await getAuditEntries("technology_element_deleted", el.id)
			expect(audit).toHaveLength(1)

			const all = await getAllTechnologyElements()
			expect(all.find((e) => e.id === el.id)).toBeUndefined()
		})

		it("refuses to delete an element used by a control", async () => {
			const el = await createTechnologyElement("Used", "used", null, 0, "admin")
			const controlId = await createControl("K-XX.01")
			await addControlElement(controlId, el.id, "admin")

			await expect(deleteTechnologyElement(el.id, "admin")).rejects.toThrow(/brukt av/)
		})

		it("refuses to delete an element used by an application", async () => {
			const el = await createTechnologyElement("Used2", "used2", null, 0, "admin")
			const appId = await createApp("App1")
			await addApplicationElement(appId, el.id)

			await expect(deleteTechnologyElement(el.id, "admin")).rejects.toThrow(/brukt av/)
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
			await addApplicationElement(app, el.id)

			const result = await getTechnologyElementWithCounts(el.id)
			expect(result?.controlCount).toBe(2)
			expect(result?.appCount).toBe(1)
		})

		it("getApplicationElements lists linked elements", async () => {
			const el = await createTechnologyElement("Cache", "cache", null, 0, "admin")
			const app = await createApp("AppX")
			await addApplicationElement(app, el.id)

			const linked = await getApplicationElements(app)
			expect(linked.map((e) => e.slug)).toEqual(["cache"])
			expect(linked[0].source).toBe("manual")
		})
	})
})
