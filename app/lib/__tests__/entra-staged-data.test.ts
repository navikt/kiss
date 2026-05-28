import { describe, expect, it } from "vitest"
import {
	applyEntraStagedDataPatch,
	parseCompletedEntraSnapshot,
	parseEntraStagedData,
	parseLegacyEntraGroupSnapshot,
} from "~/lib/entra-staged-data"

const baseData = parseEntraStagedData({
	activityType: "entra_id_group_maintenance",
	schemaVersion: 1,
	seededAt: "2025-01-01T00:00:00.000Z",
	groups: [
		{
			groupId: "nais-group",
			groupName: "NAIS Group",
			source: "nais_auth",
			hasNaisSource: true,
			hasManualSource: true,
			isNewAssessment: false,
			isAddedDuringReview: false,
			isGone: false,
			seededManualGroupId: "manual-seeded",
			criticality: "medium",
			criticalitySetBy: "seed",
			criticalitySetAt: "2025-01-01T00:00:00.000Z",
		},
		{
			groupId: "manual-group",
			groupName: "Manual Group",
			source: "manual",
			hasNaisSource: false,
			hasManualSource: true,
			isNewAssessment: true,
			isAddedDuringReview: false,
			isGone: true,
			seededManualGroupId: "manual-2",
			criticality: null,
			criticalitySetBy: null,
			criticalitySetAt: null,
		},
		{
			groupId: "ghost-group",
			groupName: "Ghost Group",
			source: "ghost",
			hasNaisSource: false,
			hasManualSource: false,
			isNewAssessment: false,
			isAddedDuringReview: false,
			isGone: false,
			seededManualGroupId: null,
			criticality: "high",
			criticalitySetBy: "seed",
			criticalitySetAt: "2025-01-01T00:00:00.000Z",
		},
	],
})

describe("entra staged data", () => {
	it("updates criticality metadata", () => {
		const updated = applyEntraStagedDataPatch(baseData, {
			op: "set-criticality",
			groupId: "nais-group",
			criticality: "very_high",
			setBy: "reviewer",
			setAt: "2025-02-01T00:00:00.000Z",
		})

		expect(updated.groups[0]).toMatchObject({
			criticality: "very_high",
			criticalitySetBy: "reviewer",
			criticalitySetAt: "2025-02-01T00:00:00.000Z",
		})
	})

	it("adds a new manual group and ignores duplicate active adds", () => {
		const added = applyEntraStagedDataPatch(baseData, {
			op: "add-group",
			groupId: "new-group",
			groupName: "New Group",
		})
		const duplicate = applyEntraStagedDataPatch(added, {
			op: "add-group",
			groupId: "new-group",
			groupName: "New Group",
		})

		expect(added.groups.find((group) => group.groupId === "new-group")).toMatchObject({
			source: "manual",
			hasManualSource: true,
			isAddedDuringReview: true,
			isGone: false,
		})
		expect(duplicate.groups).toHaveLength(added.groups.length)
	})

	it("revives ghost groups (isGone=false, no sources) by converting to manual", () => {
		const revived = applyEntraStagedDataPatch(baseData, {
			op: "add-group",
			groupId: "ghost-group",
			groupName: "Ghost Group",
		})

		expect(revived.groups.filter((group) => group.groupId === "ghost-group")).toHaveLength(1)
		expect(revived.groups.find((group) => group.groupId === "ghost-group")).toMatchObject({
			source: "manual",
			hasManualSource: true,
			isAddedDuringReview: true,
			isGone: false,
		})
	})

	it("removes only the manual source from overlap groups", () => {
		const updated = applyEntraStagedDataPatch(baseData, {
			op: "remove-manual-source",
			groupId: "nais-group",
		})

		expect(updated.groups.find((group) => group.groupId === "nais-group")).toMatchObject({
			source: "nais_auth",
			hasNaisSource: true,
			hasManualSource: false,
			isGone: false,
		})
	})

	it("marks a non-NAIS group as gone", () => {
		const updated = applyEntraStagedDataPatch(baseData, {
			op: "mark-gone",
			groupId: "manual-group",
		})

		expect(updated.groups.find((group) => group.groupId === "manual-group")).toMatchObject({
			isGone: true,
		})
	})

	it("mark-gone is idempotent when group is already gone", () => {
		const first = applyEntraStagedDataPatch(baseData, {
			op: "mark-gone",
			groupId: "manual-group",
		})
		const second = applyEntraStagedDataPatch(first, {
			op: "mark-gone",
			groupId: "manual-group",
		})

		expect(second.groups.find((group) => group.groupId === "manual-group")).toMatchObject({
			isGone: true,
		})
		expect(second.groups).toHaveLength(first.groups.length)
	})

	it("throws when trying to mark a NAIS-sourced group as gone", () => {
		expect(() =>
			applyEntraStagedDataPatch(baseData, {
				op: "mark-gone",
				groupId: "nais-group",
			}),
		).toThrow("Kan ikke markere NAIS-gruppe nais-group som fjernet")
	})
})

describe("parseCompletedEntraSnapshot", () => {
	it("parses new format snapshot (with type and schemaVersion)", () => {
		const snapshot = {
			type: "entra_id_group_maintenance",
			schemaVersion: 1,
			groups: [
				{
					groupId: "g1",
					groupName: "Group 1",
					source: "nais_auth",
					hasNaisSource: true,
					hasManualSource: false,
					isGone: false,
					criticality: "high",
				},
			],
		}
		const result = parseCompletedEntraSnapshot(snapshot)
		expect(result).not.toBeNull()
		expect(result?.type).toBe("entra_id_group_maintenance")
		expect(result?.schemaVersion).toBe(1)
		expect(result?.groups).toHaveLength(1)
		expect(result?.groups[0]).toMatchObject({
			groupId: "g1",
			source: "nais_auth",
			criticality: "high",
		})
	})

	it("parses pre-discriminant snapshot (current source values, no type field)", () => {
		// Snapshots written before type/schemaVersion were introduced — these use
		// the current source enum but lack the discriminant fields.
		const snapshot = {
			groups: [
				{
					groupId: "g2",
					groupName: "Group 2",
					source: "manual",
					hasNaisSource: false,
					hasManualSource: true,
					isGone: false,
					criticality: "medium",
				},
			],
		}
		const result = parseCompletedEntraSnapshot(snapshot)
		expect(result).not.toBeNull()
		expect(result?.groups).toHaveLength(1)
		expect(result?.groups[0]).toMatchObject({
			groupId: "g2",
			source: "manual",
			criticality: "medium",
		})
	})

	it("parses old legacy snapshot (nais/manual/removed source values)", () => {
		// Very old snapshots used source: "nais", "manual", "removed" instead of
		// the current "nais_auth", "manual", "ghost".
		const snapshot = {
			groups: [
				{
					groupId: "g3",
					groupName: "Group 3",
					source: "nais",
					criticality: "low",
				},
			],
		}
		const result = parseCompletedEntraSnapshot(snapshot)
		expect(result).not.toBeNull()
		expect(result?.groups).toHaveLength(1)
		expect(result?.groups[0]).toMatchObject({
			groupId: "g3",
			source: "nais_auth",
			hasNaisSource: true,
			hasManualSource: false,
		})
	})

	it("returns null for null input", () => {
		expect(parseCompletedEntraSnapshot(null)).toBeNull()
	})

	it("returns null for non-object input", () => {
		expect(parseCompletedEntraSnapshot("not an object")).toBeNull()
		expect(parseCompletedEntraSnapshot(42)).toBeNull()
	})

	it("returns null for completely invalid snapshot", () => {
		expect(parseCompletedEntraSnapshot({ notGroups: [] })).toBeNull()
	})
})

describe("parseLegacyEntraGroupSnapshot", () => {
	it("maps nais source to nais_auth", () => {
		const result = parseLegacyEntraGroupSnapshot({
			groups: [{ groupId: "g1", groupName: "G1", source: "nais", criticality: null }],
		})
		expect(result?.groups[0]).toMatchObject({ source: "nais_auth", hasNaisSource: true })
	})

	it("maps manual source to manual", () => {
		const result = parseLegacyEntraGroupSnapshot({
			groups: [{ groupId: "g1", groupName: "G1", source: "manual", criticality: null }],
		})
		expect(result?.groups[0]).toMatchObject({ source: "manual", hasManualSource: true })
	})

	it("maps removed source to ghost", () => {
		const result = parseLegacyEntraGroupSnapshot({
			groups: [{ groupId: "g1", groupName: "G1", source: "removed", criticality: null }],
		})
		expect(result?.groups[0]).toMatchObject({ source: "ghost", hasNaisSource: false, hasManualSource: false })
	})

	it("merges nais+manual rows for the same groupId", () => {
		const result = parseLegacyEntraGroupSnapshot({
			groups: [
				{ groupId: "shared", groupName: "Shared Group", source: "nais", criticality: null },
				{ groupId: "shared", groupName: "Shared Group", source: "manual", criticality: "high" },
			],
		})
		expect(result?.groups).toHaveLength(1)
		expect(result?.groups[0]).toMatchObject({
			groupId: "shared",
			source: "nais_auth",
			hasNaisSource: true,
			hasManualSource: true,
			criticality: "high",
		})
	})

	it("silently skips entries with unknown source values", () => {
		const result = parseLegacyEntraGroupSnapshot({
			groups: [
				{ groupId: "valid", groupName: "Valid", source: "nais", criticality: null },
				{ groupId: "invalid", groupName: "Invalid", source: "nais_auth", criticality: null },
			],
		})
		// nais_auth is not a legacy source value — should be skipped
		expect(result?.groups).toHaveLength(1)
		expect(result?.groups[0].groupId).toBe("valid")
	})

	it("preserves criticality from legacy snapshot", () => {
		const result = parseLegacyEntraGroupSnapshot({
			groups: [{ groupId: "g1", groupName: "G1", source: "nais", criticality: "very_high" }],
		})
		expect(result?.groups[0].criticality).toBe("very_high")
	})

	it("returns null for null input", () => {
		expect(parseLegacyEntraGroupSnapshot(null)).toBeNull()
	})

	it("returns null when groups is not an array", () => {
		expect(parseLegacyEntraGroupSnapshot({ groups: "not-array" })).toBeNull()
	})
})
