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
	upsertUser,
	getUserRoles,
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
})
