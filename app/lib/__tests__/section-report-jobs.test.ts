import { PassThrough } from "node:stream"
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
// Also exposes the last created archive instance for assertion
let lastArchiverInstance: { append: ReturnType<typeof vi.fn>; finalize: ReturnType<typeof vi.fn> } | null = null
vi.mock("archiver", () => {
	function makeSink() {
		const sink = new PassThrough() as PassThrough & {
			append: ReturnType<typeof vi.fn>
			finalize: ReturnType<typeof vi.fn>
			abort: ReturnType<typeof vi.fn>
		}
		// biome-ignore lint/suspicious/noExplicitAny: mock pipe overrides real type
		;(sink as any).pipe = (dest: NodeJS.WritableStream) => {
			// Immediately end the destination to simulate a finished archive
			setImmediate(() => dest.end())
			return dest
		}
		sink.append = vi.fn()
		sink.finalize = vi.fn()
		sink.abort = vi.fn()
		sink.on = vi.fn()
		lastArchiverInstance = sink
		return sink
	}
	return {
		ZipArchive: vi.fn().mockImplementation(makeSink),
	}
})

// DB mock — covers db.transaction (used for completion update + audit log)
const mockTxUpdate = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) }))
const mockDbTransaction = vi.fn(async (fn: (tx: unknown) => Promise<void>) => fn({ update: mockTxUpdate }))
vi.mock("~/db/connection.server", () => ({ db: { transaction: mockDbTransaction } }))

// writeAuditLog mock
const mockWriteAuditLog = vi.fn()
vi.mock("~/db/queries/audit.server", () => ({ writeAuditLog: mockWriteAuditLog }))

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
	allAttachments: [],
}

describe("startSectionBatchReport", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockCreateSectionBatchReport.mockResolvedValue({ id: "report-1", name: "Seksjonsrapport – Seksjon A – 31.5.2026" })
		mockCreateSyncJob.mockResolvedValue({ id: "job-1" })
		mockMarkSyncJobRunning.mockResolvedValue(undefined)
		mockMarkSyncJobCompleted.mockResolvedValue(undefined)
		mockMarkSyncJobFailed.mockResolvedValue(undefined)
		mockUpdateReportStatus.mockResolvedValue(undefined)
		mockUploadStream.mockResolvedValue({ sizeBytes: 1024 })
		mockBuildAppComplianceArtifact.mockResolvedValue(fakeArtifact)
		mockWriteAuditLog.mockResolvedValue(undefined)
		mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => fn({ update: mockTxUpdate }))
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
		// Wait for fire-and-forget background generation to complete
		await vi.waitFor(() => expect(mockMarkSyncJobCompleted).toHaveBeenCalled())

		expect(mockMarkSyncJobRunning).toHaveBeenCalledWith("job-1", "Z123456", expect.any(String))
		expect(mockMarkSyncJobFailed).not.toHaveBeenCalled()
	})

	it("marks report running then updates status on success", async () => {
		const { startSectionBatchReport } = await import("~/lib/section-report-jobs.server")
		await startSectionBatchReport(baseParams)
		await vi.waitFor(() => expect(mockDbTransaction).toHaveBeenCalled())

		expect(mockUpdateReportStatus).toHaveBeenCalledWith("report-1", "running", expect.any(String))
		// Final update is done directly via db.update (not via updateReportStatus)
	})

	it("completes with 0 included apps when buildAppComplianceArtifact throws for all apps", async () => {
		mockBuildAppComplianceArtifact.mockRejectedValue(new Error("PDF generation failed"))

		const { startSectionBatchReport } = await import("~/lib/section-report-jobs.server")
		await startSectionBatchReport({ ...baseParams, selectedAppIds: ["app-1"] })
		// Artifact failure is per-app — loop continues and job completes with 0 included apps
		await vi.waitFor(() => expect(mockMarkSyncJobCompleted).toHaveBeenCalled())

		expect(mockMarkSyncJobFailed).not.toHaveBeenCalled()
		expect(mockDbTransaction).toHaveBeenCalled()
	})

	it("marks failed when uploadStream rejects", async () => {
		mockUploadStream.mockRejectedValue(new Error("GCS unavailable"))

		const { startSectionBatchReport } = await import("~/lib/section-report-jobs.server")
		await startSectionBatchReport(baseParams)
		await vi.waitFor(() => expect(mockMarkSyncJobFailed).toHaveBeenCalled())

		expect(mockMarkSyncJobFailed).toHaveBeenCalledWith(
			"job-1",
			expect.stringContaining("GCS unavailable"),
			"Z123456",
			expect.any(String),
		)
		expect(mockUpdateReportStatus).toHaveBeenCalledWith(
			"report-1",
			"failed",
			"Rapportgenerering feilet. Kontakt administrator.",
		)
		expect(mockMarkSyncJobCompleted).not.toHaveBeenCalled()
	})

	it("does not mark report failed when markSyncJobCompleted persistence fails", async () => {
		mockMarkSyncJobCompleted.mockRejectedValue(new Error("DB error"))

		const { startSectionBatchReport } = await import("~/lib/section-report-jobs.server")
		await startSectionBatchReport(baseParams)
		// Report was already set to completed via db.update — markSyncJobFailed must NOT be called
		await vi.waitFor(() => expect(mockDbTransaction).toHaveBeenCalled())

		expect(mockMarkSyncJobFailed).not.toHaveBeenCalled()
	})

	it("marks report failed and rethrows when createSyncJob fails", async () => {
		mockCreateSyncJob.mockRejectedValue(new Error("sync job DB error"))

		const { startSectionBatchReport } = await import("~/lib/section-report-jobs.server")
		await expect(startSectionBatchReport(baseParams)).rejects.toThrow("sync job DB error")

		expect(mockUpdateReportStatus).toHaveBeenCalledWith("report-1", "failed", expect.any(String))
		expect(mockMarkSyncJobRunning).not.toHaveBeenCalled()
	})

	it("marks report and sync job failed when markSyncJobRunning fails", async () => {
		mockMarkSyncJobRunning.mockRejectedValue(new Error("running DB error"))

		const { startSectionBatchReport } = await import("~/lib/section-report-jobs.server")
		await startSectionBatchReport(baseParams)
		await vi.waitFor(() => expect(mockMarkSyncJobFailed).toHaveBeenCalled())

		expect(mockUpdateReportStatus).toHaveBeenCalledWith(
			"report-1",
			"failed",
			"Rapportgenerering feilet. Kontakt administrator.",
		)
	})

	it("appends allAttachments entries to the archive under the correct path", async () => {
		const attachmentData = Buffer.from("excel-content")
		const artifactWithAttachments = {
			appName: "Min App",
			pdf: Buffer.from("fake-pdf"),
			allAttachments: [
				{
					fileName: "oracle-snapshot.xlsx",
					contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
					data: attachmentData,
					reviewTitle: "Rutinegjennomgang Q1",
					reviewDate: "2026-01-15",
					followUpPointText: null,
					followUpKind: null,
				},
			],
		}
		mockBuildAppComplianceArtifact.mockResolvedValue(artifactWithAttachments)

		const { startSectionBatchReport } = await import("~/lib/section-report-jobs.server")
		await startSectionBatchReport({ ...baseParams, selectedAppIds: ["app-1"] })
		await vi.waitFor(() => expect(mockMarkSyncJobCompleted).toHaveBeenCalled())

		// The archive should have been called with the PDF and the attachment
		expect(lastArchiverInstance?.append).toHaveBeenCalledWith(
			artifactWithAttachments.pdf,
			expect.objectContaining({ name: expect.stringContaining("rapport.pdf") }),
		)
		expect(lastArchiverInstance?.append).toHaveBeenCalledWith(
			attachmentData,
			expect.objectContaining({ name: expect.stringContaining("oracle-snapshot.xlsx") }),
		)
	})

	it("sanitizes filenames and folders when adding allAttachments to the archive", async () => {
		const artifactWithUnsafeName = {
			appName: "Min App",
			pdf: Buffer.from("fake-pdf"),
			allAttachments: [
				{
					fileName: "../../../etc/passwd",
					contentType: "text/plain",
					data: Buffer.from("data"),
					reviewTitle: "Review/with<special>chars",
					reviewDate: "2026-01-15",
					followUpPointText: null,
					followUpKind: null,
				},
			],
		}
		mockBuildAppComplianceArtifact.mockResolvedValue(artifactWithUnsafeName)

		const { startSectionBatchReport } = await import("~/lib/section-report-jobs.server")
		await startSectionBatchReport({ ...baseParams, selectedAppIds: ["app-1"] })
		await vi.waitFor(() => expect(mockMarkSyncJobCompleted).toHaveBeenCalled())

		const appendCall = lastArchiverInstance?.append.mock.calls.find((c: unknown[]) =>
			String((c[1] as { name?: string })?.name).includes("passwd"),
		)
		expect(appendCall).toBeDefined()
		const entryName = String((appendCall?.[1] as { name?: string })?.name)
		// Must not contain path traversal sequences
		expect(entryName).not.toContain("../")
		expect(entryName).not.toContain("..\\")
		// Leading dots should be replaced
		expect(entryName).not.toMatch(/\/\.\./)
	})
})
