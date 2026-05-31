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

const { writeAuditLog, getAuditLogForEntity, getRecentAuditLog, getAuditLogByAction } = await import(
	"~/db/queries/audit.server"
)

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
