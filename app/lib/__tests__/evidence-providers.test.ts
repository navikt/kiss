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

	it("returns null from getStatus and throws for other methods", async () => {
		const { NdaEvidenceProvider } = await import("../evidence-providers/nda.server")
		const provider = new NdaEvidenceProvider()

		expect(await provider.getStatus({})).toBeNull()
		await expect(provider.downloadFile({}, "item", "pdf")).rejects.toThrow("not yet implemented")
		await expect(provider.requestGeneration!({})).rejects.toThrow("not yet implemented")
		await expect(provider.getJobStatus!({}, "job-123")).rejects.toThrow("not yet implemented")
	})
})
