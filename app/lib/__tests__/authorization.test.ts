import { beforeEach, describe, expect, it, vi } from "vitest"
import type { UserRole } from "~/db/schema/organization"
import type { NavUser } from "../auth.server"
import { buildEffectiveAuth, isAdminSuppressed } from "../auth.server"
import {
	canAccessAppReports,
	canApproveRoutine,
	canManageTeam,
	hasAnySectionRole,
	hasAnyTeamRole,
	hasRole,
	hasRoleForSection,
	isActualAdmin,
	isAdmin,
	requireAppMembership,
	requireReviewAccess,
	requireReviewReadAccess,
} from "../authorization.server"

const mockGetAppScopeIds = vi.fn()
vi.mock("~/db/queries/applications.server", () => ({
	getAppScopeIds: (...args: unknown[]) => mockGetAppScopeIds(...args),
}))

function makeUser(overrides: Partial<NavUser> = {}): NavUser {
	const dbRoles = overrides.dbRoles ?? []
	// Derive roles from dbRoles automatically (mirrors production behaviour for db-role path).
	// Tests that need AD-group-based roles must set `roles` explicitly.
	const roles = overrides.roles ?? new Set<UserRole>(dbRoles.map((r) => r.role))
	return {
		navIdent: "T123456",
		name: "Test Testesen",
		groups: [],
		token: "fake-token",
		dbRoles,
		roles,
		isActualAdmin: false,
		adminSuppressed: false,
		...overrides,
	}
}

describe("canManageTeam", () => {
	const devTeamId = "team-abc"

	it("returns true for admin regardless of devTeamId", () => {
		const user = makeUser({
			dbRoles: [{ role: "admin", sectionId: null, devTeamId: null, devTeamSectionId: null }],
		})
		expect(canManageTeam(user, devTeamId)).toBe(true)
	})

	it("returns true for product_owner with matching devTeamId", () => {
		const user = makeUser({
			dbRoles: [{ role: "product_owner", sectionId: null, devTeamId, devTeamSectionId: null }],
		})
		expect(canManageTeam(user, devTeamId)).toBe(true)
	})

	it("returns true for tech_lead with matching devTeamId", () => {
		const user = makeUser({
			dbRoles: [{ role: "tech_lead", sectionId: null, devTeamId, devTeamSectionId: null }],
		})
		expect(canManageTeam(user, devTeamId)).toBe(true)
	})

	it("returns false for product_owner with null devTeamId (no wildcard)", () => {
		const user = makeUser({
			dbRoles: [{ role: "product_owner", sectionId: null, devTeamId: null, devTeamSectionId: null }],
		})
		expect(canManageTeam(user, devTeamId)).toBe(false)
	})

	it("returns false for tech_lead with null devTeamId (no wildcard)", () => {
		const user = makeUser({
			dbRoles: [{ role: "tech_lead", sectionId: null, devTeamId: null, devTeamSectionId: null }],
		})
		expect(canManageTeam(user, devTeamId)).toBe(false)
	})

	it("returns false for product_owner with wrong devTeamId", () => {
		const user = makeUser({
			dbRoles: [{ role: "product_owner", sectionId: null, devTeamId: "other-team", devTeamSectionId: null }],
		})
		expect(canManageTeam(user, devTeamId)).toBe(false)
	})

	it("returns false for user with no roles", () => {
		const user = makeUser()
		expect(canManageTeam(user, devTeamId)).toBe(false)
	})

	it("returns false for suppressed admin (admin stripped at auth time)", () => {
		// Admin was stripped from dbRoles by getAuthenticatedUser — only isActualAdmin remains
		const user = makeUser({ isActualAdmin: true })
		expect(canManageTeam(user, devTeamId)).toBe(false)
	})
})

describe("canApproveRoutine", () => {
	const sectionId = "section-1"

	it("admin can always approve regardless of responsibleRole", () => {
		const adminUser = makeUser({ roles: new Set(["admin"]) })
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
			dbRoles: [{ role: "tech_manager", sectionId, devTeamId: null, devTeamSectionId: null }],
		})
		expect(canApproveRoutine(user, "Teknologileder", sectionId)).toBe(true)
	})

	it("Teknologileder role fails for wrong section", () => {
		const user = makeUser({
			dbRoles: [{ role: "tech_manager", sectionId: "other-section", devTeamId: null, devTeamSectionId: null }],
		})
		expect(canApproveRoutine(user, "Teknologileder", sectionId)).toBe(false)
	})

	it("Produktleder role maps to product_owner for section", () => {
		const user = makeUser({
			dbRoles: [{ role: "product_owner", sectionId, devTeamId: null, devTeamSectionId: null }],
		})
		expect(canApproveRoutine(user, "Produktleder", sectionId)).toBe(true)
	})

	it("Seksjonsleder role maps to section_manager", () => {
		const user = makeUser({
			dbRoles: [{ role: "section_manager", sectionId, devTeamId: null, devTeamSectionId: null }],
		})
		expect(canApproveRoutine(user, "Seksjonsleder", sectionId)).toBe(true)
	})

	it("returns false for unknown responsibleRole", () => {
		const user = makeUser({
			dbRoles: [{ role: "tech_manager", sectionId, devTeamId: null, devTeamSectionId: null }],
		})
		expect(canApproveRoutine(user, "UkjentRolle", sectionId)).toBe(false)
	})

	it("returns false for user with wrong role", () => {
		const user = makeUser({
			dbRoles: [{ role: "product_owner", sectionId, devTeamId: null, devTeamSectionId: null }],
		})
		expect(canApproveRoutine(user, "Teknologileder", sectionId)).toBe(false)
	})
})

describe("isAdmin", () => {
	it("returns true for user with admin dbRole", () => {
		const user = makeUser({
			dbRoles: [{ role: "admin", sectionId: null, devTeamId: null, devTeamSectionId: null }],
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
			dbRoles: [{ role: "tech_manager", sectionId: "s1", devTeamId: null, devTeamSectionId: null }],
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
			dbRoles: [{ role: "tech_manager", sectionId, devTeamId: null, devTeamSectionId: null }],
		})
		expect(hasRoleForSection(user, "tech_manager", sectionId)).toBe(true)
	})

	it("returns false when user has role for different section", () => {
		const user = makeUser({
			dbRoles: [{ role: "tech_manager", sectionId: "other", devTeamId: null, devTeamSectionId: null }],
		})
		expect(hasRoleForSection(user, "tech_manager", sectionId)).toBe(false)
	})

	it("returns true for admin regardless of section", () => {
		const user = makeUser({
			dbRoles: [{ role: "admin", sectionId: null, devTeamId: null, devTeamSectionId: null }],
		})
		expect(hasRoleForSection(user, "tech_manager", sectionId)).toBe(true)
	})
})

describe("adminSuppressed — admin strips at auth time", () => {
	// After suppression, admin is removed from groups/dbRoles by getAuthenticatedUser().
	// authorization.server.ts reads groups/dbRoles directly — no adminSuppressed checks needed.

	it("user without admin in dbRoles is not admin (models stripped user)", () => {
		const user = makeUser({ dbRoles: [] })
		expect(isAdmin(user)).toBe(false)
	})

	it("isActualAdmin returns the isActualAdmin field", () => {
		// isActualAdmin=true means the user is genuinely an admin (pre-computed in auth)
		const user = makeUser({ dbRoles: [], isActualAdmin: true })
		expect(isActualAdmin(user)).toBe(true)
		expect(isAdmin(user)).toBe(false) // admin stripped from dbRoles → not admin
	})

	it("isActualAdmin=false for regular user", () => {
		const user = makeUser()
		expect(isActualAdmin(user)).toBe(false)
		expect(isAdmin(user)).toBe(false)
	})

	it("non-admin dbRoles are unaffected by admin stripping", () => {
		// After suppression: admin removed, tech_manager remains
		const user = makeUser({
			dbRoles: [{ role: "tech_manager", sectionId: "s1", devTeamId: null, devTeamSectionId: null }],
			isActualAdmin: true, // was admin, but now suppressed
		})
		expect(hasRole(user, "tech_manager")).toBe(true)
		expect(hasRole(user, "admin")).toBe(false)
	})

	it("hasRoleForSection does not bypass via admin when admin is stripped", () => {
		// Admin stripped → groups and dbRoles contain no admin
		const user = makeUser({ isActualAdmin: true })
		expect(hasRoleForSection(user, "tech_manager", "section-1")).toBe(false)
	})

	it("canApproveRoutine does not bypass via admin when admin is stripped", () => {
		const user = makeUser({ isActualAdmin: true })
		expect(canApproveRoutine(user, "Teknologileder", "section-1")).toBe(false)
	})

	it("suppression has no effect on non-admin users", () => {
		const user = makeUser({
			dbRoles: [{ role: "tech_manager", sectionId: "s1", devTeamId: null, devTeamSectionId: null }],
		})
		expect(hasRole(user, "tech_manager")).toBe(true)
		expect(isAdmin(user)).toBe(false)
	})

	it("auditor fra AD-gruppe er aktiv uavhengig av admin-modus", () => {
		// AD-gruppe → rolle mappes i buildEffectiveAuth (auth.server.ts).
		// I authorization-tester setter vi roles direkte.
		const user = makeUser({ roles: new Set(["auditor"]), isActualAdmin: true })
		expect(hasRole(user, "auditor")).toBe(true)
	})

	it("auditor fra dbRoles er aktiv uavhengig av admin-modus", () => {
		const user = makeUser({
			dbRoles: [{ role: "auditor", sectionId: null, devTeamId: null, devTeamSectionId: null }],
			isActualAdmin: true,
		})
		expect(hasRole(user, "admin")).toBe(false)
		expect(hasRole(user, "auditor")).toBe(true)
	})

	it("bruker med AD-auditor og DB-auditor: auditor er aktiv selv med admin strippet", () => {
		const user = makeUser({
			dbRoles: [{ role: "auditor", sectionId: null, devTeamId: null, devTeamSectionId: null }],
			roles: new Set(["auditor"]),
			isActualAdmin: true,
		})
		expect(hasRole(user, "auditor")).toBe(true)
	})

	it("admin fra AD-gruppe gir admin-rolle når ikke strippet", () => {
		// AD-gruppe → admin mappes i buildEffectiveAuth (auth.server.ts).
		const user = makeUser({ roles: new Set(["admin"]), isActualAdmin: true })
		expect(isAdmin(user)).toBe(true)
	})
})

describe("buildEffectiveAuth — admin undertrykker revisor", () => {
	const ADMIN_GROUP = "admin-group"
	const AUDITOR_GROUP = "auditor-group"

	function build(groups: string[], dbRoles: NavUser["dbRoles"], adminSuppressed = false) {
		return buildEffectiveAuth(groups, dbRoles ?? [], [ADMIN_GROUP], [AUDITOR_GROUP], adminSuppressed)
	}

	it("admin som også er i revisor-gruppe: revisor fjernes fra roles og dbRoles", () => {
		const result = build(
			[ADMIN_GROUP, AUDITOR_GROUP],
			[{ role: "auditor", sectionId: null, devTeamId: null, devTeamSectionId: null }],
		)
		expect(result.roles.has("admin")).toBe(true)
		expect(result.roles.has("auditor")).toBe(false)
		expect(result.dbRoles.some((r) => r.role === "auditor")).toBe(false)
	})

	it("admin uten revisor-gruppe: normal admin-bruker", () => {
		const result = build([ADMIN_GROUP], [])
		expect(result.roles.has("admin")).toBe(true)
		expect(result.roles.has("auditor")).toBe(false)
	})

	it("ren revisor (ikke admin): revisorrollen beholdes, andre dbRoles fjernes", () => {
		const result = build(
			[AUDITOR_GROUP],
			[
				{ role: "auditor", sectionId: null, devTeamId: null, devTeamSectionId: null },
				{ role: "tech_manager", sectionId: "s1", devTeamId: null, devTeamSectionId: null },
			],
		)
		expect(result.roles.has("auditor")).toBe(true)
		expect(result.roles.has("admin")).toBe(false)
		expect(result.dbRoles.every((r) => r.role === "auditor")).toBe(true)
	})

	it("admin med suppressert admin-modus: revisor-rolle er aktiv (admin ikke effektiv)", () => {
		const result = build([ADMIN_GROUP, AUDITOR_GROUP], [], /* adminSuppressed */ true)
		expect(result.roles.has("auditor")).toBe(true)
		expect(result.roles.has("admin")).toBe(false)
		expect(result.isActualAdmin).toBe(true)
	})
})

describe("hasAnySectionRole", () => {
	const sectionId = "section-1"

	it("returns true for admin", () => {
		const user = makeUser({
			dbRoles: [{ role: "admin", sectionId: null, devTeamId: null, devTeamSectionId: null }],
		})
		expect(hasAnySectionRole(user, sectionId)).toBe(true)
	})

	it("returns true when user has a section-scoped role for the section", () => {
		const user = makeUser({
			dbRoles: [{ role: "tech_manager", sectionId, devTeamId: null, devTeamSectionId: null }],
		})
		expect(hasAnySectionRole(user, sectionId)).toBe(true)
	})

	it("returns true when user has a team-scoped role where team belongs to the section", () => {
		const user = makeUser({
			dbRoles: [{ role: "developer", sectionId: null, devTeamId: "team-1", devTeamSectionId: sectionId }],
		})
		expect(hasAnySectionRole(user, sectionId)).toBe(true)
	})

	it("returns false when user has a team-scoped role for a different section", () => {
		const user = makeUser({
			dbRoles: [{ role: "developer", sectionId: null, devTeamId: "team-1", devTeamSectionId: "other-section" }],
		})
		expect(hasAnySectionRole(user, sectionId)).toBe(false)
	})

	it("returns false when user has no roles", () => {
		const user = makeUser()
		expect(hasAnySectionRole(user, sectionId)).toBe(false)
	})

	it("returns false when user has a section-scoped role for a different section", () => {
		const user = makeUser({
			dbRoles: [{ role: "section_manager", sectionId: "other-section", devTeamId: null, devTeamSectionId: null }],
		})
		expect(hasAnySectionRole(user, sectionId)).toBe(false)
	})

	it("returns false for suppressed admin (admin stripped at auth time)", () => {
		const user = makeUser({ isActualAdmin: true })
		expect(hasAnySectionRole(user, sectionId)).toBe(false)
	})

	it("returns true when user has a global section-scoped role (sectionId=null)", () => {
		const user = makeUser({
			dbRoles: [{ role: "section_manager", sectionId: null, devTeamId: null, devTeamSectionId: null }],
		})
		expect(hasAnySectionRole(user, sectionId)).toBe(true)
	})
})

describe("isAdminSuppressed", () => {
	it("returns false when elevation cookie is set", () => {
		const request = new Request("http://localhost", {
			headers: { Cookie: "kiss-admin-elevated=true" },
		})
		expect(isAdminSuppressed(request)).toBe(false)
	})

	it("returns true when no cookie is set (default: suppressed)", () => {
		const request = new Request("http://localhost")
		expect(isAdminSuppressed(request)).toBe(true)
	})

	it("returns true when other cookies exist but no elevation cookie", () => {
		const request = new Request("http://localhost", {
			headers: { Cookie: "kiss-theme=dark; other=value" },
		})
		expect(isAdminSuppressed(request)).toBe(true)
	})

	it("returns false when elevation cookie is mixed with other cookies", () => {
		const request = new Request("http://localhost", {
			headers: { Cookie: "kiss-theme=dark; kiss-admin-elevated=true; other=1" },
		})
		expect(isAdminSuppressed(request)).toBe(false)
	})

	it("rejects substring cookie name matches", () => {
		const request = new Request("http://localhost", {
			headers: { Cookie: "fakekiss-admin-elevated=true" },
		})
		expect(isAdminSuppressed(request)).toBe(true)
	})

	it("handles cookies without space after semicolon", () => {
		const request = new Request("http://localhost", {
			headers: { Cookie: "kiss-theme=dark;kiss-admin-elevated=true" },
		})
		expect(isAdminSuppressed(request)).toBe(false)
	})
})

describe("canAccessAppReports", () => {
	const sectionId = "section-1"
	const devTeamId = "team-abc"

	it("returns true for admin", () => {
		const user = makeUser({
			dbRoles: [{ role: "admin", sectionId: null, devTeamId: null, devTeamSectionId: null }],
		})
		expect(canAccessAppReports(user, [sectionId], [devTeamId])).toBe(true)
	})

	it("returns true for section_manager of app section", () => {
		const user = makeUser({
			dbRoles: [{ role: "section_manager", sectionId, devTeamId: null, devTeamSectionId: null }],
		})
		expect(canAccessAppReports(user, [sectionId], [])).toBe(true)
	})

	it("returns true for tech_manager of app section", () => {
		const user = makeUser({
			dbRoles: [{ role: "tech_manager", sectionId, devTeamId: null, devTeamSectionId: null }],
		})
		expect(canAccessAppReports(user, [sectionId], [])).toBe(true)
	})

	it("returns true for auditor (global)", () => {
		const user = makeUser({
			dbRoles: [{ role: "auditor", sectionId: null, devTeamId: null, devTeamSectionId: null }],
		})
		expect(canAccessAppReports(user, [sectionId], [])).toBe(true)
	})

	it("returns true for auditor even when sectionIds and devTeamIds are empty", () => {
		const user = makeUser({
			dbRoles: [{ role: "auditor", sectionId: null, devTeamId: null, devTeamSectionId: null }],
		})
		expect(canAccessAppReports(user, [], [])).toBe(true)
	})

	it("returns true for tech_lead of app team", () => {
		const user = makeUser({
			dbRoles: [{ role: "tech_lead", sectionId: null, devTeamId, devTeamSectionId: null }],
		})
		expect(canAccessAppReports(user, [], [devTeamId])).toBe(true)
	})

	it("returns true for product_owner of app team", () => {
		const user = makeUser({
			dbRoles: [{ role: "product_owner", sectionId: null, devTeamId, devTeamSectionId: null }],
		})
		expect(canAccessAppReports(user, [], [devTeamId])).toBe(true)
	})

	it("returns false for user with no relevant roles", () => {
		const user = makeUser()
		expect(canAccessAppReports(user, [sectionId], [devTeamId])).toBe(false)
	})

	it("returns false for section_manager of a different section", () => {
		const user = makeUser({
			dbRoles: [{ role: "section_manager", sectionId: "other-section", devTeamId: null, devTeamSectionId: null }],
		})
		expect(canAccessAppReports(user, [sectionId], [devTeamId])).toBe(false)
	})

	it("returns false for tech_lead of a different team", () => {
		const user = makeUser({
			dbRoles: [{ role: "tech_lead", sectionId: null, devTeamId: "other-team", devTeamSectionId: null }],
		})
		expect(canAccessAppReports(user, [], [devTeamId])).toBe(false)
	})

	it("returns false for suppressed admin (admin stripped at auth time)", () => {
		const user = makeUser({ isActualAdmin: true })
		expect(canAccessAppReports(user, [sectionId], [devTeamId])).toBe(false)
	})

	it("returns false when sectionIds and devTeamIds are empty", () => {
		const user = makeUser({
			dbRoles: [{ role: "section_manager", sectionId, devTeamId: null, devTeamSectionId: null }],
		})
		expect(canAccessAppReports(user, [], [])).toBe(false)
	})
})

describe("hasAnyTeamRole", () => {
	const devTeamId = "team-abc"

	it("returns true for admin regardless of devTeamId", () => {
		const user = makeUser({ roles: new Set(["admin"]) })
		expect(hasAnyTeamRole(user, devTeamId)).toBe(true)
	})

	it("returns true for developer with matching devTeamId", () => {
		const user = makeUser({
			dbRoles: [{ role: "developer", sectionId: null, devTeamId, devTeamSectionId: null }],
		})
		expect(hasAnyTeamRole(user, devTeamId)).toBe(true)
	})

	it("returns true for tech_lead with matching devTeamId", () => {
		const user = makeUser({
			dbRoles: [{ role: "tech_lead", sectionId: null, devTeamId, devTeamSectionId: null }],
		})
		expect(hasAnyTeamRole(user, devTeamId)).toBe(true)
	})

	it("returns true for product_owner with matching devTeamId", () => {
		const user = makeUser({
			dbRoles: [{ role: "product_owner", sectionId: null, devTeamId, devTeamSectionId: null }],
		})
		expect(hasAnyTeamRole(user, devTeamId)).toBe(true)
	})

	it("returns false for developer with wrong devTeamId", () => {
		const user = makeUser({
			dbRoles: [{ role: "developer", sectionId: null, devTeamId: "other-team", devTeamSectionId: null }],
		})
		expect(hasAnyTeamRole(user, devTeamId)).toBe(false)
	})

	it("returns false for auditor with matching devTeamId (not a team role)", () => {
		// auditor is not in TEAM_MEMBER_ROLES — role filtering must be explicit
		const user = makeUser({
			dbRoles: [{ role: "auditor", sectionId: null, devTeamId, devTeamSectionId: null }],
		})
		expect(hasAnyTeamRole(user, devTeamId)).toBe(false)
	})

	it("returns false for user with no roles", () => {
		const user = makeUser()
		expect(hasAnyTeamRole(user, devTeamId)).toBe(false)
	})

	it("returns false for suppressed admin (admin stripped at auth time)", () => {
		const user = makeUser({ isActualAdmin: true })
		expect(hasAnyTeamRole(user, devTeamId)).toBe(false)
	})
})

describe("requireAppMembership", () => {
	const appId = "app-123"
	const devTeamId = "team-abc"

	beforeEach(() => mockGetAppScopeIds.mockReset())

	it("passes for admin without DB lookup", async () => {
		const user = makeUser({ roles: new Set(["admin"]) })
		await expect(requireAppMembership(user, appId)).resolves.toBeUndefined()
		expect(mockGetAppScopeIds).not.toHaveBeenCalled()
	})

	it("passes for user with matching devTeamId", async () => {
		mockGetAppScopeIds.mockResolvedValueOnce({ devTeamIds: [devTeamId], sectionIds: [] })
		const user = makeUser({
			dbRoles: [{ role: "developer", sectionId: null, devTeamId, devTeamSectionId: null }],
		})
		await expect(requireAppMembership(user, appId)).resolves.toBeUndefined()
	})

	it("passes when user is in one of multiple devTeamIds", async () => {
		mockGetAppScopeIds.mockResolvedValueOnce({ devTeamIds: ["other-team", devTeamId, "yet-another"], sectionIds: [] })
		const user = makeUser({
			dbRoles: [{ role: "tech_lead", sectionId: null, devTeamId, devTeamSectionId: null }],
		})
		await expect(requireAppMembership(user, appId)).resolves.toBeUndefined()
	})

	it("throws 403 for user not in any app team", async () => {
		mockGetAppScopeIds.mockResolvedValue({ devTeamIds: ["other-team"], sectionIds: [] })
		const user = makeUser({
			dbRoles: [{ role: "developer", sectionId: null, devTeamId, devTeamSectionId: null }],
		})
		await expect(requireAppMembership(user, appId)).rejects.toMatchObject({ status: 403 })
	})

	it("throws 403 for auditor (not a team role)", async () => {
		mockGetAppScopeIds.mockResolvedValue({ devTeamIds: [devTeamId], sectionIds: [] })
		const user = makeUser({
			dbRoles: [{ role: "auditor", sectionId: null, devTeamId, devTeamSectionId: null }],
		})
		await expect(requireAppMembership(user, appId)).rejects.toMatchObject({ status: 403 })
	})
})

describe("requireReviewAccess", () => {
	const appId = "app-123"
	const sectionId = "section-1"
	const devTeamId = "team-abc"

	beforeEach(() => mockGetAppScopeIds.mockReset())

	it("passes for admin (app-scoped scope)", async () => {
		const user = makeUser({ roles: new Set(["admin"]) })
		await expect(requireReviewAccess(user, { applicationId: appId, sectionId })).resolves.toBeUndefined()
		expect(mockGetAppScopeIds).not.toHaveBeenCalled()
	})

	it("passes for admin (section-scoped scope)", async () => {
		const user = makeUser({ roles: new Set(["admin"]) })
		await expect(requireReviewAccess(user, { applicationId: null, sectionId })).resolves.toBeUndefined()
	})

	it("passes for app member when scope is app-scoped", async () => {
		mockGetAppScopeIds.mockResolvedValueOnce({ devTeamIds: [devTeamId], sectionIds: [] })
		const user = makeUser({
			dbRoles: [{ role: "developer", sectionId: null, devTeamId, devTeamSectionId: null }],
		})
		await expect(requireReviewAccess(user, { applicationId: appId, sectionId })).resolves.toBeUndefined()
	})

	it("throws 403 for user without app membership when scope is app-scoped", async () => {
		mockGetAppScopeIds.mockResolvedValueOnce({ devTeamIds: ["other-team"], sectionIds: [] })
		const user = makeUser({
			dbRoles: [{ role: "developer", sectionId: null, devTeamId, devTeamSectionId: null }],
		})
		await expect(requireReviewAccess(user, { applicationId: appId, sectionId })).rejects.toMatchObject({ status: 403 })
	})

	it("passes for section member when scope is section-scoped", async () => {
		const user = makeUser({
			dbRoles: [{ role: "section_manager", sectionId, devTeamId: null, devTeamSectionId: null }],
		})
		await expect(requireReviewAccess(user, { applicationId: null, sectionId })).resolves.toBeUndefined()
	})

	it("throws 403 for user without section role when scope is section-scoped", async () => {
		const user = makeUser({
			dbRoles: [{ role: "section_manager", sectionId: "other-section", devTeamId: null, devTeamSectionId: null }],
		})
		await expect(requireReviewAccess(user, { applicationId: null, sectionId })).rejects.toMatchObject({ status: 403 })
	})

	it("uses section-scope (not app lookup) when applicationId is null", async () => {
		const user = makeUser({
			dbRoles: [{ role: "developer", sectionId: null, devTeamId, devTeamSectionId: sectionId }],
		})
		await expect(requireReviewAccess(user, { applicationId: null, sectionId })).resolves.toBeUndefined()
		expect(mockGetAppScopeIds).not.toHaveBeenCalled()
	})

	it("rejects auditor without app membership", async () => {
		const user = makeUser({ roles: new Set(["auditor"]) })
		await expect(requireReviewAccess(user, { applicationId: appId, sectionId })).rejects.toMatchObject({ status: 403 })
		expect(mockGetAppScopeIds).not.toHaveBeenCalled()
	})

	it("rejects auditor even with app membership (explicit deny before membership check)", async () => {
		mockGetAppScopeIds.mockResolvedValueOnce({ devTeamIds: [devTeamId], sectionIds: [] })
		const user = makeUser({
			roles: new Set(["auditor"]),
			dbRoles: [{ role: "auditor", sectionId: null, devTeamId, devTeamSectionId: null }],
		})
		await expect(requireReviewAccess(user, { applicationId: appId, sectionId })).rejects.toMatchObject({ status: 403 })
		expect(mockGetAppScopeIds).not.toHaveBeenCalled()
	})
})

describe("requireReviewReadAccess", () => {
	const appId = "app-1"
	const sectionId = "sec-1"
	const devTeamId = "team-1"

	beforeEach(() => mockGetAppScopeIds.mockReset())

	it("passes for admin", async () => {
		const user = makeUser({ roles: new Set(["admin"]) })
		await expect(requireReviewReadAccess(user, { applicationId: appId, sectionId })).resolves.toBeUndefined()
	})

	it("passes for auditor (app-scoped scope)", async () => {
		const user = makeUser({ roles: new Set(["auditor"]) })
		await expect(requireReviewReadAccess(user, { applicationId: appId, sectionId })).resolves.toBeUndefined()
		expect(mockGetAppScopeIds).not.toHaveBeenCalled()
	})

	it("passes for auditor (section-scoped scope)", async () => {
		const user = makeUser({ roles: new Set(["auditor"]) })
		await expect(requireReviewReadAccess(user, { applicationId: null, sectionId })).resolves.toBeUndefined()
	})

	it("rejects user with no relevant role", async () => {
		mockGetAppScopeIds.mockResolvedValueOnce({ devTeamIds: ["other-team"], sectionIds: [] })
		const user = makeUser({
			dbRoles: [{ role: "developer", sectionId: null, devTeamId, devTeamSectionId: null }],
		})
		await expect(requireReviewReadAccess(user, { applicationId: appId, sectionId })).rejects.toMatchObject({
			status: 403,
		})
	})

	it("passes for app member when scope is app-scoped", async () => {
		mockGetAppScopeIds.mockResolvedValueOnce({ devTeamIds: [devTeamId], sectionIds: [] })
		const user = makeUser({
			dbRoles: [{ role: "developer", sectionId: null, devTeamId, devTeamSectionId: null }],
		})
		await expect(requireReviewReadAccess(user, { applicationId: appId, sectionId })).resolves.toBeUndefined()
	})

	it("passes for section member when scope is section-scoped", async () => {
		const user = makeUser({
			dbRoles: [{ role: "section_manager", sectionId, devTeamId: null, devTeamSectionId: null }],
		})
		await expect(requireReviewReadAccess(user, { applicationId: null, sectionId })).resolves.toBeUndefined()
		expect(mockGetAppScopeIds).not.toHaveBeenCalled()
	})
})
