import { beforeEach, describe, expect, it, vi } from "vitest"
import { applyGithubAccessStagedDataPatch, parseGithubAccessStagedData } from "~/lib/github-access-staged-data"

const mocks = vi.hoisted(() => ({
	select: vi.fn(),
	updateValues: vi.fn(),
	insertValues: vi.fn(),
	audit: vi.fn(),
	followUp: vi.fn(),
}))
vi.mock("~/db/connection.server", () => {
	const executor = {
		select: mocks.select,
		update: () => ({
			set: (values: unknown) => {
				mocks.updateValues(values)
				return { where: vi.fn().mockResolvedValue(undefined) }
			},
		}),
		insert: () => ({
			values: (values: unknown) => {
				mocks.insertValues(values)
				return {
					onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
					returning: vi.fn().mockResolvedValue([{ id: "attachment-1", fileName: "evidence.pdf" }]),
				}
			},
		}),
	}
	return { db: { ...executor, transaction: async (callback: (tx: unknown) => unknown) => callback(executor) } }
})
vi.mock("~/db/queries/audit.server", () => ({ writeAuditLog: mocks.audit }))
vi.mock("~/db/queries/routines.server", () => ({ addFollowUpPointRow: mocks.followUp }))
vi.mock("~/db/queries/users.server", () => ({ getUserNamesByNavIdents: async () => new Map() }))
vi.mock("~/lib/lock.server", () => ({
	withAdvisoryLock: async (_name: string, callback: () => unknown) => callback(),
}))
vi.mock("~/lib/github-access-pdf.server", () => ({ buildGithubAccessReviewPdf: async () => Buffer.from("PDF") }))
vi.mock("~/lib/nda-github-users.server", () => ({ lookupGitHubUsers: async () => new Map() }))
vi.mock("~/lib/logger.server", () => ({ logger: { warn: vi.fn() } }))
vi.mock("~/lib/storage/index.server", () => ({
	getStorageProvider: () => ({
		upload: async () => ({ path: "evidence.pdf", contentType: "application/pdf", sizeBytes: 3 }),
		delete: vi.fn(),
	}),
}))

import { db } from "~/db/connection.server"
import {
	buildGithubAccessSeedResult,
	commitGithubAccessActivity,
	patchGithubAccessActivity,
} from "~/db/queries/github-access-activity.server"

const timestamp = "2026-09-02T00:00:00.000Z"
const markedAt = "2026-09-02"
const rawData = {
	activityType: "github_access_maintenance",
	schemaVersion: 1,
	seededAt: timestamp,
	dataSyncedAt: timestamp,
	gitRepository: "navikt/kiss",
	subjects: [
		{
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
		},
	],
	confirmedBy: null,
	confirmedAt: null,
}

function selectResult(rows: unknown[]) {
	const query = Object.assign(Promise.resolve(rows), {
		from: () => query,
		innerJoin: () => query,
		where: () => query,
		limit: () => query,
	})
	return query
}

describe("github access activity", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.select.mockReset()
	})

	function mockPatchData(stagedData: unknown, latestStagedData = stagedData) {
		mocks.select.mockReturnValueOnce(
			selectResult([
				{
					type: "github_access_maintenance",
					status: "pending",
					stagedData,
					reviewStatus: "draft",
					applicationId: "app-1",
				},
			]),
		)
		mocks.select.mockReturnValueOnce(selectResult([{ status: "pending", stagedData: latestStagedData }]))
	}

	it("applies mark-for-removal with a date-only markedAt and audits the change", async () => {
		mockPatchData(rawData)
		await patchGithubAccessActivity(
			"activity-1",
			{ op: "mark-for-removal", username: "glad-fjord", markedBy: "Z990001", markedAt },
			"Z990001",
		)
		expect(mocks.updateValues.mock.calls[0][0].stagedData.subjects[0]).toMatchObject({
			markedForRemoval: true,
			removalMarkedBy: "Z990001",
			removalMarkedAt: markedAt,
		})
		expect(mocks.audit).toHaveBeenCalledTimes(1)
	})

	it("persists confirm-review with no username in the audit newValue", async () => {
		mockPatchData(rawData)
		await patchGithubAccessActivity(
			"activity-1",
			{ op: "confirm-review", confirmedBy: "Z990001", confirmedAt: timestamp },
			"Z990001",
		)
		expect(mocks.updateValues.mock.calls[0][0].stagedData).toMatchObject({
			confirmedBy: "Z990001",
			confirmedAt: timestamp,
		})
		const [entry] = mocks.audit.mock.calls[0]
		expect(entry.newValue).toContain('"confirmedBy":"Z990001"')
		expect(entry.metadata).not.toHaveProperty("username")
	})

	it("rejects unknown subjects", async () => {
		mockPatchData(rawData)
		await expect(
			patchGithubAccessActivity(
				"activity-1",
				{ op: "mark-for-removal", username: "ukjent", markedBy: "Z990001", markedAt },
				"Z990001",
			),
		).rejects.toMatchObject({ status: 400 })
		expect(mocks.updateValues).not.toHaveBeenCalled()
		expect(mocks.audit).not.toHaveBeenCalled()
	})

	it("seeds subjects without any legacy justification fields", async () => {
		for (const rows of [
			[{ gitRepository: "navikt/kiss" }],
			[],
			[],
			[{ username: "glad-fjord", permission: "admin", syncedAt: new Date(timestamp) }],
			[{ username: "glad-fjord", lastKnownPermission: "admin" }],
		]) {
			mocks.select.mockReturnValueOnce(selectResult(rows))
		}
		const { stagedData } = await buildGithubAccessSeedResult("app-1")
		expect(stagedData).toMatchObject({ confirmedBy: null, confirmedAt: null })
		expect(stagedData.subjects[0]).not.toHaveProperty("businessJustification")
		expect(stagedData.subjects[0]).not.toHaveProperty("reviewedThisRound")
	})

	it("creates follow-ups for decisions without reasons or live GitHub verification", async () => {
		let data = parseGithubAccessStagedData({
			...rawData,
			subjects: [rawData.subjects[0], { ...rawData.subjects[0], username: "rask-elv" }],
			confirmedBy: "Z990001",
			confirmedAt: timestamp,
		})
		data = applyGithubAccessStagedDataPatch(data, {
			op: "mark-for-removal",
			username: "glad-fjord",
			markedBy: "Z990001",
			markedAt,
		})
		data = applyGithubAccessStagedDataPatch(data, {
			op: "mark-for-adjustment",
			username: "rask-elv",
			targetPermission: "push",
			markedBy: "Z990001",
			markedAt,
		})
		mocks.select.mockReturnValueOnce(
			selectResult([{ reviewId: "review-1", status: "pending", stagedData: data, applicationId: "app-1" }]),
		)
		mocks.select.mockReturnValueOnce(selectResult([]))
		const snapshot = await commitGithubAccessActivity("activity-1", "review-1", "Z990001", db)
		expect(mocks.followUp).toHaveBeenCalledTimes(2)
		expect(mocks.followUp.mock.calls[0][1]).toMatchObject({ text: "Fjern GitHub-tilgang for @glad-fjord" })
		expect(mocks.followUp.mock.calls[1][1]).toMatchObject({
			text: 'Juster GitHub-tilgang for @rask-elv fra "admin" til "push"',
			description: null,
		})
		expect(snapshot.subjects.every((s) => !("businessJustification" in s))).toBe(true)
	})

	it("rejects commit when the review has not been confirmed", async () => {
		mocks.select.mockReturnValueOnce(
			selectResult([{ reviewId: "review-1", status: "pending", stagedData: rawData, applicationId: "app-1" }]),
		)
		await expect(commitGithubAccessActivity("activity-1", "review-1", "Z990001", db)).rejects.toMatchObject({
			status: 400,
		})
	})

	it("upserts only username + lastKnownPermission (+ audit columns) for non-gone subjects on commit", async () => {
		const data = parseGithubAccessStagedData({
			...rawData,
			subjects: [rawData.subjects[0], { ...rawData.subjects[0], username: "rask-elv", isGone: true }],
			confirmedBy: "Z990001",
			confirmedAt: timestamp,
		})
		mocks.select.mockReturnValueOnce(
			selectResult([{ reviewId: "review-1", status: "pending", stagedData: data, applicationId: "app-1" }]),
		)
		mocks.select.mockReturnValueOnce(selectResult([]))
		await commitGithubAccessActivity("activity-1", "review-1", "Z990001", db)
		const assessmentInserts = mocks.insertValues.mock.calls
			.map(([values]) => values)
			.filter((v) => v && typeof v === "object" && "username" in v)
		expect(assessmentInserts).toHaveLength(1)
		expect(assessmentInserts[0]).toMatchObject({ username: "glad-fjord", lastKnownPermission: "admin" })
		expect(assessmentInserts[0]).not.toHaveProperty("businessJustification")
		expect(assessmentInserts[0]).not.toHaveProperty("segregationCompliant")
		expect(assessmentInserts[0]).not.toHaveProperty("compensatingControls")
	})
})
