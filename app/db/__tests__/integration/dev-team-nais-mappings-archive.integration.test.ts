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

const { linkNaisTeamToDevTeam, unlinkNaisTeamFromDevTeam, getNaisTeamsForDevTeam } = await import(
	"~/db/queries/sections.server"
)

beforeAll(async () => {
	await setupTestDatabase()
})

afterAll(async () => {
	await teardownTestDatabase()
})

beforeEach(async () => {
	const db = getTestDb()
	await db.execute(/* sql */ `TRUNCATE TABLE
		audit_log,
		dev_team_nais_team_mappings,
		nais_teams,
		dev_teams,
		sections
		RESTART IDENTITY CASCADE`)
})

async function createSection(name: string, slug: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO sections (name, slug, created_by, updated_by) VALUES ('${name}', '${slug}', 'test', 'test') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function createDevTeam(name: string, slug: string, sectionId: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO dev_teams (name, slug, section_id, created_by, updated_by) VALUES ('${name}', '${slug}', '${sectionId}', 'test', 'test') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

async function createNaisTeam(slug: string) {
	const db = getTestDb()
	const result = await db.execute(
		/* sql */ `INSERT INTO nais_teams (slug, display_name) VALUES ('${slug}', '${slug}') RETURNING id`,
	)
	return (result.rows[0] as { id: string }).id
}

describe("SD11b dev_team_nais_team_mappings soft-delete", () => {
	it("unlinkNaisTeamFromDevTeam soft-deletes (sets archived_at) instead of physical delete", async () => {
		const db = getTestDb()
		const sectionId = await createSection("Sek", "sek")
		const teamId = await createDevTeam("Team", "team", sectionId)
		await createNaisTeam("nais-a")

		await linkNaisTeamToDevTeam("nais-a", teamId, "alice")
		await unlinkNaisTeamFromDevTeam("nais-a", teamId, "alice")

		const all = await db.execute(
			/* sql */ `SELECT archived_at, archived_by FROM dev_team_nais_team_mappings WHERE dev_team_id = '${teamId}'`,
		)
		expect(all.rows).toHaveLength(1)
		const row = all.rows[0] as { archived_at: Date | null; archived_by: string | null }
		expect(row.archived_at).not.toBeNull()
		expect(row.archived_by).toBe("alice")
	})

	it("getNaisTeamsForDevTeam filters out archived rows", async () => {
		const sectionId = await createSection("Sek", "sek")
		const teamId = await createDevTeam("Team", "team", sectionId)
		await createNaisTeam("nais-a")
		await createNaisTeam("nais-b")

		await linkNaisTeamToDevTeam("nais-a", teamId, "alice")
		await linkNaisTeamToDevTeam("nais-b", teamId, "alice")
		await unlinkNaisTeamFromDevTeam("nais-a", teamId, "alice")

		const linked = await getNaisTeamsForDevTeam(teamId)
		expect(linked).toHaveLength(1)
		expect(linked[0].slug).toBe("nais-b")
	})

	it("re-linking after unlink creates a new active row, archived row preserved", async () => {
		const db = getTestDb()
		const sectionId = await createSection("Sek", "sek")
		const teamId = await createDevTeam("Team", "team", sectionId)
		await createNaisTeam("nais-a")

		await linkNaisTeamToDevTeam("nais-a", teamId, "alice")
		await unlinkNaisTeamFromDevTeam("nais-a", teamId, "alice")
		await linkNaisTeamToDevTeam("nais-a", teamId, "bob")

		const all = await db.execute(
			/* sql */ `SELECT archived_at FROM dev_team_nais_team_mappings WHERE dev_team_id = '${teamId}'`,
		)
		expect(all.rows).toHaveLength(2)
		const rows = all.rows as Array<{ archived_at: Date | null }>
		expect(rows.filter((r) => r.archived_at !== null)).toHaveLength(1)
		expect(rows.filter((r) => r.archived_at === null)).toHaveLength(1)
	})

	it("partial unique index prevents two active rows for same (dev_team_id, nais_team_id)", async () => {
		const db = getTestDb()
		const sectionId = await createSection("Sek", "sek")
		const teamId = await createDevTeam("Team", "team", sectionId)
		const naisId = await createNaisTeam("nais-a")

		await db.execute(
			/* sql */ `INSERT INTO dev_team_nais_team_mappings (dev_team_id, nais_team_id, created_by) VALUES ('${teamId}', '${naisId}', 'a')`,
		)
		await expect(
			db.execute(
				/* sql */ `INSERT INTO dev_team_nais_team_mappings (dev_team_id, nais_team_id, created_by) VALUES ('${teamId}', '${naisId}', 'a')`,
			),
		).rejects.toThrow()
	})

	it("partial unique index allows multiple archived rows alongside one active", async () => {
		const db = getTestDb()
		const sectionId = await createSection("Sek", "sek")
		const teamId = await createDevTeam("Team", "team", sectionId)
		const naisId = await createNaisTeam("nais-a")

		await db.execute(
			/* sql */ `INSERT INTO dev_team_nais_team_mappings (dev_team_id, nais_team_id, created_by, archived_at, archived_by) VALUES ('${teamId}', '${naisId}', 'a', now(), 'sys')`,
		)
		await db.execute(
			/* sql */ `INSERT INTO dev_team_nais_team_mappings (dev_team_id, nais_team_id, created_by, archived_at, archived_by) VALUES ('${teamId}', '${naisId}', 'a', now(), 'sys')`,
		)
		await db.execute(
			/* sql */ `INSERT INTO dev_team_nais_team_mappings (dev_team_id, nais_team_id, created_by) VALUES ('${teamId}', '${naisId}', 'a')`,
		)
		const all = await db.execute(
			/* sql */ `SELECT archived_at FROM dev_team_nais_team_mappings WHERE dev_team_id = '${teamId}'`,
		)
		expect(all.rows).toHaveLength(3)
	})

	it("idempotent: linking an existing active mapping is a no-op (no duplicate row, no extra audit)", async () => {
		const db = getTestDb()
		const sectionId = await createSection("Sek", "sek")
		const teamId = await createDevTeam("Team", "team", sectionId)
		await createNaisTeam("nais-a")

		await linkNaisTeamToDevTeam("nais-a", teamId, "alice")
		await linkNaisTeamToDevTeam("nais-a", teamId, "alice")

		const all = await db.execute(/* sql */ `SELECT id FROM dev_team_nais_team_mappings WHERE dev_team_id = '${teamId}'`)
		expect(all.rows).toHaveLength(1)

		const audits = await db.execute(/* sql */ `SELECT action FROM audit_log WHERE action = 'dev_team_nais_team_linked'`)
		expect(audits.rows).toHaveLength(1)
	})

	it("idempotent: unlinking a non-existent mapping is a no-op (no audit)", async () => {
		const db = getTestDb()
		const sectionId = await createSection("Sek", "sek")
		const teamId = await createDevTeam("Team", "team", sectionId)
		await createNaisTeam("nais-a")

		await unlinkNaisTeamFromDevTeam("nais-a", teamId, "alice")

		const audits = await db.execute(
			/* sql */ `SELECT action FROM audit_log WHERE action = 'dev_team_nais_team_unlinked'`,
		)
		expect(audits.rows).toHaveLength(0)
	})

	it("unlinking an already-archived mapping is a no-op (no extra audit)", async () => {
		const db = getTestDb()
		const sectionId = await createSection("Sek", "sek")
		const teamId = await createDevTeam("Team", "team", sectionId)
		await createNaisTeam("nais-a")

		await linkNaisTeamToDevTeam("nais-a", teamId, "alice")
		await unlinkNaisTeamFromDevTeam("nais-a", teamId, "alice")
		await unlinkNaisTeamFromDevTeam("nais-a", teamId, "alice")

		const audits = await db.execute(
			/* sql */ `SELECT action FROM audit_log WHERE action = 'dev_team_nais_team_unlinked'`,
		)
		expect(audits.rows).toHaveLength(1)
	})

	it("audit payload includes entity ids, slug and previous/new value for link/unlink", async () => {
		const db = getTestDb()
		const sectionId = await createSection("Sek", "sek")
		const teamId = await createDevTeam("Team Foo", "team-foo", sectionId)
		await createNaisTeam("nais-foo")

		await linkNaisTeamToDevTeam("nais-foo", teamId, "alice")
		await unlinkNaisTeamFromDevTeam("nais-foo", teamId, "bob")

		const linkAudit = await db.execute(
			/* sql */ `SELECT entity_type, new_value, metadata, performed_by FROM audit_log WHERE action = 'dev_team_nais_team_linked'`,
		)
		expect(linkAudit.rows).toHaveLength(1)
		const linkRow = linkAudit.rows[0] as {
			entity_type: string
			new_value: string
			metadata: string
			performed_by: string
		}
		expect(linkRow.entity_type).toBe("dev_team_nais_team_mapping")
		expect(linkRow.new_value).toBe("Team Foo ↔ nais-foo")
		const linkMeta = JSON.parse(linkRow.metadata) as { devTeamId: string; naisTeamSlug: string }
		expect(linkMeta.devTeamId).toBe(teamId)
		expect(linkMeta.naisTeamSlug).toBe("nais-foo")
		expect(linkRow.performed_by).toBe("alice")

		const unlinkAudit = await db.execute(
			/* sql */ `SELECT entity_type, previous_value, metadata, performed_by FROM audit_log WHERE action = 'dev_team_nais_team_unlinked'`,
		)
		expect(unlinkAudit.rows).toHaveLength(1)
		const unlinkRow = unlinkAudit.rows[0] as {
			entity_type: string
			previous_value: string
			metadata: string
			performed_by: string
		}
		expect(unlinkRow.entity_type).toBe("dev_team_nais_team_mapping")
		expect(unlinkRow.previous_value).toBe("Team Foo ↔ nais-foo")
		const unlinkMeta = JSON.parse(unlinkRow.metadata) as { devTeamId: string; naisTeamSlug: string }
		expect(unlinkMeta.devTeamId).toBe(teamId)
		expect(unlinkMeta.naisTeamSlug).toBe("nais-foo")
		expect(unlinkRow.performed_by).toBe("bob")
	})

	it("atomicity: link to archived dev team rolls back without writing audit", async () => {
		const db = getTestDb()
		const sectionId = await createSection("Sek", "sek")
		const teamId = await createDevTeam("Team", "team", sectionId)
		await createNaisTeam("nais-a")
		await db.execute(/* sql */ `UPDATE dev_teams SET archived_at = now(), archived_by = 'sys' WHERE id = '${teamId}'`)

		await expect(linkNaisTeamToDevTeam("nais-a", teamId, "alice")).rejects.toThrow(/arkivert/)

		const mappings = await db.execute(
			/* sql */ `SELECT 1 FROM dev_team_nais_team_mappings WHERE dev_team_id = '${teamId}'`,
		)
		expect(mappings.rows).toHaveLength(0)

		const audits = await db.execute(/* sql */ `SELECT 1 FROM audit_log WHERE action = 'dev_team_nais_team_linked'`)
		expect(audits.rows).toHaveLength(0)
	})
})
