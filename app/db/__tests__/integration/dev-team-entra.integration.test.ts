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

const {
	clearDevTeamEntraMembers,
	getActiveDevTeamEntraMembers,
	getDevTeamsWithEntraGroup,
	isActiveDevTeamEntraMember,
	linkEntraGroupToTeam,
	syncDevTeamEntraMembers,
	unlinkEntraGroupFromTeam,
} = await import("~/db/queries/dev-team-entra.server")

const SECTION_ID = "00000000-0000-0000-0000-000000000201"
const TEAM_ID = "00000000-0000-0000-0000-000000000202"
const OTHER_TEAM_ID = "00000000-0000-0000-0000-000000000203"
const ENTRA_GROUP_ID = "entra-group-1"

describe("dev-team-entra query-lag", () => {
	beforeAll(async () => {
		await setupTestDatabase()
	})

	afterAll(async () => {
		await teardownTestDatabase()
	})

	beforeEach(async () => {
		await truncateWithRetry(["dev_team_entra_members", "dev_teams", "sections"])

		const db = getTestDb()
		await db.execute(/* sql */ `
			INSERT INTO sections (id, name, slug, created_by, updated_by)
			VALUES ('${SECTION_ID}', 'Pensjon og uføre', 'pensjon-og-ufore', 'test', 'test')
		`)
		await db.execute(/* sql */ `
			INSERT INTO dev_teams (id, section_id, name, slug, created_by, updated_by)
			VALUES
				('${TEAM_ID}', '${SECTION_ID}', 'Starte pensjon', 'starte-pensjon', 'test', 'test'),
				('${OTHER_TEAM_ID}', '${SECTION_ID}', 'Annet team', 'annet-team', 'test', 'test')
		`)
	})

	it("kobler en Entra-gruppe til et team og skriver audit-logg med før/etter-verdier", async () => {
		await linkEntraGroupToTeam(TEAM_ID, ENTRA_GROUP_ID, "Team Starte Pensjon", "Z990001")

		const teams = await getDevTeamsWithEntraGroup()
		expect(teams).toEqual([{ devTeamId: TEAM_ID, entraGroupId: ENTRA_GROUP_ID, teamName: "Starte pensjon" }])

		const db = getTestDb()
		const auditRows = await db.execute(
			/* sql */ `SELECT action, entity_id, previous_value, new_value FROM audit_log WHERE action = 'entra_group_linked_to_team'`,
		)
		expect(auditRows.rows).toHaveLength(1)
		const row = auditRows.rows[0] as { previous_value: string; new_value: string }
		expect(JSON.parse(row.previous_value)).toEqual({ entraGroupId: null, entraGroupName: null })
		expect(JSON.parse(row.new_value)).toEqual({ entraGroupId: ENTRA_GROUP_ID, entraGroupName: "Team Starte Pensjon" })
	})

	it("avviser kobling av samme Entra-gruppe til to aktive team", async () => {
		await linkEntraGroupToTeam(TEAM_ID, ENTRA_GROUP_ID, "Team A", "Z990001")

		await expect(linkEntraGroupToTeam(OTHER_TEAM_ID, ENTRA_GROUP_ID, "Team A", "Z990001")).rejects.toThrow(
			"allerede koblet",
		)
	})

	it("tillater re-kobling av samme Entra-gruppe etter at det opprinnelige teamet er arkivert", async () => {
		await linkEntraGroupToTeam(TEAM_ID, ENTRA_GROUP_ID, "Team A", "Z990001")

		const db = getTestDb()
		await db.execute(/* sql */ `UPDATE dev_teams SET archived_at = now(), archived_by = 'test' WHERE id = '${TEAM_ID}'`)

		await expect(linkEntraGroupToTeam(OTHER_TEAM_ID, ENTRA_GROUP_ID, "Team A", "Z990001")).resolves.toBeTruthy()
	})

	it("fjerner kobling, arkiverer alle aktive automatiske medlemmer og logger previousValue", async () => {
		await linkEntraGroupToTeam(TEAM_ID, ENTRA_GROUP_ID, "Team A", "Z990001")
		await syncDevTeamEntraMembers(
			TEAM_ID,
			ENTRA_GROUP_ID,
			[{ navIdent: "Z990002", displayName: "Glad Fjord", mail: "glad.fjord@nav.no" }],
			"system:entra-team-sync",
		)

		await unlinkEntraGroupFromTeam(TEAM_ID, "Z990001")

		const teams = await getDevTeamsWithEntraGroup()
		expect(teams).toEqual([])
		const members = await getActiveDevTeamEntraMembers(TEAM_ID)
		expect(members).toEqual([])

		const db = getTestDb()
		const auditRows = await db.execute(
			/* sql */ `SELECT previous_value FROM audit_log WHERE action = 'entra_group_unlinked_from_team'`,
		)
		expect(auditRows.rows).toHaveLength(1)
		const row = auditRows.rows[0] as { previous_value: string }
		expect(JSON.parse(row.previous_value)).toEqual({ entraGroupId: ENTRA_GROUP_ID, entraGroupName: "Team A" })
	})

	it("synker medlemmer: legger til, oppdaterer, reaktiverer og arkiverer", async () => {
		await linkEntraGroupToTeam(TEAM_ID, ENTRA_GROUP_ID, "Team A", "Z990001")

		const members1 = [
			{ navIdent: "Z990001", displayName: "Glad Fjord", mail: "glad.fjord@nav.no" },
			{ navIdent: "Z990002", displayName: "Rask Elv", mail: "rask.elv@nav.no" },
		]
		const diff1 = await syncDevTeamEntraMembers(TEAM_ID, ENTRA_GROUP_ID, members1, "system:entra-team-sync")
		expect(diff1).toEqual({ added: 2, updated: 0, archived: 0, skipped: false })

		// Z990001 oppdateres, Z990002 forsvinner (arkiveres), Z990003 er nytt medlem
		const members2 = [
			{ navIdent: "Z990001", displayName: "Glad Fjord (oppdatert)", mail: "glad.fjord@nav.no" },
			{ navIdent: "Z990003", displayName: "Stille Skog", mail: "stille.skog@nav.no" },
		]
		const diff2 = await syncDevTeamEntraMembers(TEAM_ID, ENTRA_GROUP_ID, members2, "system:entra-team-sync")
		expect(diff2).toEqual({ added: 1, updated: 1, archived: 1, skipped: false })

		const active = await getActiveDevTeamEntraMembers(TEAM_ID)
		expect(active.map((m) => m.navIdent).sort()).toEqual(["Z990001", "Z990003"])
		expect(active.find((m) => m.navIdent === "Z990001")?.displayName).toBe("Glad Fjord (oppdatert)")

		expect(await isActiveDevTeamEntraMember(TEAM_ID, "Z990002")).toBe(false)

		// Z990002 kommer tilbake — skal reaktiveres, ikke gi duplikat-feil på unik indeks
		const members3 = [...members2, { navIdent: "Z990002", displayName: "Rask Elv", mail: "rask.elv@nav.no" }]
		const diff3 = await syncDevTeamEntraMembers(TEAM_ID, ENTRA_GROUP_ID, members3, "system:entra-team-sync")
		expect(diff3).toEqual({ added: 1, updated: 2, archived: 0, skipped: false })
		expect(await isActiveDevTeamEntraMember(TEAM_ID, "Z990002")).toBe(true)
	})

	it("dedupliserer input med duplikat navIdent uten unik-indeks-brudd", async () => {
		await linkEntraGroupToTeam(TEAM_ID, ENTRA_GROUP_ID, "Team A", "Z990001")

		const membersWithDuplicate = [
			{ navIdent: "Z990001", displayName: "Glad Fjord", mail: "glad.fjord@nav.no" },
			{ navIdent: "Z990001", displayName: "Glad Fjord", mail: "glad.fjord@nav.no" },
		]

		const diff = await syncDevTeamEntraMembers(TEAM_ID, ENTRA_GROUP_ID, membersWithDuplicate, "system:entra-team-sync")
		expect(diff).toEqual({ added: 1, updated: 0, archived: 0, skipped: false })

		const active = await getActiveDevTeamEntraMembers(TEAM_ID)
		expect(active).toHaveLength(1)
	})

	it("hopper over synk uten mutasjon når teamet er koblet til en annen gruppe enn forventet (race)", async () => {
		await linkEntraGroupToTeam(TEAM_ID, "entra-group-annen", "Annen gruppe", "Z990001")

		const diff = await syncDevTeamEntraMembers(
			TEAM_ID,
			ENTRA_GROUP_ID,
			[{ navIdent: "Z990001", displayName: "Glad Fjord", mail: null }],
			"system:entra-team-sync",
		)

		expect(diff).toEqual({ added: 0, updated: 0, archived: 0, skipped: true })
		expect(await getActiveDevTeamEntraMembers(TEAM_ID)).toEqual([])
	})

	it("hopper over clear uten mutasjon når teamet er koblet til en annen gruppe enn forventet (race)", async () => {
		await linkEntraGroupToTeam(TEAM_ID, ENTRA_GROUP_ID, "Team A", "Z990001")
		await syncDevTeamEntraMembers(
			TEAM_ID,
			ENTRA_GROUP_ID,
			[{ navIdent: "Z990001", displayName: "Glad Fjord", mail: null }],
			"system:entra-team-sync",
		)

		const { archived, skipped } = await clearDevTeamEntraMembers(
			TEAM_ID,
			"entra-group-en-annen",
			"system:entra-team-sync",
		)

		expect(skipped).toBe(true)
		expect(archived).toBe(0)
		expect(await isActiveDevTeamEntraMember(TEAM_ID, "Z990001")).toBe(true)
	})

	it("clearDevTeamEntraMembers arkiverer all aktiv medlemskap umiddelbart", async () => {
		await linkEntraGroupToTeam(TEAM_ID, ENTRA_GROUP_ID, "Team A", "Z990001")
		await syncDevTeamEntraMembers(
			TEAM_ID,
			ENTRA_GROUP_ID,
			[{ navIdent: "Z990001", displayName: "Glad Fjord", mail: null }],
			"system:entra-team-sync",
		)

		const { archived, skipped } = await clearDevTeamEntraMembers(TEAM_ID, ENTRA_GROUP_ID, "system:entra-team-sync")
		expect(skipped).toBe(false)
		expect(archived).toBe(1)
		expect(await getActiveDevTeamEntraMembers(TEAM_ID)).toEqual([])
	})

	it("holder medlemskap for ulike team adskilt", async () => {
		await linkEntraGroupToTeam(TEAM_ID, ENTRA_GROUP_ID, "Team A", "Z990001")
		await linkEntraGroupToTeam(OTHER_TEAM_ID, "entra-group-2", "Team B", "Z990001")

		await syncDevTeamEntraMembers(
			TEAM_ID,
			ENTRA_GROUP_ID,
			[{ navIdent: "Z990001", displayName: "Glad Fjord", mail: null }],
			"system:entra-team-sync",
		)
		await syncDevTeamEntraMembers(
			OTHER_TEAM_ID,
			"entra-group-2",
			[{ navIdent: "Z990001", displayName: "Glad Fjord", mail: null }],
			"system:entra-team-sync",
		)

		expect(await isActiveDevTeamEntraMember(TEAM_ID, "Z990001")).toBe(true)
		expect(await isActiveDevTeamEntraMember(OTHER_TEAM_ID, "Z990001")).toBe(true)

		await clearDevTeamEntraMembers(TEAM_ID, ENTRA_GROUP_ID, "system:entra-team-sync")

		expect(await isActiveDevTeamEntraMember(TEAM_ID, "Z990001")).toBe(false)
		expect(await isActiveDevTeamEntraMember(OTHER_TEAM_ID, "Z990001")).toBe(true)
	})

	it("har partiell unik indeks på entra_group_id for aktive team", async () => {
		const db = getTestDb()
		const result = await db.execute(
			/* sql */ `SELECT indexdef FROM pg_indexes WHERE indexname = 'dev_teams_entra_group_active_unique_idx'`,
		)
		expect(result.rows).toHaveLength(1)
		const indexDef = (result.rows[0] as { indexdef: string }).indexdef
		expect(indexDef).toContain("UNIQUE")
		expect(indexDef).toContain("WHERE ((entra_group_id IS NOT NULL) AND (archived_at IS NULL))")
	})
})
