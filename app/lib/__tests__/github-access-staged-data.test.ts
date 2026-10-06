import { describe, expect, it } from "vitest"
import {
	applyGithubAccessStagedDataPatch,
	type GithubAccessStagedDataPatch,
	isGithubAccessReviewComplete,
	parseGithubAccessStagedData,
	toGithubAccessSnapshot,
} from "~/lib/github-access-staged-data"

const subject = {
	username: "glad-fjord",
	highestPermission: "admin",
	directPermission: "admin",
	viaTeams: [],
	isNew: false,
	isGone: false,
	markedForRemoval: false,
	removalMarkedBy: null,
	removalMarkedAt: null,
	permissionAdjustmentRequested: false,
	targetPermission: null,
	permissionAdjustmentMarkedBy: null,
	permissionAdjustmentMarkedAt: null,
}
const baseData = {
	activityType: "github_access_maintenance",
	schemaVersion: 1,
	seededAt: "2026-09-01T00:00:00.000Z",
	dataSyncedAt: "2026-09-01T00:00:00.000Z",
	gitRepository: "navikt/kiss",
	subjects: [subject],
	confirmedBy: null,
	confirmedAt: null,
}
const markedAt = "2026-09-02"
const removal: GithubAccessStagedDataPatch = {
	op: "mark-for-removal",
	username: subject.username,
	markedBy: "Z990001",
	markedAt,
}
const adjustment: GithubAccessStagedDataPatch = {
	...removal,
	op: "mark-for-adjustment",
	targetPermission: "push",
}
const confirmedAt = "2026-09-02T10:00:00.000Z"
const confirm: GithubAccessStagedDataPatch = {
	op: "confirm-review",
	confirmedBy: "Z990001",
	confirmedAt,
}
const parsed = () => parseGithubAccessStagedData(baseData)

describe("github access staged data", () => {
	it("is incomplete until the whole review is confirmed", () => {
		expect(isGithubAccessReviewComplete(parsed())).toBe(false)
	})

	it("accepts legacy fields without validating them or including them in new snapshots", () => {
		const legacy = {
			...baseData,
			subjects: [
				{
					...subject,
					segregationCompliant: false,
					compensatingControls: null,
					businessJustification: "Historisk begrunnelse",
					reviewedThisRound: true,
				},
			],
		}
		const data = parseGithubAccessStagedData(legacy)
		for (const key of ["segregationCompliant", "compensatingControls", "businessJustification", "reviewedThisRound"]) {
			expect(data.subjects[0]).not.toHaveProperty(key)
			expect(toGithubAccessSnapshot(data).subjects[0]).not.toHaveProperty(key)
		}
		expect(legacy.subjects[0].businessJustification).toBe("Historisk begrunnelse")
	})

	it("confirms the whole review with a single patch, recording actor and time", () => {
		const updated = applyGithubAccessStagedDataPatch(parsed(), confirm)
		expect(updated).toMatchObject({ confirmedBy: "Z990001", confirmedAt })
		expect(isGithubAccessReviewComplete(updated)).toBe(true)
		expect(isGithubAccessReviewComplete(parsed())).toBe(false)
	})

	it("overwrites confirmedBy/confirmedAt when reconfirming", () => {
		const first = applyGithubAccessStagedDataPatch(parsed(), confirm)
		const second = applyGithubAccessStagedDataPatch(first, {
			op: "confirm-review",
			confirmedBy: "Z990002",
			confirmedAt: "2026-09-03T10:00:00.000Z",
		})
		expect(second).toMatchObject({ confirmedBy: "Z990002", confirmedAt: "2026-09-03T10:00:00.000Z" })
	})

	it("clears confirmedBy/confirmedAt on unconfirm-review", () => {
		const confirmed = applyGithubAccessStagedDataPatch(parsed(), confirm)
		const updated = applyGithubAccessStagedDataPatch(confirmed, { op: "unconfirm-review" })
		expect(updated).toMatchObject({ confirmedBy: null, confirmedAt: null })
		expect(isGithubAccessReviewComplete(updated)).toBe(false)
	})

	it.each([removal, adjustment])("records $op without a justification", (patch) => {
		const updated = applyGithubAccessStagedDataPatch(parsed(), patch)
		if (patch.op === "mark-for-removal") {
			expect(updated.subjects[0]).toMatchObject({ removalMarkedBy: "Z990001", removalMarkedAt: markedAt })
		} else {
			expect(updated.subjects[0]).toMatchObject({
				targetPermission: "push",
				permissionAdjustmentMarkedBy: "Z990001",
				permissionAdjustmentMarkedAt: markedAt,
			})
		}
	})

	it.each([removal, adjustment])("rejects $op for a gone subject", (patch) => {
		const data = parseGithubAccessStagedData({ ...baseData, subjects: [{ ...subject, isGone: true }] })
		expect(() => applyGithubAccessStagedDataPatch(data, patch)).toThrow()
	})

	it.each([removal, adjustment])("keeps $op mutually exclusive with the other decision", (patch) => {
		let updated = applyGithubAccessStagedDataPatch(parsed(), removal)
		updated = applyGithubAccessStagedDataPatch(updated, adjustment)
		updated = applyGithubAccessStagedDataPatch(updated, patch)
		expect(updated.subjects[0]).toMatchObject({
			markedForRemoval: patch.op === "mark-for-removal",
			permissionAdjustmentRequested: patch.op === "mark-for-adjustment",
		})
	})

	it("requires a target permission for adjustment", () => {
		expect(() => applyGithubAccessStagedDataPatch(parsed(), { ...adjustment, targetPermission: "" })).toThrow()
	})

	it("rejects conflicting removal and adjustment decisions", () => {
		expect(() =>
			parseGithubAccessStagedData({
				...baseData,
				subjects: [
					{ ...subject, markedForRemoval: true, permissionAdjustmentRequested: true, targetPermission: "push" },
				],
			}),
		).toThrow()
	})

	it("rejects unknown subjects and duplicate usernames", () => {
		expect(() => applyGithubAccessStagedDataPatch(parsed(), { ...removal, username: "ukjent" })).toThrow()
		expect(() => parseGithubAccessStagedData({ ...baseData, subjects: [subject, subject] })).toThrow()
	})

	it.each(["2026-09-02T10:00:00.000Z", "2026-9-2", "not-a-date"])(
		"rejects non date-only removalMarkedAt/permissionAdjustmentMarkedAt: %j",
		(invalidDate) => {
			expect(() =>
				parseGithubAccessStagedData({
					...baseData,
					subjects: [{ ...subject, markedForRemoval: true, removalMarkedBy: "Z990001", removalMarkedAt: invalidDate }],
				}),
			).toThrow()
		},
	)

	it("accepts a date-only (YYYY-MM-DD) removalMarkedAt/permissionAdjustmentMarkedAt", () => {
		expect(() =>
			parseGithubAccessStagedData({
				...baseData,
				subjects: [{ ...subject, markedForRemoval: true, removalMarkedBy: "Z990001", removalMarkedAt: "2026-09-02" }],
			}),
		).not.toThrow()
	})
})
