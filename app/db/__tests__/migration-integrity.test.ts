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
 * Cut-off policy for future timestamps:
 *
 * Due to past AI errors, some journal entries have `when` timestamps in the
 * future (as of April 2026). To avoid breaking the existing migration chain,
 * we allow new entries to continue incrementing beyond the highest existing
 * timestamp — but only up to a 2-hour window (allowing ~120 migrations at
 * 1-minute spacing).
 *
 * Once the real-world clock passes CUTOFF_DATE, ALL new timestamps must be
 * ≤ Date.now(). No more future timestamps are permitted.
 */
const MAX_FUTURE_WINDOW_MS = 2 * 60 * 60 * 1000 // 2 hours

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
			if (!entry.tag.startsWith(expectedPrefix + "_")) {
				mismatches.push(`idx=${entry.idx}: tag="${entry.tag}" doesn't start with "${expectedPrefix}_"`)
			}
		}

		expect(mismatches, `File prefix mismatches:\n${mismatches.join("\n")}`).toEqual([])
	})

	it("SQL file count matches journal entry count", () => {
		expect(sqlFiles.length, `${sqlFiles.length} SQL files but ${entries.length} journal entries`).toBe(entries.length)
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

	it("no timestamps exceed the future cutoff window", () => {
		if (entries.length === 0) return

		const highestWhen = entries[entries.length - 1].when
		const cutoffDate = highestWhen + MAX_FUTURE_WINDOW_MS
		const now = Date.now()
		const violations: string[] = []

		// Once the clock passes the cutoff date, NO entry may be in the future
		if (now >= cutoffDate) {
			for (const entry of entries) {
				if (entry.when > now) {
					violations.push(
						`Entry ${entry.idx} "${entry.tag}" has when=${entry.when} ` +
							`(${new Date(entry.when).toISOString()}) which is in the future. ` +
							`The cutoff date (${new Date(cutoffDate).toISOString()}) has passed; ` +
							`future timestamps are no longer allowed.`,
					)
				}
			}
		}

		// Regardless of date: no entry may exceed the absolute cutoff
		for (const entry of entries) {
			if (entry.when > cutoffDate) {
				violations.push(
					`Entry ${entry.idx} "${entry.tag}" has when=${entry.when} ` +
						`which exceeds the cutoff (highest + 2h = ${cutoffDate}).`,
				)
			}
		}

		expect(violations, `Future timestamp violations:\n${violations.join("\n")}`).toEqual([])
	})

	it("the highest timestamp does not exceed current time plus 2h window", () => {
		if (entries.length === 0) return

		const highestWhen = entries[entries.length - 1].when
		const cutoffDate = highestWhen + MAX_FUTURE_WINDOW_MS
		const now = Date.now()

		// After the cutoff date has passed, the highest timestamp must be ≤ now
		if (now >= cutoffDate) {
			expect(
				highestWhen,
				`Highest timestamp ${highestWhen} (${new Date(highestWhen).toISOString()}) ` +
					`is in the future. After ${new Date(cutoffDate).toISOString()}, ` +
					`only past/present timestamps are allowed.`,
			).toBeLessThanOrEqual(now)
		}
	})

	// ─── 5. New migration timestamp validation ───────────────────────────

	it("the last journal entry has a valid timestamp relative to its predecessor", () => {
		if (entries.length < 2) return

		const last = entries[entries.length - 1]
		const secondLast = entries[entries.length - 2]

		// Must be greater than predecessor
		expect(
			last.when,
			`Last entry "${last.tag}" (when=${last.when}) must be after ` + `"${secondLast.tag}" (when=${secondLast.when})`,
		).toBeGreaterThan(secondLast.when)

		// Must not exceed 2h from predecessor (prevents massive jumps)
		const maxJump = MAX_FUTURE_WINDOW_MS
		expect(
			last.when - secondLast.when,
			`Last entry "${last.tag}" jumped ${last.when - secondLast.when}ms from predecessor. ` +
				`Maximum allowed jump is ${maxJump}ms (2 hours).`,
		).toBeLessThanOrEqual(maxJump)
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
			if (!sqlFiles[i].startsWith(expectedPrefix + "_")) {
				gaps.push(`Position ${i}: expected prefix "${expectedPrefix}_" but got "${sqlFiles[i]}"`)
			}
		}

		expect(gaps, `Gaps in SQL file numbering:\n${gaps.join("\n")}`).toEqual([])
	})
})
