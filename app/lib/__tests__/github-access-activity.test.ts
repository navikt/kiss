import { beforeEach, describe, expect, it, vi } from "vitest"
import { applyGithubAccessStagedDataPatch, parseGithubAccessStagedData } from "~/lib/github-access-staged-data"

const mocks = vi.hoisted(() => ({
	select: vi.fn(),
	execute: vi.fn(),
	updateValues: vi.fn(),
	insertValues: vi.fn(),
	audit: vi.fn(),
	followUp: vi.fn(),
}))
vi.mock("~/db/connection.server", () => {
	const executor = {
		select: mocks.select,
		execute: mocks.execute,
		update: () => ({
			set: (values: unknown) => {
				mocks.updateValues(values)
				return {
					where: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([{ id: "assessment-1" }]),
					}),
				}
			},
		}),
		insert: () => ({
			values: (values: unknown) => {
				mocks.insertValues(values)
				return {
					onConflictDoUpdate: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([{ id: "assessment-1" }]),
					}),
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

const now = new Date()
now.setMilliseconds(0)
const timestamp = now.toISOString()
const markedAt = timestamp.slice(0, 10)
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
		leftJoin: () => query,
		where: () => query,
		limit: () => query,
		for: () => query,
	})
	return query
}

describe("github access activity", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.select.mockReset()
		mocks.select.mockReturnValue(selectResult([]))
		mocks.execute.mockReset()
		mocks.execute.mockResolvedValue({
			rows: [{ lastSuccessfulSyncAt: timestamp, teams: [], members: [], collaborators: [] }],
		})
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
		mocks.select.mockReturnValueOnce(
			selectResult([{ status: "pending", stagedData: latestStagedData, reviewId: "review-1" }]),
		)
		mocks.select.mockReturnValueOnce(selectResult([{ status: "draft" }]))
	}

	it("applies mark-for-removal with a date-only markedAt without writing an audit entry", async () => {
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
		expect(mocks.audit).not.toHaveBeenCalled()
	})

	it("persists confirm-review without writing an audit entry (final state carries confirmedBy/At)", async () => {
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
		expect(mocks.audit).not.toHaveBeenCalled()
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

	it("builds staged data from the live synced GitHub access", async () => {
		mocks.execute.mockResolvedValueOnce({
			rows: [
				{
					gitRepository: "navikt/kiss",
					syncedGitRepository: "navikt/kiss",
					lastSuccessfulSyncAt: timestamp,
					teams: [],
					members: [],
					collaborators: [
						{ username: "glad-fjord", permission: "admin", syncedAt: timestamp },
						{ username: "ny-bruker", permission: "pull", syncedAt: timestamp },
					],
				},
			],
		})
		const stagedData = await buildGithubAccessSeedResult("app-1")

		expect(stagedData.subjects.find((s) => s.username === "glad-fjord")?.highestPermission).toBe("admin")
		expect(stagedData.subjects.find((s) => s.username === "ny-bruker")?.highestPermission).toBe("pull")
	})

	it("falls back to the recorded sync timestamp when a successful sync has no access rows", async () => {
		mocks.execute.mockResolvedValueOnce({
			rows: [
				{
					gitRepository: "navikt/kiss",
					syncedGitRepository: "navikt/kiss",
					lastSuccessfulSyncAt: timestamp,
					teams: [],
					members: [],
					collaborators: [],
				},
			],
		})
		const stagedData = await buildGithubAccessSeedResult("app-1")
		expect(stagedData.dataSyncedAt).toBe(timestamp)
	})

	it("normalizes a raw Postgres sync timestamp to ISO before validating staged data", async () => {
		const postgresTimestamp = `${timestamp.slice(0, 19).replace("T", " ")}+00`
		mocks.execute.mockResolvedValueOnce({
			rows: [
				{
					gitRepository: "navikt/kiss",
					syncedGitRepository: "navikt/kiss",
					lastSuccessfulSyncAt: postgresTimestamp,
					teams: [],
					members: [],
					collaborators: [],
				},
			],
		})
		const stagedData = await buildGithubAccessSeedResult("app-1")
		expect(stagedData.dataSyncedAt).toBe(timestamp)
	})

	it("rejects seeding when the synced repo no longer matches the resolved repo", async () => {
		mocks.execute.mockResolvedValueOnce({
			rows: [
				{
					gitRepository: "navikt/kiss",
					syncedGitRepository: "navikt/old-repo",
					lastSuccessfulSyncAt: timestamp,
					teams: [],
					members: [],
					collaborators: [],
				},
			],
		})
		await expect(buildGithubAccessSeedResult("app-1")).rejects.toMatchObject({ status: 400 })
	})

	it("rejects seeding when the repo has never been successfully synced", async () => {
		mocks.execute.mockResolvedValueOnce({
			rows: [
				{
					gitRepository: "navikt/kiss",
					syncedGitRepository: "navikt/kiss",
					lastSuccessfulSyncAt: null,
					teams: [],
					members: [],
					collaborators: [],
				},
			],
		})
		await expect(buildGithubAccessSeedResult("app-1")).rejects.toMatchObject({ status: 400 })
	})

	it("rejects seeding when the last successful sync is older than the freshness window", async () => {
		const staleTimestamp = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
		mocks.execute.mockResolvedValueOnce({
			rows: [
				{
					gitRepository: "navikt/kiss",
					syncedGitRepository: "navikt/kiss",
					lastSuccessfulSyncAt: staleTimestamp,
					teams: [],
					members: [],
					collaborators: [],
				},
			],
		})
		await expect(buildGithubAccessSeedResult("app-1")).rejects.toMatchObject({ status: 400 })
	})

	it("rejects commit when the review is no longer in draft status", async () => {
		mocks.select.mockReturnValueOnce(
			selectResult([
				{
					reviewId: "review-1",
					status: "pending",
					stagedData: rawData,
					applicationId: "app-1",
					reviewStatus: "discarded",
				},
			]),
		)
		await expect(commitGithubAccessActivity("activity-1", "review-1", "Z990001", db)).rejects.toMatchObject({
			status: 409,
		})
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
			selectResult([
				{ reviewId: "review-1", status: "pending", stagedData: data, applicationId: "app-1", reviewStatus: "draft" },
			]),
		)
		mocks.select.mockReturnValueOnce(selectResult([]))
		await commitGithubAccessActivity("activity-1", "review-1", "Z990001", db)
		expect(mocks.followUp).toHaveBeenCalledTimes(2)
		expect(mocks.followUp.mock.calls[0][1]).toMatchObject({ text: "Fjern GitHub-tilgang for @glad-fjord" })
		expect(mocks.followUp.mock.calls[1][1]).toMatchObject({
			text: 'Juster GitHub-tilgang for @rask-elv fra "admin" til "push"',
			description: expect.stringContaining('fra "admin" til "push"'),
		})
	})

	it("rejects commit when the review has not been confirmed", async () => {
		mocks.select.mockReturnValueOnce(
			selectResult([
				{ reviewId: "review-1", status: "pending", stagedData: rawData, applicationId: "app-1", reviewStatus: "draft" },
			]),
		)
		await expect(commitGithubAccessActivity("activity-1", "review-1", "Z990001", db)).rejects.toMatchObject({
			status: 400,
		})
	})
})
