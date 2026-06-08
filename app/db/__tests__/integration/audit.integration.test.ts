import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { auditLog } from "~/db/schema/audit"
import { getTestDb, getTestPool, setupTestDatabase, teardownTestDatabase } from "./setup"

vi.mock("~/db/connection.server", () => ({
	get db() {
		return getTestDb()
	},
	get pool() {
		return getTestPool()
	},
}))

const { writeAuditLog, getAuditLogForEntity, getRecentAuditLog, getAuditLogByAction, getRecentAuditLogByEntityTypes } =
	await import("~/db/queries/audit.server")

describe("Audit log integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	})

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `DELETE FROM audit_log`)
	})

	it("should write an audit log entry", async () => {
		await writeAuditLog({
			action: "framework_imported",
			entityType: "framework_version",
			entityId: "test-entity-1",
			newValue: "test-file.xlsx",
			performedBy: "Z990001",
		})

		const db = getTestDb()
		const result = await db.execute(/* sql */ `SELECT * FROM audit_log`)
		expect(result.rows).toHaveLength(1)

		const row = result.rows[0] as Record<string, unknown>
		expect(row.action).toBe("framework_imported")
		expect(row.entity_type).toBe("framework_version")
		expect(row.entity_id).toBe("test-entity-1")
		expect(row.new_value).toBe("test-file.xlsx")
		expect(row.performed_by).toBe("Z990001")
	})

	it("should filter audit log by entity", async () => {
		await writeAuditLog({
			action: "framework_imported",
			entityType: "framework_version",
			entityId: "version-1",
			performedBy: "Z990001",
		})
		await writeAuditLog({
			action: "framework_activated",
			entityType: "framework_version",
			entityId: "version-1",
			performedBy: "Z990002",
		})
		await writeAuditLog({
			action: "team_created",
			entityType: "team",
			entityId: "team-1",
			performedBy: "Z990001",
		})

		const logs = await getAuditLogForEntity("framework_version", "version-1")
		expect(logs).toHaveLength(2)
		expect(logs.every((l) => l.entityType === "framework_version")).toBe(true)
		expect(logs.every((l) => l.entityId === "version-1")).toBe(true)
	})

	it("should store and retrieve metadata", async () => {
		await writeAuditLog({
			action: "framework_imported",
			entityType: "framework_version",
			entityId: "version-1",
			metadata: { domainCount: 3, riskCount: 5, controlCount: 10 },
			performedBy: "Z990001",
		})

		const logs = await getAuditLogForEntity("framework_version", "version-1")
		expect(logs).toHaveLength(1)
		expect(logs[0].metadata).toBeDefined()

		const metadata = JSON.parse(logs[0].metadata ?? "{}")
		expect(metadata.domainCount).toBe(3)
		expect(metadata.riskCount).toBe(5)
		expect(metadata.controlCount).toBe(10)
	})

	it("should return recent audit log entries ordered by date", async () => {
		await writeAuditLog({
			action: "framework_imported",
			entityType: "framework_version",
			entityId: "v1",
			performedBy: "Z990001",
		})
		await writeAuditLog({
			action: "framework_activated",
			entityType: "framework_version",
			entityId: "v1",
			performedBy: "Z990001",
		})
		await writeAuditLog({
			action: "team_created",
			entityType: "team",
			entityId: "t1",
			performedBy: "Z990001",
		})

		const recent = await getRecentAuditLog(10)
		expect(recent).toHaveLength(3)
		// Most recent first
		expect(recent[0].action).toBe("team_created")
	})

	it("should filter by action type", async () => {
		await writeAuditLog({
			action: "framework_imported",
			entityType: "framework_version",
			entityId: "v1",
			performedBy: "Z990001",
		})
		await writeAuditLog({
			action: "team_created",
			entityType: "team",
			entityId: "t1",
			performedBy: "Z990001",
		})
		await writeAuditLog({
			action: "team_created",
			entityType: "team",
			entityId: "t2",
			performedBy: "Z990001",
		})

		const teamLogs = await getAuditLogByAction("team_created")
		expect(teamLogs).toHaveLength(2)
		expect(teamLogs.every((l) => l.action === "team_created")).toBe(true)
	})

	describe("getRecentAuditLogByEntityTypes", () => {
		it("should return only entries matching the given entity types", async () => {
			await writeAuditLog({ action: "section_created", entityType: "section", entityId: "s1", performedBy: "Z990001" })
			await writeAuditLog({ action: "team_created", entityType: "team", entityId: "t1", performedBy: "Z990001" })
			await writeAuditLog({
				action: "framework_imported",
				entityType: "framework_version",
				entityId: "v1",
				performedBy: "Z990001",
			})

			const results = await getRecentAuditLogByEntityTypes(["section", "team"])
			expect(results).toHaveLength(2)
			expect(results.every((r) => r.entityType === "section" || r.entityType === "team")).toBe(true)
		})

		it("should return entries ordered by performed_at descending", async () => {
			const db = getTestDb()
			const older = new Date("2024-01-01T10:00:00Z")
			const newer = new Date("2024-01-01T11:00:00Z")
			await db.insert(auditLog).values({
				action: "section_created",
				entityType: "section",
				entityId: "s1",
				performedBy: "Z990001",
				performedAt: older,
			})
			await db.insert(auditLog).values({
				action: "team_created",
				entityType: "team",
				entityId: "t1",
				performedBy: "Z990001",
				performedAt: newer,
			})

			const results = await getRecentAuditLogByEntityTypes(["section", "team"])
			expect(results).toHaveLength(2)
			expect(new Date(results[0].performedAt) >= new Date(results[1].performedAt)).toBe(true)
			expect(results[0].action).toBe("team_created")
			expect(results[1].action).toBe("section_created")
		})

		it("should respect the limit parameter", async () => {
			await writeAuditLog({ action: "section_created", entityType: "section", entityId: "s1", performedBy: "Z990001" })
			await writeAuditLog({ action: "section_created", entityType: "section", entityId: "s2", performedBy: "Z990001" })
			await writeAuditLog({ action: "section_created", entityType: "section", entityId: "s3", performedBy: "Z990001" })

			const results = await getRecentAuditLogByEntityTypes(["section"], 2)
			expect(results).toHaveLength(2)
		})

		it("should return empty array when entityTypes is empty", async () => {
			await writeAuditLog({ action: "section_created", entityType: "section", entityId: "s1", performedBy: "Z990001" })

			const results = await getRecentAuditLogByEntityTypes([])
			expect(results).toHaveLength(0)
		})

		it("should return empty array when no entries match", async () => {
			await writeAuditLog({
				action: "framework_imported",
				entityType: "framework_version",
				entityId: "v1",
				performedBy: "Z990001",
			})

			const results = await getRecentAuditLogByEntityTypes(["section", "team"])
			expect(results).toHaveLength(0)
		})
	})

	it("should store previous and new values", async () => {
		await writeAuditLog({
			action: "risk_short_title_updated",
			entityType: "framework_risk",
			entityId: "R-TS.01",
			previousValue: "Old title",
			newValue: "New title",
			performedBy: "Z990002",
		})

		const logs = await getAuditLogForEntity("framework_risk", "R-TS.01")
		expect(logs).toHaveLength(1)
		expect(logs[0].previousValue).toBe("Old title")
		expect(logs[0].newValue).toBe("New title")
	})
})
