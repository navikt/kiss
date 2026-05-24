import { describe, expect, it } from "vitest"
import { applyEntraStagedDataPatch, parseEntraStagedData } from "~/lib/entra-staged-data"

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
