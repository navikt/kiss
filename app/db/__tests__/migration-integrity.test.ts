import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * These tests guard against a recurring problem: AI-generated migration files
 * that are not registered in the Drizzle journal, or have invalid timestamps.
 *
 * Drizzle only runs migrations listed in `drizzle/meta/_journal.json`.
 * A .sql file without a journal entry is silently ignored — the most common
 * failure mode when migrations are created manually instead of via `drizzle-kit generate`.
 */

const DRIZZLE_DIR = resolve(__dirname, "..", "..", "..", "drizzle")
const META_DIR = join(DRIZZLE_DIR, "meta")

interface JournalEntry {
	idx: number
	version: string
	when: number
	tag: string
	breakpoints: boolean
}

interface Journal {
	version: string
	dialect: string
	entries: JournalEntry[]
}

function loadJournal(): Journal {
	const raw = readFileSync(join(META_DIR, "_journal.json"), "utf-8")
	return JSON.parse(raw)
}

function listSqlFiles(): string[] {
	return readdirSync(DRIZZLE_DIR)
		.filter((f) => f.endsWith(".sql"))
		.sort()
}

/**
 * Timestamp policy:
 *
 * Historisk har noen journal-entries fått `when`-tidsstempler i fremtiden
 * pga. AI-genererte feil, kompensert med en midlertidig "logical clock"-ordning
 * (strikte 1-minutts-økninger). Etter eksplisitt beslutning fra tech lead er
 * denne ordningen erstattet: nye migrasjoner skal ha `when` som reflekterer
 * det faktiske opprettelsestidspunktet, og testene skal kun sikre at ingen
 * migrasjon får et tidsstempel i fremtiden. Eksisterende (historiske)
 * entries med gamle fremtidsdaterte tidsstempler er ikke lenger i fremtiden
 * ettersom klokken har passert dem, og trenger derfor ingen særbehandling.
 */

/**
 * Frozen allowlist of all legacy journal entries (idx 0–37).
 * Prevents accidental or AI-generated modifications to existing entries.
 * New entries must NOT be added here — they are validated by the strict
 * 1-minute increment rule instead.
 */
const LEGACY_ENTRIES: ReadonlyArray<{ idx: number; when: number; tag: string }> = [
	{ idx: 0, when: 1774771294110, tag: "0000_hesitant_jimmy_woo" },
	{ idx: 1, when: 1775460944075, tag: "0001_windy_sally_floyd" },
	{ idx: 2, when: 1775560526499, tag: "0002_unique_penance" },
	{ idx: 3, when: 1775561612871, tag: "0003_naive_night_nurse" },
	{ idx: 4, when: 1775629692320, tag: "0004_swift_quentin_quire" },
	{ idx: 5, when: 1775664083618, tag: "0005_left_dexter_bennett" },
	{ idx: 6, when: 1775677263244, tag: "0006_glamorous_madame_hydra" },
	{ idx: 7, when: 1775678818309, tag: "0007_noisy_lady_deathstrike" },
	{ idx: 8, when: 1775687992962, tag: "0008_spooky_black_knight" },
	{ idx: 9, when: 1775690181861, tag: "0009_useful_joseph" },
	{ idx: 10, when: 1775715926361, tag: "0010_acoustic_mordo" },
	{ idx: 11, when: 1775721902688, tag: "0011_whole_the_hand" },
	{ idx: 12, when: 1775799250883, tag: "0012_magical_dakota_north" },
	{ idx: 13, when: 1775804099500, tag: "0013_public_millenium_guard" },
	{ idx: 14, when: 1775816743143, tag: "0014_deployment_verification_summaries" },
	{ idx: 15, when: 1775937793000, tag: "0015_compliance_app_status_index" },
	{ idx: 16, when: 1781596000000, tag: "0016_routine_controls_and_role" },
	{ idx: 17, when: 1781597000000, tag: "0017_simplify_screening_choices" },
	{ idx: 18, when: 1781698000000, tag: "0018_persistence_manual_databases" },
	{ idx: 19, when: 1781799000000, tag: "0019_routine_persistence_fields" },
	{ idx: 20, when: 1781900000000, tag: "0020_screening_routine_selections" },
	{ idx: 21, when: 1781901000000, tag: "0021_routine_persistence_links" },
	{ idx: 22, when: 1781902000000, tag: "0022_screening_question_technology_elements" },
	{ idx: 23, when: 1781903000000, tag: "0023_routine_applies_to_all" },
	{ idx: 24, when: 1781904000000, tag: "0024_screening_question_ruleset" },
	{ idx: 25, when: 1781905000000, tag: "0025_application_manual_groups" },
	{ idx: 26, when: 1781906000000, tag: "0026_application_group_assessments" },
	{ idx: 27, when: 1781907000000, tag: "0027_ruleset_routines" },
	{ idx: 28, when: 1781908000000, tag: "0028_user_preferences" },
	{ idx: 29, when: 1781909000000, tag: "0029_section_excluded_environments" },
	{ idx: 30, when: 1781910000000, tag: "0030_wise_beyonder" },
	{ idx: 31, when: 1781911000000, tag: "0031_dear_dexter_bennett" },
	{ idx: 32, when: 1781912000000, tag: "0032_application_controls" },
	{ idx: 33, when: 1781913000000, tag: "0033_routine_status" },
	{ idx: 34, when: 1781914000000, tag: "0034_routine_approval" },
	{ idx: 35, when: 1781914060000, tag: "0035_entra_group_classifications" },
	{ idx: 36, when: 1781914120000, tag: "0036_section_environments" },
	{ idx: 37, when: 1781914180000, tag: "0037_drop_section_excluded_environments" },
]

describe("Drizzle migration integrity", () => {
	const journal = loadJournal()
	const sqlFiles = listSqlFiles()
	const entries = journal.entries

	// ─── 1. Bidirectional consistency ─────────────────────────────────────

	it("every .sql file has a corresponding journal entry", () => {
		const journalTags = new Set(entries.map((e) => e.tag))
		const orphanFiles: string[] = []

		for (const file of sqlFiles) {
			const tag = file.replace(/\.sql$/, "")
			if (!journalTags.has(tag)) {
				orphanFiles.push(file)
			}
		}

		expect(orphanFiles, `SQL files without journal entries: ${orphanFiles.join(", ")}`).toEqual([])
	})

	it("every journal entry has a corresponding .sql file", () => {
		const sqlFileSet = new Set(sqlFiles.map((f) => f.replace(/\.sql$/, "")))
		const missingFiles: string[] = []

		for (const entry of entries) {
			if (!sqlFileSet.has(entry.tag)) {
				missingFiles.push(`${entry.tag}.sql`)
			}
		}

		expect(missingFiles, `Journal entries without SQL files: ${missingFiles.join(", ")}`).toEqual([])
	})

	// ─── 2. Sequential index ordering ─────────────────────────────────────

	it("journal entry indices are sequential starting from 0", () => {
		for (let i = 0; i < entries.length; i++) {
			expect(entries[i].idx, `Entry at position ${i} has idx=${entries[i].idx}, expected ${i}`).toBe(i)
		}
	})

	it("SQL file prefix numbers match journal indices", () => {
		const mismatches: string[] = []

		for (const entry of entries) {
			const expectedPrefix = String(entry.idx).padStart(4, "0")
			if (!entry.tag.startsWith(`${expectedPrefix}_`)) {
				mismatches.push(`idx=${entry.idx}: tag="${entry.tag}" doesn't start with "${expectedPrefix}_"`)
			}
		}

		expect(mismatches, `File prefix mismatches:\n${mismatches.join("\n")}`).toEqual([])
	})

	it("SQL file count matches journal entry count", () => {
		expect(sqlFiles.length, `${sqlFiles.length} SQL files but ${entries.length} journal entries`).toBe(entries.length)
	})

	// ─── 2b. Legacy entry allowlist ───────────────────────────────────────

	it("legacy journal entries (idx 0–37) have not been modified", () => {
		const violations: string[] = []

		for (const expected of LEGACY_ENTRIES) {
			const actual = entries[expected.idx]
			if (!actual) {
				violations.push(`Entry idx=${expected.idx} is missing from journal`)
				continue
			}
			if (actual.when !== expected.when) {
				violations.push(`Entry ${expected.idx} "${expected.tag}": when changed from ${expected.when} to ${actual.when}`)
			}
			if (actual.tag !== expected.tag) {
				violations.push(`Entry ${expected.idx}: tag changed from "${expected.tag}" to "${actual.tag}"`)
			}
		}

		expect(violations, `Legacy entries were modified:\n${violations.join("\n")}`).toEqual([])
	})

	// ─── 3. Timestamp ordering ────────────────────────────────────────────

	it("journal timestamps are strictly increasing", () => {
		const violations: string[] = []

		for (let i = 1; i < entries.length; i++) {
			if (entries[i].when <= entries[i - 1].when) {
				violations.push(
					`Entry ${entries[i].idx} (when=${entries[i].when}) is not after ` +
						`entry ${entries[i - 1].idx} (when=${entries[i - 1].when})`,
				)
			}
		}

		expect(violations, `Non-monotonic timestamps:\n${violations.join("\n")}`).toEqual([])
	})

	// ─── 4. Future timestamp policy ───────────────────────────────────────

	it("no journal entry has a timestamp in the future", () => {
		const now = Date.now()
		const violations: string[] = []

		for (const entry of entries) {
			if (entry.when > now) {
				violations.push(
					`Entry ${entry.idx} "${entry.tag}" has when=${entry.when} ` +
						`(${new Date(entry.when).toISOString()}) which is in the future ` +
						`relative to now (${new Date(now).toISOString()}).`,
				)
			}
		}

		expect(violations, `Future timestamp violations:\n${violations.join("\n")}`).toEqual([])
	})

	// ─── 6. File naming convention ────────────────────────────────────────

	it("all SQL files follow the NNNN_name.sql naming convention", () => {
		const badNames: string[] = []
		const pattern = /^\d{4}_[a-z0-9_]+\.sql$/

		for (const file of sqlFiles) {
			if (!pattern.test(file)) {
				badNames.push(file)
			}
		}

		expect(badNames, `Files not matching NNNN_name.sql pattern: ${badNames.join(", ")}`).toEqual([])
	})

	it("SQL file numbers are sequential without gaps", () => {
		const gaps: string[] = []

		for (let i = 0; i < sqlFiles.length; i++) {
			const expectedPrefix = String(i).padStart(4, "0")
			if (!sqlFiles[i].startsWith(`${expectedPrefix}_`)) {
				gaps.push(`Position ${i}: expected prefix "${expectedPrefix}_" but got "${sqlFiles[i]}"`)
			}
		}

		expect(gaps, `Gaps in SQL file numbering:\n${gaps.join("\n")}`).toEqual([])
	})

	// ─── 7. FK-constraint-rename coverage ─────────────────────────────────
	//
	// Når en migrasjon endrer ON DELETE-policy på en FK ved å
	// DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT, må DROP-en treffe det
	// faktiske constraint-navnet i Postgres. Tabeller opprettet med inline
	// REFERENCES (uten eksplisitt CONSTRAINT-navn) får default-navnet
	// `<tabell>_<kolonne>_fkey`, mens Drizzle-genererte navn er
	// `<tabell>_<kolonne>_<ref-tabell>_<ref-kol>_fk`. Hvis migrasjonen kun
	// dropper Drizzle-navnet vil den gamle CASCADE-FK-en overleve som
	// duplikat ved siden av den nye RESTRICT-FK-en.
	//
	// Denne testen finner alle inline-FK-er definert i migrasjons-historien
	// og verifiserer at hvis en senere migrasjon ADD CONSTRAINT-er den
	// "Drizzle-navngitte" FK-en på samme (tabell, kolonne), så har den
	// migrasjonen også DROP IF EXISTS for default-Postgres-navnet.

	it("migrations that re-add FKs also drop legacy inline constraint names", () => {
		const inlineFks = new Map<string, { table: string; column: string; sourceFile: string }>()
		const explicitFks = new Map<string, { table: string; column: string; constraintName: string; sourceFile: string }>()

		// Pass 1: katalogisér alle FK-er på child-tabeller mot routines.id (eller andre referansetabeller).
		// Inline-mønster: `"col" type ... REFERENCES "ref"("col") ...` inni CREATE TABLE.
		// Eksplisitt: `CONSTRAINT "name" FOREIGN KEY ("col") REFERENCES ...`.
		for (const file of sqlFiles) {
			const sql = readFileSync(join(DRIZZLE_DIR, file), "utf-8")

			// CREATE TABLE-blokker for å fange inline-FK med tabellkontekst
			const createTableRegex = /CREATE TABLE (?:IF NOT EXISTS )?"([^"]+)"\s*\(([\s\S]*?)\n\)/gi
			for (const m of sql.matchAll(createTableRegex)) {
				const table = m[1]
				const body = m[2]
				// Inline FK uten CONSTRAINT-navn: «"col" type ... REFERENCES "ref"("rcol")»
				const inlineRegex = /"([a-z_][a-z0-9_]*)"\s+[a-z]+[^,]*?REFERENCES\s+"[^"]+"\("[^"]+"\)/gi
				for (const im of body.matchAll(inlineRegex)) {
					const col = im[1]
					const key = `${table}.${col}`
					if (!inlineFks.has(key)) {
						inlineFks.set(key, { table, column: col, sourceFile: file })
					}
				}
				// Eksplisitt CONSTRAINT inni CREATE TABLE
				const inlineNamedRegex = /CONSTRAINT\s+"([^"]+)"\s+FOREIGN KEY\s*\(\s*"([^"]+)"\s*\)/gi
				for (const nm of body.matchAll(inlineNamedRegex)) {
					const name = nm[1]
					const col = nm[2]
					const key = `${table}.${col}`
					if (!explicitFks.has(key)) {
						explicitFks.set(key, { table, column: col, constraintName: name, sourceFile: file })
					}
				}
			}

			// ALTER TABLE ... ADD CONSTRAINT (utenfor CREATE TABLE)
			const addConstraintRegex =
				/ALTER TABLE\s+"([^"]+)"\s+ADD CONSTRAINT\s+"([^"]+)"\s+FOREIGN KEY\s*\(\s*"([^"]+)"\s*\)/gi
			for (const am of sql.matchAll(addConstraintRegex)) {
				const table = am[1]
				const name = am[2]
				const col = am[3]
				const key = `${table}.${col}`
				if (!explicitFks.has(key) && !inlineFks.has(key)) {
					explicitFks.set(key, { table, column: col, constraintName: name, sourceFile: file })
				}
			}
		}

		// Pass 2: for hver migrasjon som ADD CONSTRAINT-er en FK med Drizzle-navn,
		// verifiser at vi har DROP IF EXISTS for både legacy default-navn (..._fkey)
		// og eventuelt eldre eksplisitt navn på (tabell, kolonne).
		const failures: string[] = []
		for (const file of sqlFiles) {
			const sql = readFileSync(join(DRIZZLE_DIR, file), "utf-8")
			const reAdd = /ALTER TABLE\s+"([^"]+)"\s+ADD CONSTRAINT\s+"([^"]+)"\s+FOREIGN KEY\s*\(\s*"([^"]+)"\s*\)/gi
			const dropsInFile = new Set<string>()
			const reDrop = /DROP CONSTRAINT IF EXISTS\s+"([^"]+)"/gi
			for (const dm of sql.matchAll(reDrop)) {
				dropsInFile.add(dm[1])
			}
			for (const mm of sql.matchAll(reAdd)) {
				const table = mm[1]
				const newName = mm[2]
				const col = mm[3]
				const key = `${table}.${col}`
				const inlineSrc = inlineFks.get(key)
				const explicitSrc = explicitFks.get(key)
				// Bare relevant hvis denne migrasjonen ER nyere enn en kjent original FK
				// (samme migrasjon som opprettet inline FK trenger ikke å droppe den).
				const isReadd =
					(inlineSrc && inlineSrc.sourceFile !== file) ||
					(explicitSrc && explicitSrc.sourceFile !== file && explicitSrc.constraintName !== newName)
				if (!isReadd) continue

				// Sjekk at default-Postgres-navnet droppes hvis det fantes en inline-FK
				if (inlineSrc) {
					const legacy = `${table}_${col}_fkey`
					if (!dropsInFile.has(legacy)) {
						failures.push(
							`${file}: ADD CONSTRAINT "${newName}" på (${table}.${col}) mangler DROP CONSTRAINT IF EXISTS "${legacy}" — tabellen ble opprettet inline i ${inlineSrc.sourceFile} og har sannsynligvis Postgres-default-navnet.`,
						)
					}
				}
				// Sjekk at eldre eksplisitt navn droppes hvis det er forskjellig fra det nye
				if (explicitSrc && explicitSrc.constraintName !== newName) {
					if (!dropsInFile.has(explicitSrc.constraintName)) {
						failures.push(
							`${file}: ADD CONSTRAINT "${newName}" på (${table}.${col}) mangler DROP CONSTRAINT IF EXISTS "${explicitSrc.constraintName}" — eldre navn fra ${explicitSrc.sourceFile}.`,
						)
					}
				}
			}
		}

		expect(failures, failures.join("\n")).toEqual([])
	})
})
