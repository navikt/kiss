import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { getTestDb, getTestPool, setupTestDatabase, teardownTestDatabase, truncateWithRetry } from "./setup"

vi.mock("~/db/connection.server", () => ({
	get db() {
		return getTestDb()
	},
	get pool() {
		return getTestPool()
	},
}))

const { getRpaMemberByUserObjectId } = await import("~/db/queries/rpa.server")

describe("RPA member detail query", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	})

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		await truncateWithRetry(["rpa_group_members", "rpa_groups"])
	})

	it("har user-ledende indeks for aktive rpa_group_members", async () => {
		const db = getTestDb()
		const result = await db.execute(
			/* sql */ `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'rpa_group_members_user_active_idx'`,
		)

		expect(result.rows.map((r) => (r as { indexname: string }).indexname)).toContain(
			"rpa_group_members_user_active_idx",
		)
		const indexDef = (result.rows[0] as { indexdef: string }).indexdef
		expect(indexDef).toContain("USING btree (user_object_id)")
		expect(indexDef).toContain("WHERE (archived_at IS NULL)")
	})

	it("bruker ferskeste medlemssync-rad for brukerfelter og Entra groupId fallback for gruppenavn", async () => {
		const db = getTestDb()

		await db.execute(/* sql */ `
			INSERT INTO rpa_groups (id, group_id, group_name, created_by, updated_by)
			VALUES
				('00000000-0000-0000-0000-000000000101', 'entra-rpa-1', 'Pensjon-RPA-Gruppe', 'test', 'test'),
				('00000000-0000-0000-0000-000000000102', 'entra-rpa-2', NULL, 'test', 'test')
		`)

		await db.execute(/* sql */ `
			INSERT INTO rpa_group_members (rpa_group_id, user_object_id, display_name, user_principal_name, account_enabled, synced_at)
			VALUES
				('00000000-0000-0000-0000-000000000101', 'user-obj-1', 'Eldre navn', 'old@nav.no', false, '2026-05-14T08:00:00.000Z'),
				('00000000-0000-0000-0000-000000000102', 'user-obj-1', 'Nyere navn', 'new@nav.no', true,  '2026-05-14T09:00:00.000Z')
		`)

		const detail = await getRpaMemberByUserObjectId("user-obj-1")
		expect(detail).toBeTruthy()
		if (!detail) return

		expect(detail.displayName).toBe("Nyere navn")
		expect(detail.userPrincipalName).toBe("new@nav.no")
		expect(detail.accountEnabled).toBe(true)

		expect(detail.rpaGroups).toHaveLength(2)
		expect(detail.rpaGroups.map((g) => g.groupName)).toEqual(
			expect.arrayContaining(["Pensjon-RPA-Gruppe", "entra-rpa-2"]),
		)
	})
})
