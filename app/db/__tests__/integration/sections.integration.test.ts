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
	createSection,
	updateSection,
	archiveSection,
	unarchiveSection,
	getSections,
	createTeam,
	updateTeam,
	archiveTeam,
	unarchiveTeam,
	getTeamsForSection,
} = await import("~/db/queries/sections.server")

async function getAuditByEntity(entityType: string, entityId: string) {
	const db = getTestDb()
	const r = await db.execute(
		/* sql */ `SELECT action, previous_value, new_value, performed_by FROM audit_log WHERE entity_type = '${entityType}' AND entity_id = '${entityId}' ORDER BY performed_at`,
	)
	return r.rows as Array<{
		action: string
		previous_value: string | null
		new_value: string | null
		performed_by: string
	}>
}

describe("sections.server integration tests", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	}, 120_000)

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		const db = getTestDb()
		await db.execute(/* sql */ `
			DELETE FROM dev_team_nais_team_mappings;
			DELETE FROM nais_teams;
			DELETE FROM dev_teams;
			DELETE FROM sections;
			DELETE FROM audit_log;
		`)
	})

	describe("Section CRUD", () => {
		it("creates a section with a generated slug and audit log entry", async () => {
			const section = await createSection("Plattform & Sikkerhet", "Beskrivelse", "admin")
			expect(section.name).toBe("Plattform & Sikkerhet")
			expect(section.slug).toBeDefined()
			expect(section.slug.length).toBeGreaterThan(0)

			const audit = await getAuditByEntity("section", section.id)
			expect(audit).toHaveLength(1)
			expect(audit[0]).toMatchObject({
				action: "section_created",
				new_value: "Plattform & Sikkerhet",
				performed_by: "admin",
			})
		})

		it("updates a section name and description with audit log", async () => {
			const section = await createSection("Original", "Old desc", "admin")
			const updated = await updateSection(section.id, "Renamed", "New desc", "editor")

			expect(updated.name).toBe("Renamed")
			expect(updated.description).toBe("New desc")

			const audit = await getAuditByEntity("section", section.id)
			const updateEntry = audit.find((a) => a.action === "section_updated")
			expect(updateEntry).toBeDefined()
			expect(updateEntry).toMatchObject({ previous_value: "Original", new_value: "Renamed", performed_by: "editor" })
		})

		it("archives a section instead of deleting it (soft-delete)", async () => {
			const section = await createSection("To Archive", null, "admin")
			await createTeam(section.id, "Team A", null, "admin")
			await createTeam(section.id, "Team B", null, "admin")

			const archived = await archiveSection(section.id, "archiver")
			expect(archived.archivedAt).not.toBeNull()
			expect(archived.archivedBy).toBe("archiver")

			const db = getTestDb()
			const sectionRow = await db.execute(/* sql */ `SELECT id, archived_at FROM sections WHERE id = '${section.id}'`)
			expect(sectionRow.rows).toHaveLength(1)
			expect(sectionRow.rows[0].archived_at).not.toBeNull()

			const teamRows = await db.execute(/* sql */ `SELECT id FROM dev_teams WHERE section_id = '${section.id}'`)
			expect(teamRows.rows).toHaveLength(2)

			const audit = await getAuditByEntity("section", section.id)
			const archiveEntry = audit.find((a) => a.action === "section_archived")
			expect(archiveEntry).toBeDefined()
			expect(archiveEntry?.previous_value).toBe("To Archive")
		})

		it("excludes archived sections from getSections() by default", async () => {
			const active = await createSection("Active Section", null, "admin")
			const toArchive = await createSection("Archived Section", null, "admin")
			await archiveSection(toArchive.id, "admin")

			const visible = await getSections()
			expect(visible.map((s) => s.id)).toContain(active.id)
			expect(visible.map((s) => s.id)).not.toContain(toArchive.id)

			const all = await getSections({ includeArchived: true })
			expect(all.map((s) => s.id)).toEqual(expect.arrayContaining([active.id, toArchive.id]))
		})

		it("reactivates an archived section", async () => {
			const section = await createSection("Will return", null, "admin")
			await archiveSection(section.id, "admin")
			const reactivated = await unarchiveSection(section.id, "reactivator")

			expect(reactivated.archivedAt).toBeNull()
			expect(reactivated.archivedBy).toBeNull()

			const audit = await getAuditByEntity("section", section.id)
			expect(audit.find((a) => a.action === "section_unarchived")?.performed_by).toBe("reactivator")
		})

		it("rejects raw deletion of a section that has dev teams (FK RESTRICT)", async () => {
			const section = await createSection("Protected", null, "admin")
			await createTeam(section.id, "Has team", null, "admin")

			const db = getTestDb()
			await expect(db.execute(/* sql */ `DELETE FROM sections WHERE id = '${section.id}'`)).rejects.toThrow()

			const stillThere = await db.execute(/* sql */ `SELECT id FROM sections WHERE id = '${section.id}'`)
			expect(stillThere.rows).toHaveLength(1)
		})

		it("avviser kobling av nais-team til arkivert seksjon (linkNaisTeamToSection)", async () => {
			const { linkNaisTeamToSection } = await import("~/db/queries/nais.server")
			const section = await createSection("Arkivert link", null, "admin")
			await archiveSection(section.id, "admin")

			const db = getTestDb()
			await db.execute(
				/* sql */ `INSERT INTO nais_teams (slug, display_name, status) VALUES ('team-x', 'Team X', 'monitored')`,
			)

			await expect(linkNaisTeamToSection("team-x", section.id, "admin")).rejects.toThrow(/arkivert/)

			const linked = await db.execute(/* sql */ `SELECT section_id FROM nais_teams WHERE slug = 'team-x'`)
			expect((linked.rows[0] as { section_id: string | null }).section_id).toBeNull()
		})

		it("kaster og logger ikke audit hvis nais-team-slug ikke finnes", async () => {
			const { linkNaisTeamToSection } = await import("~/db/queries/nais.server")
			const section = await createSection("Aktiv", null, "admin")
			const db = getTestDb()

			await expect(linkNaisTeamToSection("does-not-exist", section.id, "admin")).rejects.toThrow(/finnes ikke/)

			const audit = await db.execute(
				/* sql */ `SELECT 1 FROM audit_log WHERE action = 'nais_team_section_linked' AND entity_id = 'does-not-exist'`,
			)
			expect(audit.rows).toHaveLength(0)
		})
	})

	describe("Team CRUD", () => {
		it("creates a team in a section with audit log", async () => {
			const section = await createSection("Sec", null, "admin")
			const team = await createTeam(section.id, "Team Alfa", "Beskrivelse", "admin")

			expect(team.name).toBe("Team Alfa")
			expect(team.sectionId).toBe(section.id)

			const audit = await getAuditByEntity("team", team.id)
			expect(audit).toHaveLength(1)
			expect(audit[0].action).toBe("team_created")
		})

		it("updates a team and writes audit log", async () => {
			const section = await createSection("Sec", null, "admin")
			const team = await createTeam(section.id, "Old name", null, "admin")
			const updated = await updateTeam(team.id, "New name", "Beskr", "editor")

			expect(updated.name).toBe("New name")
			const audit = await getAuditByEntity("team", team.id)
			const updateEntry = audit.find((a) => a.action === "team_updated")
			expect(updateEntry?.previous_value).toBe("Old name")
			expect(updateEntry?.new_value).toBe("New name")
		})

		it("archives a team and reactivates it (idempotent + atomic + audit-in-tx)", async () => {
			const section = await createSection("Sec", null, "admin")
			const team = await createTeam(section.id, "Doomed", null, "admin")
			const archived = await archiveTeam(team.id, "archiver")
			expect(archived.archivedAt).toBeInstanceOf(Date)
			expect(archived.archivedBy).toBe("archiver")

			// Idempotent: second call returns same row, does not write extra audit
			const archivedAgain = await archiveTeam(team.id, "archiver")
			expect(archivedAgain.id).toBe(team.id)

			const db = getTestDb()
			const rows = await db.execute(/* sql */ `SELECT id, archived_at FROM dev_teams WHERE id = '${team.id}'`)
			expect(rows.rows).toHaveLength(1)
			expect((rows.rows[0] as { archived_at: Date | null }).archived_at).not.toBeNull()

			let audit = await getAuditByEntity("team", team.id)
			expect(audit.filter((a) => a.action === "team_archived")).toHaveLength(1)

			// Default getTeamsForSection excludes archived
			const activeTeams = await getTeamsForSection(section.id)
			expect(activeTeams.find((t) => t.id === team.id)).toBeUndefined()

			// includeArchived returns it
			const allTeams = await getTeamsForSection(section.id, { includeArchived: true })
			expect(allTeams.find((t) => t.id === team.id)).toBeDefined()

			// Reactivate
			const reactivated = await unarchiveTeam(team.id, "reactivator")
			expect(reactivated.archivedAt).toBeNull()
			expect(reactivated.archivedBy).toBeNull()

			audit = await getAuditByEntity("team", team.id)
			expect(audit.filter((a) => a.action === "team_unarchived")).toHaveLength(1)
		})

		it("rejects updateTeam on an archived team", async () => {
			const section = await createSection("Sec", null, "admin")
			const team = await createTeam(section.id, "Frozen", null, "admin")
			await archiveTeam(team.id, "admin")
			await expect(updateTeam(team.id, "Tine", null, "admin")).rejects.toThrow(/arkivert/i)
		})

		it("rejects updateTeam with not-found error for unknown id (not archived error)", async () => {
			await expect(updateTeam("00000000-0000-0000-0000-000000000000", "X", null, "admin")).rejects.toThrow(
				/ikke funnet/i,
			)
		})

		it("hard delete on dev_teams is blocked by FK RESTRICT (cannot remove team with mappings)", async () => {
			const section = await createSection("Sec", null, "admin")
			const team = await createTeam(section.id, "Linked", null, "admin")
			const db = getTestDb()
			// Insert a nais_team that references the dev_team to force FK RESTRICT
			await db.execute(
				/* sql */ `INSERT INTO nais_teams (slug, dev_team_id) VALUES ('nt-${team.id.slice(0, 6)}', '${team.id}')`,
			)
			await expect(db.execute(/* sql */ `DELETE FROM dev_teams WHERE id = '${team.id}'`)).rejects.toThrow()
		})

		it("returns teams for a section ordered by name", async () => {
			const section = await createSection("Sec", null, "admin")
			await createTeam(section.id, "Zulu", null, "admin")
			await createTeam(section.id, "Alpha", null, "admin")

			const teams = await getTeamsForSection(section.id)
			expect(teams.map((t) => t.name)).toEqual(["Alpha", "Zulu"])
			expect(teams[0].linkedNaisTeams).toEqual([])
		})

		it("returns linkedNaisTeams for teams with active mappings and filters archived", async () => {
			const db = getTestDb()
			const section = await createSection("Sec", null, "admin")
			const teamA = await createTeam(section.id, "TeamA", null, "admin")
			const teamB = await createTeam(section.id, "TeamB", null, "admin")

			// Create nais teams
			await db.execute(/* sql */ `INSERT INTO nais_teams (slug) VALUES ('nais-alpha'), ('nais-beta'), ('nais-gamma')`)
			const naisRows = await db.execute(/* sql */ `SELECT id, slug FROM nais_teams ORDER BY slug`)
			const naisAlpha = (naisRows.rows as Array<{ id: string; slug: string }>).find((r) => r.slug === "nais-alpha")!
			const naisBeta = (naisRows.rows as Array<{ id: string; slug: string }>).find((r) => r.slug === "nais-beta")!
			const naisGamma = (naisRows.rows as Array<{ id: string; slug: string }>).find((r) => r.slug === "nais-gamma")!

			// TeamA linked to nais-alpha (active) and nais-beta (archived)
			await db.execute(
				/* sql */ `INSERT INTO dev_team_nais_team_mappings (dev_team_id, nais_team_id, created_by) VALUES ('${teamA.id}', '${naisAlpha.id}', 'test')`,
			)
			await db.execute(
				/* sql */ `INSERT INTO dev_team_nais_team_mappings (dev_team_id, nais_team_id, created_by, archived_at, archived_by) VALUES ('${teamA.id}', '${naisBeta.id}', 'test', NOW(), 'test')`,
			)
			// TeamB linked to nais-gamma (active)
			await db.execute(
				/* sql */ `INSERT INTO dev_team_nais_team_mappings (dev_team_id, nais_team_id, created_by) VALUES ('${teamB.id}', '${naisGamma.id}', 'test')`,
			)

			const teams = await getTeamsForSection(section.id)
			const a = teams.find((t) => t.name === "TeamA")!
			const b = teams.find((t) => t.name === "TeamB")!

			expect(a.linkedNaisTeams).toEqual(["nais-alpha"])
			expect(b.linkedNaisTeams).toEqual(["nais-gamma"])
		})
	})
})
