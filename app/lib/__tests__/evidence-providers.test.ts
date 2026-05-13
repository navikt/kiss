import { describe, expect, it } from "vitest"
import type { EvidenceProvider, EvidenceStatusResponse } from "../evidence-providers/types"

describe("Evidence provider factory", () => {
	it("returns Oracle provider for 'oracle' type", async () => {
		const { getEvidenceProvider } = await import("../evidence-providers/index.server")
		const provider = await getEvidenceProvider("oracle")
		expect(provider.type).toBe("oracle")
	})

	it("returns NDA provider for 'deployments' type", async () => {
		const { getEvidenceProvider } = await import("../evidence-providers/index.server")
		const provider = await getEvidenceProvider("deployments")
		expect(provider.type).toBe("deployments")
	})

	it("throws for unknown provider type", async () => {
		const { getEvidenceProvider } = await import("../evidence-providers/index.server")
		await expect(getEvidenceProvider("unknown" as "oracle")).rejects.toThrow("Unknown evidence provider type")
	})

	it("isEvidenceProviderType validates known types", async () => {
		const { isEvidenceProviderType } = await import("../evidence-providers/index.server")
		expect(isEvidenceProviderType("oracle")).toBe(true)
		expect(isEvidenceProviderType("deployments")).toBe(true)
		expect(isEvidenceProviderType("unknown")).toBe(false)
		expect(isEvidenceProviderType("")).toBe(false)
	})

	it("getRegisteredProviderTypes returns all providers", async () => {
		const { getRegisteredProviderTypes } = await import("../evidence-providers/index.server")
		const types = await getRegisteredProviderTypes()
		expect(types).toContain("oracle")
		expect(types).toContain("deployments")
		expect(types).toHaveLength(2)
	})
})

describe("Oracle provider", () => {
	it("implements EvidenceProvider interface with type 'oracle'", async () => {
		const { OracleEvidenceProvider } = await import("../evidence-providers/oracle.server")
		const provider: EvidenceProvider = new OracleEvidenceProvider()
		expect(provider.type).toBe("oracle")
		expect(typeof provider.getStatus).toBe("function")
		expect(typeof provider.downloadFile).toBe("function")
		expect(provider.requestGeneration).toBeUndefined()
		expect(provider.getJobStatus).toBeUndefined()
	})

	it("throws if instanceId is missing from params", async () => {
		const { OracleEvidenceProvider } = await import("../evidence-providers/oracle.server")
		const provider = new OracleEvidenceProvider()
		await expect(provider.getStatus({})).rejects.toThrow("instanceId")
	})

	it("maps Oracle status values to normalized statuses", async () => {
		// Must mock before importing the provider (static import of ORACLE_EVIDENCE_TYPES)
		const { vi } = await import("vitest")
		const actual = await vi.importActual<typeof import("~/lib/oracle-revisjon.server")>("~/lib/oracle-revisjon.server")
		vi.doMock("~/lib/oracle-revisjon.server", () => ({
			...actual,
			getEvidenceStatus: vi.fn().mockResolvedValue({
				instanceId: "pen",
				instanceName: "PESYS Prod",
				collectedAt: "2026-01-01T00:00:00Z",
				reviewUrl: "https://example.com/review",
				evidenceTypes: [
					{
						type: "audit",
						title: "Audit",
						status: "OK",
						formats: ["EXCEL", "PDF"],
						available: true,
						error: null,
						review: null,
					},
					{
						type: "profiles",
						title: "Profiles",
						status: "PARTIAL",
						formats: ["EXCEL"],
						available: true,
						error: null,
						review: null,
					},
					{
						type: "roles",
						title: "Roles",
						status: "FAILED",
						formats: [],
						available: false,
						error: "Timeout",
						review: null,
					},
				],
			}),
		}))

		// Re-import to pick up mock
		vi.resetModules()
		const { OracleEvidenceProvider: FreshProvider } = await import("../evidence-providers/oracle.server")
		const freshProvider = new FreshProvider()

		const status = (await freshProvider.getStatus({ instanceId: "pen" })) as EvidenceStatusResponse
		expect(status).not.toBeNull()
		expect(status.providerType).toBe("oracle")
		expect(status.sourceLabel).toBe("PESYS Prod")
		expect(status.collectedAt).toBe("2026-01-01T00:00:00Z")
		expect(status.externalUrl).toBe("https://example.com/review")
		expect(status.items).toHaveLength(3)
		expect(status.items[0].status).toBe("ok")
		expect(status.items[0].formats).toEqual(["excel", "pdf"])
		expect(status.items[1].status).toBe("partial")
		expect(status.items[1].formats).toEqual(["excel"])
		expect(status.items[2].status).toBe("failed")
		expect(status.items[2].error).toBe("Timeout")
		expect(status.items[2].canDownload).toBe(false)

		vi.restoreAllMocks()
	})
})

describe("NDA provider", () => {
	it("implements EvidenceProvider interface with type 'deployments'", async () => {
		const { NdaEvidenceProvider } = await import("../evidence-providers/nda.server")
		const provider: EvidenceProvider = new NdaEvidenceProvider()
		expect(provider.type).toBe("deployments")
		expect(typeof provider.getStatus).toBe("function")
		expect(typeof provider.downloadFile).toBe("function")
		expect(typeof provider.requestGeneration).toBe("function")
		expect(typeof provider.getJobStatus).toBe("function")
	})

	it("requires all NDA params for getStatus", async () => {
		const { NdaEvidenceProvider } = await import("../evidence-providers/nda.server")
		const provider = new NdaEvidenceProvider()

		await expect(provider.getStatus({})).rejects.toThrow("'team'")
		await expect(provider.getStatus({ team: "t" })).rejects.toThrow("'environment'")
		await expect(provider.getStatus({ team: "t", environment: "e" })).rejects.toThrow("'appName'")
		await expect(provider.getStatus({ team: "t", environment: "e", appName: "a" })).rejects.toThrow("'periodType'")
		await expect(
			provider.getStatus({ team: "t", environment: "e", appName: "a", periodType: "yearly" }),
		).rejects.toThrow("'periodStart'")
	})

	it("requires a specific reportId for downloadFile", async () => {
		const { NdaEvidenceProvider } = await import("../evidence-providers/nda.server")
		const provider = new NdaEvidenceProvider()

		const validParams = {
			team: "t",
			environment: "prod-gcp",
			appName: "a",
			periodType: "yearly",
			periodStart: "2025-01-01",
		}
		await expect(provider.downloadFile(validParams, "deployment_evidence_report", "pdf")).rejects.toThrow(
			"specific reportId",
		)
	})

	it("returns degraded response when NDA API is unavailable", async () => {
		const { vi } = await import("vitest")

		vi.doMock("~/lib/nda-audit-reports.server", () => ({
			getNdaAuditStatus: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
			listNdaAuditReports: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
		}))

		vi.doMock("~/lib/logger.server", () => ({
			logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
		}))

		vi.resetModules()
		const { NdaEvidenceProvider: FreshProvider } = await import("../evidence-providers/nda.server")
		const provider = new FreshProvider()

		const result = await provider.getStatus({
			team: "pensjon",
			environment: "prod-gcp",
			appName: "my-app",
			periodType: "yearly",
			periodStart: "2025-01-01",
		})

		expect(result).not.toBeNull()
		expect(result?.providerType).toBe("deployments")
		expect(result?.items).toEqual([])
		expect(result?.metadata.error).toBe("Leveranserapport-tjenesten er ikke tilgjengelig. Prøv igjen senere.")
		expect(result?.metadata).not.toHaveProperty("errorDetail")
		expect(result?.sourceLabel).toBe("pensjon/my-app (prod-gcp)")

		vi.restoreAllMocks()
	})
})
