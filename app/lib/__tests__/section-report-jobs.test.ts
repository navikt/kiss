import { beforeEach, describe, expect, it, vi } from "vitest"
import { SYNC_JOB_TYPES } from "~/lib/sync-job-types"

// Sync-job query mocks
const mockCreateSyncJob = vi.fn()
const mockMarkSyncJobRunning = vi.fn()
const mockMarkSyncJobCompleted = vi.fn()
const mockMarkSyncJobFailed = vi.fn()
vi.mock("~/db/queries/sync-jobs.server", () => ({
	createSyncJob: mockCreateSyncJob,
	markSyncJobRunning: mockMarkSyncJobRunning,
	markSyncJobCompleted: mockMarkSyncJobCompleted,
	markSyncJobFailed: mockMarkSyncJobFailed,
}))

// Report query mocks
const mockCreateSectionBatchReport = vi.fn()
const mockUpdateReportStatus = vi.fn()
const mockBuildAppComplianceArtifact = vi.fn()
vi.mock("~/db/queries/reports.server", () => ({
	createSectionBatchReport: mockCreateSectionBatchReport,
	updateReportStatus: mockUpdateReportStatus,
	buildAppComplianceArtifact: mockBuildAppComplianceArtifact,
}))

// Storage mock — uploadStream returns immediately with a fake result
const mockUploadStream = vi.fn()
vi.mock("~/lib/storage/index.server", () => ({
	getStorageProvider: () => ({ uploadStream: mockUploadStream }),
}))

// Archiver mock — auto-finalizes the passThrough stream so uploadPromise resolves
vi.mock("archiver", () => {
	const { PassThrough } = require("node:stream")
	return {
		default: () => {
			const sink = new PassThrough()
			sink.pipe = (dest: NodeJS.WritableStream) => {
				// Immediately end the destination to simulate a finished archive
				setImmediate(() => dest.end())
				return dest
			}
			sink.append = vi.fn()
			sink.finalize = vi.fn()
			sink.abort = vi.fn()
			sink.on = vi.fn()
			return sink
		},
	}
})

// DB mock (only used for the final update in success path)
const mockDbUpdate = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) }))
vi.mock("~/db/connection.server", () => ({ db: { update: mockDbUpdate } }))

const baseParams = {
	sectionId: "section-1",
	sectionName: "Seksjon A",
	sectionSlug: "seksjon-a",
	selectedAppIds: ["app-1", "app-2"],
	includeReviews: false,
	includeAttachments: false,
	includeRoutineDescription: false,
	createdBy: "Z123456",
}

const fakeArtifact = {
	appName: "Min App",
	pdf: Buffer.from("fake-pdf"),
	nonPdfAttachments: [],
}

describe("startSectionBatchReport", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockCreateSectionBatchReport.mockResolvedValue("report-1")
		mockCreateSyncJob.mockResolvedValue({ id: "job-1" })
		mockMarkSyncJobRunning.mockResolvedValue(undefined)
		mockMarkSyncJobCompleted.mockResolvedValue(undefined)
		mockMarkSyncJobFailed.mockResolvedValue(undefined)
		mockUpdateReportStatus.mockResolvedValue(undefined)
		mockUploadStream.mockResolvedValue({ sizeBytes: 1024 })
		mockBuildAppComplianceArtifact.mockResolvedValue(fakeArtifact)
	})

	it("returns reportId and jobId immediately", async () => {
		const { startSectionBatchReport } = await import("~/lib/section-report-jobs.server")
		const result = await startSectionBatchReport(baseParams)
		expect(result).toEqual({ reportId: "report-1", jobId: "job-1" })
	})

	it("creates report and sync job with correct params", async () => {
		const { startSectionBatchReport } = await import("~/lib/section-report-jobs.server")
		await startSectionBatchReport(baseParams)

		expect(mockCreateSectionBatchReport).toHaveBeenCalledWith({
			sectionId: "section-1",
			sectionName: "Seksjon A",
			createdBy: "Z123456",
		})
		expect(mockCreateSyncJob).toHaveBeenCalledWith(
			expect.objectContaining({
				jobType: SYNC_JOB_TYPES.SECTION_BATCH_REPORT,
				performedBy: "Z123456",
				scopeType: "section",
				scopeId: "section-1",
			}),
		)
	})

	it("marks sync job running and completed on success", async () => {
		const { startSectionBatchReport } = await import("~/lib/section-report-jobs.server")
		await startSectionBatchReport(baseParams)
		// Allow background generation to complete
		await new Promise((r) => setTimeout(r, 50))

		expect(mockMarkSyncJobRunning).toHaveBeenCalledWith("job-1", "Z123456", expect.any(String))
		expect(mockMarkSyncJobCompleted).toHaveBeenCalled()
		expect(mockMarkSyncJobFailed).not.toHaveBeenCalled()
	})

	it("marks report running then updates status on success", async () => {
		const { startSectionBatchReport } = await import("~/lib/section-report-jobs.server")
		await startSectionBatchReport(baseParams)
		await new Promise((r) => setTimeout(r, 50))

		expect(mockUpdateReportStatus).toHaveBeenCalledWith("report-1", "running", expect.any(String))
		// Final update is done directly via db.update (not via updateReportStatus)
		expect(mockDbUpdate).toHaveBeenCalled()
	})

	it("completes with 0 included apps when buildAppComplianceArtifact throws for all apps", async () => {
		mockBuildAppComplianceArtifact.mockRejectedValue(new Error("PDF generation failed"))

		const { startSectionBatchReport } = await import("~/lib/section-report-jobs.server")
		await startSectionBatchReport({ ...baseParams, selectedAppIds: ["app-1"] })
		await new Promise((r) => setTimeout(r, 50))

		// Artifact failure is per-app — loop continues and job completes with 0 included apps
		expect(mockMarkSyncJobCompleted).toHaveBeenCalled()
		expect(mockMarkSyncJobFailed).not.toHaveBeenCalled()
		expect(mockDbUpdate).toHaveBeenCalled()
	})

	it("marks failed when uploadStream rejects", async () => {
		mockUploadStream.mockRejectedValue(new Error("GCS unavailable"))

		const { startSectionBatchReport } = await import("~/lib/section-report-jobs.server")
		await startSectionBatchReport(baseParams)
		await new Promise((r) => setTimeout(r, 50))

		expect(mockMarkSyncJobFailed).toHaveBeenCalledWith(
			"job-1",
			expect.stringContaining("GCS unavailable"),
			"Z123456",
			expect.any(String),
		)
		expect(mockUpdateReportStatus).toHaveBeenCalledWith(
			"report-1",
			"failed",
			expect.stringContaining("GCS unavailable"),
		)
		expect(mockMarkSyncJobCompleted).not.toHaveBeenCalled()
	})

	it("does not mark report failed when markSyncJobCompleted persistence fails", async () => {
		mockMarkSyncJobCompleted.mockRejectedValue(new Error("DB error"))

		const { startSectionBatchReport } = await import("~/lib/section-report-jobs.server")
		await startSectionBatchReport(baseParams)
		await new Promise((r) => setTimeout(r, 50))

		// Report was already set to completed via db.update — markSyncJobFailed must NOT be called
		expect(mockDbUpdate).toHaveBeenCalled()
		expect(mockMarkSyncJobFailed).not.toHaveBeenCalled()
	})
})
