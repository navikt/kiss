import assert from "node:assert"
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
	upsertUser,
	getUserRoles,
	getUsersForTeam,
	getTeamMemberRoles,
	getTeamMemberRoleById,
	assignRole,
	removeRole,
	listUsersWithRoles,
	getUserLandingPage,
	setUserLandingPage,
	getAllDevTeams,
} = await import("~/db/queries/users.server")

async function createSection(slug: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `INSERT INTO sections (name, slug, created_by, updated_by) VALUES ('Sec ${slug}', '${slug}', 'test', 'test') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

async function createTeam(sectionId: string, slug: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `INSERT INTO dev_teams (section_id, name, slug, created_by, updated_by) VALUES ('${sectionId}', 'Team ${slug}', '${slug}', 'test', 'test') RETURNING id`,
	)
	return (r.rows[0] as { id: string }).id
}

describe("users.server integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	}, 120_000)

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM user_roles;
			DELETE FROM user_preferences;
			DELETE FROM users;
			DELETE FROM dev_teams;
			DELETE FROM sections;
		`)
	})

	describe("upsertUser", () => {
		it("creates a user when navIdent is new", async () => {
			const id = await upsertUser("X123456", "Test Person", "test@nav.no")
			expect(id).toBeDefined()
			const db = getTestDb()
			const rows = await db.execute(/* sql */ `SELECT nav_ident, name, email FROM users WHERE id = '${id}'`)
			expect(rows.rows[0]).toMatchObject({ nav_ident: "X123456", name: "Test Person", email: "test@nav.no" })
		})

		it("updates existing user on conflict and bumps lastLoginAt", async () => {
			const id1 = await upsertUser("X123456", "Old Name")
			const db = getTestDb()
			const beforeRows = await db.execute(/* sql */ `SELECT last_login_at FROM users WHERE id = '${id1}'`)
			const firstLastLoginAt = new Date((beforeRows.rows[0] as { last_login_at: string }).last_login_at)

			await new Promise((resolve) => setTimeout(resolve, 10))

			const id2 = await upsertUser("X123456", "New Name", "new@nav.no")
			expect(id2).toBe(id1)
			const rows = await db.execute(/* sql */ `SELECT name, email, last_login_at FROM users WHERE id = '${id1}'`)
			expect(rows.rows[0]).toMatchObject({ name: "New Name", email: "new@nav.no" })
			const updatedLastLoginAt = new Date((rows.rows[0] as { last_login_at: string }).last_login_at)
			expect(updatedLastLoginAt.getTime()).toBeGreaterThan(firstLastLoginAt.getTime())
		})
	})

	describe("role management", () => {
		it("assigns and lists roles for a user", async () => {
			const sectionId = await createSection("sec1")
			await assignRole("X1", "Person 1", "section_manager", "admin", sectionId)

			const roles = await getUserRoles("X1")
			expect(roles).toHaveLength(1)
			expect(roles[0]).toMatchObject({
				role: "section_manager",
				sectionId,
				sectionSlug: "sec1",
			})
		})

		it("supports team-scoped roles", async () => {
			const sectionId = await createSection("sec2")
			const teamId = await createTeam(sectionId, "team1")
			await assignRole("X2", "Person 2", "tech_lead", "admin", undefined, teamId)

			const roles = await getUserRoles("X2")
			expect(roles).toHaveLength(1)
			expect(roles[0]).toMatchObject({ role: "tech_lead", devTeamId: teamId, devTeamSlug: "team1" })
		})

		it("removes a role by id", async () => {
			const sectionId = await createSection("sec3")
			const roleId = await assignRole("X3", "Person 3", "auditor", "admin", sectionId)

			await removeRole(roleId, "admin")
			const roles = await getUserRoles("X3")
			expect(roles).toHaveLength(0)
		})

		it("lists all users with their roles, sorted by name", async () => {
			const sectionId = await createSection("sec4")
			await assignRole("X10", "Beta User", "admin", "admin")
			await assignRole("X11", "Alpha User", "section_manager", "admin", sectionId)

			const users = await listUsersWithRoles()
			expect(users).toHaveLength(2)
			expect(users[0].name).toBe("Alpha User")
			expect(users[1].name).toBe("Beta User")
			expect(users[0].roles[0]?.role).toBe("section_manager")
		})

		it("avviser tildeling av rolle mot arkivert seksjon", async () => {
			const sectionId = await createSection("sec-arch")
			const db = getTestDb()
			await db.execute(
				/* sql */ `UPDATE sections SET archived_at = now(), archived_by = 'admin' WHERE id = '${sectionId}'`,
			)
			await expect(assignRole("X20", "Crafted POST", "section_manager", "admin", sectionId)).rejects.toThrow(/arkivert/)
		})

		it("avviser team-rolle mot dev-team i arkivert seksjon (selv uten sectionId)", async () => {
			const sectionId = await createSection("sec-team-arch")
			const teamId = await createTeam(sectionId, "team-arch")
			const db = getTestDb()
			await db.execute(
				/* sql */ `UPDATE sections SET archived_at = now(), archived_by = 'admin' WHERE id = '${sectionId}'`,
			)
			await expect(assignRole("X21", "Crafted POST", "tech_lead", "admin", undefined, teamId)).rejects.toThrow(
				/arkivert/,
			)
		})

		it("oppdaterer ikke users.last_login_at hvis seksjon-guard avviser tildelingen", async () => {
			const sectionId = await createSection("sec-rb")
			await assignRole("X22", "Existing User", "admin", "admin")
			const db = getTestDb()
			const before = await db.execute(/* sql */ `SELECT last_login_at FROM users WHERE nav_ident = 'X22'`)
			const beforeLogin = (before.rows[0] as { last_login_at: string }).last_login_at

			await db.execute(
				/* sql */ `UPDATE sections SET archived_at = now(), archived_by = 'admin' WHERE id = '${sectionId}'`,
			)
			await new Promise((resolve) => setTimeout(resolve, 10))
			await expect(assignRole("X22", "Existing User", "section_manager", "admin", sectionId)).rejects.toThrow(
				/arkivert/,
			)

			const after = await db.execute(/* sql */ `SELECT last_login_at FROM users WHERE nav_ident = 'X22'`)
			const afterLogin = (after.rows[0] as { last_login_at: string }).last_login_at
			expect(afterLogin).toBe(beforeLogin)
		})
	})

	describe("user preferences", () => {
		it("returns dashboard as default landing page", async () => {
			const lp = await getUserLandingPage("X-NEW")
			expect(lp).toBe("dashboard")
		})

		it("persists landing page preference and reads it back", async () => {
			await setUserLandingPage("X9", "min-seksjon")
			expect(await getUserLandingPage("X9")).toBe("min-seksjon")

			await setUserLandingPage("X9", "mine-team")
			expect(await getUserLandingPage("X9")).toBe("mine-team")
		})
	})

	describe("getAllDevTeams", () => {
		it("returns dev teams ordered by name", async () => {
			const sectionId = await createSection("sec-teams")
			await createTeam(sectionId, "zeta")
			await createTeam(sectionId, "alpha")

			const teams = await getAllDevTeams()
			expect(teams).toHaveLength(2)
			expect(teams[0].name).toBe("Team alpha")
			expect(teams[1].name).toBe("Team zeta")
		})
	})

	describe("getUsersForTeam", () => {
		it("returns users with their active roles grouped by user", async () => {
			const sectionId = await createSection("sec-team-users")
			const teamId = await createTeam(sectionId, "team-a")
			await assignRole("U001", "Alice", "developer", "test", undefined, teamId)
			await assignRole("U001", "Alice", "tech_lead", "test", undefined, teamId)
			await assignRole("U002", "Bob", "product_owner", "test", undefined, teamId)

			const result = await getUsersForTeam(teamId)
			expect(result).toHaveLength(2)

			const alice = result.find((u) => u.navIdent === "U001")
			assert(alice, "Expected alice to be defined")
			expect(alice.name).toBe("Alice")
			expect(alice.roles).toHaveLength(2)
			expect(alice.roles).toContain("developer")
			expect(alice.roles).toContain("tech_lead")

			const bob = result.find((u) => u.navIdent === "U002")
			assert(bob, "Expected bob to be defined")
			expect(bob.roles).toEqual(["product_owner"])
		})

		it("excludes archived roles", async () => {
			const sectionId = await createSection("sec-team-archive")
			const teamId = await createTeam(sectionId, "team-b")
			await assignRole("U003", "Carol", "developer", "test", undefined, teamId)
			const roles = await getUserRoles("U003")
			await removeRole(roles[0].id, "test")

			const result = await getUsersForTeam(teamId)
			expect(result).toHaveLength(0)
		})

		it("returns empty array for team with no members", async () => {
			const sectionId = await createSection("sec-team-empty")
			const teamId = await createTeam(sectionId, "team-c")

			const result = await getUsersForTeam(teamId)
			expect(result).toHaveLength(0)
		})
	})

	describe("getTeamMemberRoles", () => {
		it("returns flat role list with correct fields", async () => {
			const sectionId = await createSection("sec-gmr-a")
			const teamId = await createTeam(sectionId, "team-gmr-a")
			await assignRole("Z990010", "Glad Fjord", "developer", "test", undefined, teamId)
			await assignRole("Z990011", "Rask Elv", "tech_lead", "test", undefined, teamId)

			const result = await getTeamMemberRoles(teamId)
			expect(result).toHaveLength(2)

			const glad = result.find((r) => r.navIdent === "Z990010")
			expect(glad).toBeDefined()
			expect(glad?.name).toBe("Glad Fjord")
			expect(glad?.role).toBe("developer")
			expect(glad?.roleId).toMatch(/^[0-9a-f-]{36}$/)

			const rask = result.find((r) => r.navIdent === "Z990011")
			expect(rask?.role).toBe("tech_lead")
		})

		it("excludes archived roles", async () => {
			const sectionId = await createSection("sec-gmr-b")
			const teamId = await createTeam(sectionId, "team-gmr-b")
			await assignRole("Z990012", "Stille Skog", "developer", "test", undefined, teamId)
			const roles = await getUserRoles("Z990012")
			await removeRole(roles[0].id, "test")

			const result = await getTeamMemberRoles(teamId)
			expect(result).toHaveLength(0)
		})

		it("returns results ordered by name, navIdent, role", async () => {
			const sectionId = await createSection("sec-gmr-c")
			const teamId = await createTeam(sectionId, "team-gmr-c")
			await assignRole("Z990013", "Modig Bjørk", "developer", "test", undefined, teamId)
			await assignRole("Z990014", "Aktiv Dal", "product_owner", "test", undefined, teamId)
			await assignRole("Z990013", "Modig Bjørk", "tech_lead", "test", undefined, teamId)

			const result = await getTeamMemberRoles(teamId)
			expect(result[0].navIdent).toBe("Z990014") // Aktiv < Modig
			expect(result[1].role).toBe("developer") // developer < tech_lead
			expect(result[2].role).toBe("tech_lead")
		})
	})

	describe("getTeamMemberRoleById", () => {
		it("returns the role when roleId belongs to the team", async () => {
			const sectionId = await createSection("sec-gmbid-a")
			const teamId = await createTeam(sectionId, "team-gmbid-a")
			await assignRole("Z990020", "Fri Stein", "developer", "test", undefined, teamId)
			const roles = await getUserRoles("Z990020")

			const result = await getTeamMemberRoleById(roles[0].id, teamId)
			expect(result).not.toBeNull()
			expect(result?.role).toBe("developer")
		})

		it("returns null when roleId does not belong to the team", async () => {
			const sectionId = await createSection("sec-gmbid-b")
			const teamId1 = await createTeam(sectionId, "team-gmbid-b1")
			const teamId2 = await createTeam(sectionId, "team-gmbid-b2")
			await assignRole("Z990021", "Varm Sand", "developer", "test", undefined, teamId1)
			const roles = await getUserRoles("Z990021")

			const result = await getTeamMemberRoleById(roles[0].id, teamId2)
			expect(result).toBeNull()
		})

		it("returns null when role is archived", async () => {
			const sectionId = await createSection("sec-gmbid-c")
			const teamId = await createTeam(sectionId, "team-gmbid-c")
			await assignRole("Z990022", "Kald Topp", "developer", "test", undefined, teamId)
			const roles = await getUserRoles("Z990022")
			await removeRole(roles[0].id, "test")

			const result = await getTeamMemberRoleById(roles[0].id, teamId)
			expect(result).toBeNull()
		})
	})
})
