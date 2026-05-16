import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Mock azure.server.ts to avoid real token exchange
vi.mock("~/lib/azure.server", () => ({
	getClientCredentialToken: vi.fn().mockResolvedValue("mock-token"),
}))

// Mock logger
vi.mock("~/lib/logger.server", () => ({
	logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

describe("nda-audit-reports API client", () => {
	describe("with NDA_AUDIT_REPORTS_BASE_URL set", () => {
		const originalEnv = { ...process.env }

		beforeEach(() => {
			process.env.NDA_AUDIT_REPORTS_BASE_URL = "https://nda.example.com"
			process.env.NDA_AUDIT_REPORTS_SCOPE = "api://nda/.default"
			vi.resetModules()
		})

		afterEach(() => {
			process.env = { ...originalEnv }
			vi.restoreAllMocks()
		})

		it("getNdaAuditStatus calls correct URL with params", async () => {
			const mockResponse = {
				app: { team: "pensjon", environment: "prod-gcp", name: "my-app", auditStartDate: null, applicationGroup: null },
				period: { type: "yearly", label: "2025", start: "2025-01-01", end: "2025-12-31" },
				deployments: {
					total: 42,
					approved: 40,
					pending: 1,
					notApproved: 1,
					approvedPercent: 95.2,
					withChangeOrigin: 35,
					changeOriginPercent: 83.3,
				},
				existingReports: [],
				availableFormats: ["pdf"],
			}

			const fetchSpy = vi
				.spyOn(globalThis, "fetch")
				.mockResolvedValue(new Response(JSON.stringify(mockResponse), { status: 200 }))

			const { getNdaAuditStatus } = await import("../nda-audit-reports.server")
			const result = await getNdaAuditStatus("pensjon", "prod-gcp", "my-app", "yearly", "2025-01-01")

			expect(fetchSpy).toHaveBeenCalledOnce()
			const calledUrl = fetchSpy.mock.calls[0][0] as string
			expect(calledUrl).toContain("/api/v1/apps/pensjon/prod-gcp/my-app/audit-reports/status")
			expect(calledUrl).toContain("periodType=yearly")
			expect(calledUrl).toContain("periodStart=2025-01-01")
			expect(result.deployments.total).toBe(42)
		})

		it("generateNdaAuditReport sends POST with JSON body", async () => {
			const mockResponse = {
				app: { team: "pensjon", environment: "prod-gcp", name: "my-app", auditStartDate: null, applicationGroup: null },
				jobId: "job-123",
				status: "pending",
				reportId: null,
				message: "Report generation started",
			}

			const fetchSpy = vi
				.spyOn(globalThis, "fetch")
				.mockResolvedValue(new Response(JSON.stringify(mockResponse), { status: 202 }))

			const { generateNdaAuditReport } = await import("../nda-audit-reports.server")
			const result = await generateNdaAuditReport("pensjon", "prod-gcp", "my-app", "yearly", "2025-01-01")

			expect(fetchSpy).toHaveBeenCalledOnce()
			const [, options] = fetchSpy.mock.calls[0]
			expect(options?.method).toBe("POST")
			const body = JSON.parse(options?.body as string) as Record<string, string>
			expect(body.periodType).toBe("yearly")
			expect(body.periodStart).toBe("2025-01-01")
			expect(result.jobId).toBe("job-123")
		})

		it("generateNdaAuditReport throws NdaConflictError on 409", async () => {
			vi.spyOn(globalThis, "fetch").mockResolvedValue(
				new Response(JSON.stringify({ error: "Report already exists" }), { status: 409 }),
			)

			const { generateNdaAuditReport, NdaConflictError } = await import("../nda-audit-reports.server")

			await expect(generateNdaAuditReport("pensjon", "prod-gcp", "my-app", "yearly", "2025-01-01")).rejects.toThrow(
				NdaConflictError,
			)
		})

		it("getNdaAuditJobStatus parses Retry-After header", async () => {
			const mockResponse = {
				app: { team: "pensjon", environment: "prod-gcp", name: "my-app", auditStartDate: null, applicationGroup: null },
				jobId: "job-123",
				status: "processing",
				createdAt: "2025-06-01T12:00:00Z",
				completedAt: null,
				error: null,
				reportId: null,
				report: null,
			}

			vi.spyOn(globalThis, "fetch").mockResolvedValue(
				new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { "Retry-After": "10" },
				}),
			)

			const { getNdaAuditJobStatus } = await import("../nda-audit-reports.server")
			const result = await getNdaAuditJobStatus("pensjon", "prod-gcp", "my-app", "job-123")

			expect(result.retryAfterSeconds).toBe(10)
			expect(result.status).toBe("processing")
		})

		it("downloadNdaAuditReport returns buffer and metadata", async () => {
			const pdfContent = "%PDF-1.4 test content"
			vi.spyOn(globalThis, "fetch").mockResolvedValue(
				new Response(pdfContent, {
					status: 200,
					headers: {
						"Content-Type": "application/pdf",
						"Content-Disposition": 'attachment; filename="AUDIT-2025-my-app.pdf"',
					},
				}),
			)

			const { downloadNdaAuditReport } = await import("../nda-audit-reports.server")
			const result = await downloadNdaAuditReport("pensjon", "prod-gcp", "my-app", "AUDIT-2025-my-app")

			expect(result.contentType).toBe("application/pdf")
			expect(result.fileName).toBe("AUDIT-2025-my-app.pdf")
			expect(result.buffer.toString()).toBe(pdfContent)
		})

		it("listNdaAuditReports calls base endpoint without trailing slash", async () => {
			const mockResponse = {
				app: { team: "pensjon", environment: "prod-gcp", name: "my-app", auditStartDate: null, applicationGroup: null },
				reports: [],
			}
			const fetchSpy = vi
				.spyOn(globalThis, "fetch")
				.mockResolvedValue(new Response(JSON.stringify(mockResponse), { status: 200 }))

			const { listNdaAuditReports } = await import("../nda-audit-reports.server")
			await listNdaAuditReports("pensjon", "prod-gcp", "my-app")

			expect(fetchSpy).toHaveBeenCalledOnce()
			const calledUrl = fetchSpy.mock.calls[0][0] as string
			expect(calledUrl).toContain("/api/v1/apps/pensjon/prod-gcp/my-app/audit-reports")
			expect(calledUrl).not.toContain("/audit-reports/")
		})

		it("downloadNdaAuditReport forwards requested format", async () => {
			const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
				new Response("%PDF-1.4 test content", {
					status: 200,
					headers: {
						"Content-Type": "application/pdf",
						"Content-Disposition": 'attachment; filename="AUDIT-2025-my-app.xlsx"',
					},
				}),
			)
			const { downloadNdaAuditReport } = await import("../nda-audit-reports.server")

			await downloadNdaAuditReport("pensjon", "prod-gcp", "my-app", "AUDIT-2025", "excel")

			expect(fetchSpy).toHaveBeenCalledOnce()
			const calledUrl = fetchSpy.mock.calls[0][0] as string
			expect(calledUrl).toContain("/download?format=excel")
		})

		it("handleErrorResponse throws with error message from JSON", async () => {
			vi.spyOn(globalThis, "fetch").mockResolvedValue(
				new Response(JSON.stringify({ error: "Invalid period" }), { status: 400 }),
			)

			const { getNdaAuditStatus } = await import("../nda-audit-reports.server")

			await expect(getNdaAuditStatus("pensjon", "prod-gcp", "my-app", "yearly", "2025-01-01")).rejects.toThrow("400")
		})
	})

	describe("dev mode (no BASE_URL)", () => {
		const originalEnv = { ...process.env }

		beforeEach(() => {
			delete process.env.NDA_AUDIT_REPORTS_BASE_URL
			delete process.env.NDA_AUDIT_REPORTS_SCOPE
			delete process.env.DEPLOYMENT_AUDIT_BASE_URL
			delete process.env.DEPLOYMENT_AUDIT_SCOPE
			vi.resetModules()
		})

		afterEach(() => {
			process.env = { ...originalEnv }
		})

		it("getNdaAuditStatus returns mock data", async () => {
			const { getNdaAuditStatus } = await import("../nda-audit-reports.server")
			const result = await getNdaAuditStatus("pensjon", "prod-gcp", "my-app", "yearly", "2025-01-01")

			expect(result.app.team).toBe("pensjon")
			expect(result.deployments.total).toBeGreaterThan(0)
			expect(result.period.type).toBe("yearly")
		})

		it("generateNdaAuditReport returns mock job", async () => {
			const { generateNdaAuditReport } = await import("../nda-audit-reports.server")
			const result = await generateNdaAuditReport("pensjon", "prod-gcp", "my-app", "yearly", "2025-01-01")

			expect(result.jobId).toContain("mock-job-")
			expect(result.status).toBe("pending")
		})

		it("getNdaAuditJobStatus returns mock completed job", async () => {
			const { getNdaAuditJobStatus } = await import("../nda-audit-reports.server")
			const result = await getNdaAuditJobStatus("pensjon", "prod-gcp", "my-app", "job-123")

			expect(result.status).toBe("completed")
			expect(result.reportId).toContain("mock")
		})

		it("downloadNdaAuditReport returns mock PDF", async () => {
			const { downloadNdaAuditReport } = await import("../nda-audit-reports.server")
			const result = await downloadNdaAuditReport("pensjon", "prod-gcp", "my-app", "AUDIT-2025")

			expect(result.contentType).toBe("application/pdf")
			expect(result.buffer.toString()).toContain("mock audit report")
		})

		it("listNdaAuditReports returns empty mock", async () => {
			const { listNdaAuditReports } = await import("../nda-audit-reports.server")
			const result = await listNdaAuditReports("pensjon", "prod-gcp", "my-app")

			expect(result.reports).toEqual([])
			expect(result.app.team).toBe("pensjon")
		})
	})
})

describe("PERIOD_TYPES constant", () => {
	it("contains all four period types", async () => {
		const { PERIOD_TYPES } = await import("../nda-audit-reports.server")
		expect(PERIOD_TYPES).toEqual(["yearly", "tertiary", "quarterly", "monthly"])
	})
})

describe("NdaConflictError", () => {
	it("has correct name", async () => {
		const { NdaConflictError } = await import("../nda-audit-reports.server")
		const error = new NdaConflictError("test")
		expect(error.name).toBe("NdaConflictError")
		expect(error.message).toBe("test")
		expect(error).toBeInstanceOf(Error)
	})
})
