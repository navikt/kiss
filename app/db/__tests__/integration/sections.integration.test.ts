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

const { createSection, updateSection, deleteSection, createTeam, updateTeam, deleteTeam, getTeamsForSection } =
	await import("~/db/queries/sections.server")

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

		it("deletes a section and cascades dev teams", async () => {
			const section = await createSection("To Delete", null, "admin")
			await createTeam(section.id, "Team A", null, "admin")
			await createTeam(section.id, "Team B", null, "admin")

			await deleteSection(section.id, "deleter")

			const db = getTestDb()
			const sectionRow = await db.execute(/* sql */ `SELECT id FROM sections WHERE id = '${section.id}'`)
			expect(sectionRow.rows).toHaveLength(0)

			const teamRows = await db.execute(/* sql */ `SELECT id FROM dev_teams WHERE section_id = '${section.id}'`)
			expect(teamRows.rows).toHaveLength(0)

			const audit = await getAuditByEntity("section", section.id)
			const deleteEntry = audit.find((a) => a.action === "section_deleted")
			expect(deleteEntry).toBeDefined()
			expect(deleteEntry?.previous_value).toBe("To Delete")
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

		it("deletes a team", async () => {
			const section = await createSection("Sec", null, "admin")
			const team = await createTeam(section.id, "Doomed", null, "admin")
			await deleteTeam(team.id, "deleter")

			const db = getTestDb()
			const rows = await db.execute(/* sql */ `SELECT id FROM dev_teams WHERE id = '${team.id}'`)
			expect(rows.rows).toHaveLength(0)

			const audit = await getAuditByEntity("team", team.id)
			expect(audit.find((a) => a.action === "team_deleted")?.previous_value).toBe("Doomed")
		})

		it("returns teams for a section ordered by name", async () => {
			const section = await createSection("Sec", null, "admin")
			await createTeam(section.id, "Zulu", null, "admin")
			await createTeam(section.id, "Alpha", null, "admin")

			const teams = await getTeamsForSection(section.id)
			expect(teams.map((t) => t.name)).toEqual(["Alpha", "Zulu"])
			expect(teams[0].linkedNaisTeams).toEqual([])
		})
	})
})
