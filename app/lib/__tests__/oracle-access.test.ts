import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("oracle-access", () => {
	let canUserSeeInstance: typeof import("../oracle-access.server").canUserSeeInstance
	let filterInstancesByAccess: typeof import("../oracle-access.server").filterInstancesByAccess

	beforeEach(async () => {
		vi.resetModules()
		process.env.KISS_ADMIN_GROUP_IDS = "admin-group-1,admin-group-2"
		const mod = await import("../oracle-access.server")
		canUserSeeInstance = mod.canUserSeeInstance
		filterInstancesByAccess = mod.filterInstancesByAccess
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("canUserSeeInstance", () => {
		it("allows access to instances with no group (null)", () => {
			expect(canUserSeeInstance({ group: null }, [])).toBe(true)
			expect(canUserSeeInstance({ group: null }, ["some-group"])).toBe(true)
		})

		it("allows access when user is in the instance's group", () => {
			expect(canUserSeeInstance({ group: "group-a" }, ["group-a"])).toBe(true)
			expect(canUserSeeInstance({ group: "group-a" }, ["other", "group-a"])).toBe(true)
		})

		it("denies access when user is NOT in the instance's group", () => {
			expect(canUserSeeInstance({ group: "group-a" }, [])).toBe(false)
			expect(canUserSeeInstance({ group: "group-a" }, ["group-b", "group-c"])).toBe(false)
		})

		it("allows access for admin group members regardless of instance group", () => {
			expect(canUserSeeInstance({ group: "group-a" }, ["admin-group-1"])).toBe(true)
			expect(canUserSeeInstance({ group: "group-a" }, ["admin-group-2"])).toBe(true)
		})

		it("denies access when no admin groups configured and user not in instance group", async () => {
			vi.resetModules()
			delete process.env.KISS_ADMIN_GROUP_IDS
			const mod = await import("../oracle-access.server")
			expect(mod.canUserSeeInstance({ group: "group-a" }, ["not-admin"])).toBe(false)
		})
	})

	describe("filterInstancesByAccess", () => {
		const instances = [
			{ id: "pen", group: "group-a" },
			{ id: "sam", group: "group-a" },
			{ id: "tp", group: "group-b" },
			{ id: "popp", group: null },
		]

		it("returns all instances for admin users", () => {
			const result = filterInstancesByAccess(instances, ["admin-group-1"])
			expect(result).toHaveLength(4)
		})

		it("returns only matching and open instances for regular users", () => {
			const result = filterInstancesByAccess(instances, ["group-a"])
			expect(result.map((i) => i.id)).toEqual(["pen", "sam", "popp"])
		})

		it("returns only open instances when user has no matching groups", () => {
			const result = filterInstancesByAccess(instances, ["unrelated-group"])
			expect(result.map((i) => i.id)).toEqual(["popp"])
		})

		it("returns only open instances for empty group list", () => {
			const result = filterInstancesByAccess(instances, [])
			expect(result.map((i) => i.id)).toEqual(["popp"])
		})

		it("preserves original instance objects", () => {
			const result = filterInstancesByAccess(instances, ["group-a"])
			expect(result[0]).toBe(instances[0])
		})
	})
})
