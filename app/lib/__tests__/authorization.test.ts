import { describe, expect, it } from "vitest"
import type { NavUser } from "../auth.server"
import { canApproveRoutine, hasRole, hasRoleForSection, isAdmin } from "../authorization.server"

function makeUser(overrides: Partial<NavUser> = {}): NavUser {
	return {
		navIdent: "T123456",
		name: "Test Testesen",
		groups: [],
		token: "fake-token",
		dbRoles: [],
		...overrides,
	}
}

describe("canApproveRoutine", () => {
	const sectionId = "section-1"

	it("admin can always approve regardless of responsibleRole", () => {
		const adminUser = makeUser({
			groups: [process.env.KISS_ADMIN_GROUP_IDS?.split(",")[0] ?? ""],
			dbRoles: [{ role: "admin", sectionId: null, devTeamId: null }],
		})
		expect(canApproveRoutine(adminUser, null, sectionId)).toBe(true)
		expect(canApproveRoutine(adminUser, "Teknologileder", sectionId)).toBe(true)
		expect(canApproveRoutine(adminUser, "Produktleder", sectionId)).toBe(true)
	})

	it("returns false for non-admin when responsibleRole is null", () => {
		const user = makeUser()
		expect(canApproveRoutine(user, null, sectionId)).toBe(false)
	})

	it("Teknologileder role maps to tech_manager for section", () => {
		const user = makeUser({
			dbRoles: [{ role: "tech_manager", sectionId, devTeamId: null }],
		})
		expect(canApproveRoutine(user, "Teknologileder", sectionId)).toBe(true)
	})

	it("Teknologileder role fails for wrong section", () => {
		const user = makeUser({
			dbRoles: [{ role: "tech_manager", sectionId: "other-section", devTeamId: null }],
		})
		expect(canApproveRoutine(user, "Teknologileder", sectionId)).toBe(false)
	})

	it("Produktleder role maps to product_owner for section", () => {
		const user = makeUser({
			dbRoles: [{ role: "product_owner", sectionId, devTeamId: null }],
		})
		expect(canApproveRoutine(user, "Produktleder", sectionId)).toBe(true)
	})

	it("Seksjonsleder role maps to section_manager", () => {
		const user = makeUser({
			dbRoles: [{ role: "section_manager", sectionId, devTeamId: null }],
		})
		expect(canApproveRoutine(user, "Seksjonsleder", sectionId)).toBe(true)
	})

	it("returns false for unknown responsibleRole", () => {
		const user = makeUser({
			dbRoles: [{ role: "tech_manager", sectionId, devTeamId: null }],
		})
		expect(canApproveRoutine(user, "UkjentRolle", sectionId)).toBe(false)
	})

	it("returns false for user with wrong role", () => {
		const user = makeUser({
			dbRoles: [{ role: "product_owner", sectionId, devTeamId: null }],
		})
		expect(canApproveRoutine(user, "Teknologileder", sectionId)).toBe(false)
	})
})

describe("isAdmin", () => {
	it("returns true for user with admin dbRole", () => {
		const user = makeUser({
			dbRoles: [{ role: "admin", sectionId: null, devTeamId: null }],
		})
		expect(isAdmin(user)).toBe(true)
	})

	it("returns false for user without admin role", () => {
		const user = makeUser()
		expect(isAdmin(user)).toBe(false)
	})
})

describe("hasRole", () => {
	it("returns true when user has the role in dbRoles", () => {
		const user = makeUser({
			dbRoles: [{ role: "tech_manager", sectionId: "s1", devTeamId: null }],
		})
		expect(hasRole(user, "tech_manager")).toBe(true)
	})

	it("returns false when user lacks the role", () => {
		const user = makeUser()
		expect(hasRole(user, "tech_manager")).toBe(false)
	})
})

describe("hasRoleForSection", () => {
	const sectionId = "section-1"

	it("returns true when user has role scoped to the section", () => {
		const user = makeUser({
			dbRoles: [{ role: "tech_manager", sectionId, devTeamId: null }],
		})
		expect(hasRoleForSection(user, "tech_manager", sectionId)).toBe(true)
	})

	it("returns false when user has role for different section", () => {
		const user = makeUser({
			dbRoles: [{ role: "tech_manager", sectionId: "other", devTeamId: null }],
		})
		expect(hasRoleForSection(user, "tech_manager", sectionId)).toBe(false)
	})

	it("returns true for admin regardless of section", () => {
		const user = makeUser({
			dbRoles: [{ role: "admin", sectionId: null, devTeamId: null }],
		})
		expect(hasRoleForSection(user, "tech_manager", sectionId)).toBe(true)
	})
})
