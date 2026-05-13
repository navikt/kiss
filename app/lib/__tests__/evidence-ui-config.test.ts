import { describe, expect, it } from "vitest"
import { getProviderUiConfig } from "../evidence-providers/ui-config"

describe("getProviderUiConfig", () => {
	describe("oracle config", () => {
		const config = getProviderUiConfig("oracle")

		it("returns correct heading", () => {
			expect(config.heading).toBe("Oracle revisjonsbevis")
		})

		it("returns correct instance label", () => {
			expect(config.instanceLabel).toBe("Oracle-instans")
		})

		it("returns correct loading message referencing pensjon-oracle-revisjon", () => {
			expect(config.loadingMessage).toContain("pensjon-oracle-revisjon")
		})

		it("returns correct downloading message referencing pensjon-oracle-revisjon", () => {
			expect(config.downloadingMessage).toContain("pensjon-oracle-revisjon")
		})

		it("returns external link label for oracle", () => {
			expect(config.externalLinkLabel).toContain("pensjon-oracle-revisjon")
		})

		it("returns status table description mentioning bevistyper", () => {
			expect(config.statusTableDescription).toContain("bevistyper")
		})

		it("returns no-instances warning mentioning Oracle-instanser", () => {
			expect(config.noInstancesWarning).toContain("Oracle-instanser")
		})

		it("has labels for all Oracle evidence types", () => {
			expect(config.evidenceTypeLabels).toHaveProperty("audit")
			expect(config.evidenceTypeLabels).toHaveProperty("profiles")
			expect(config.evidenceTypeLabels).toHaveProperty("roles")
			expect(config.evidenceTypeLabels).toHaveProperty("users")
			expect(config.evidenceTypeLabels).toHaveProperty("period")
		})

		it("formats instanceId as uppercase", () => {
			expect(config.formatInstanceId("pensjon_prod")).toBe("PENSJON_PROD")
		})

		it("shows date filters when period type is included", () => {
			expect(config.showDateFilters(["period"])).toBe(true)
			expect(config.showDateFilters(["audit", "period"])).toBe(true)
		})

		it("hides date filters when period type is not included", () => {
			expect(config.showDateFilters(["audit"])).toBe(false)
			expect(config.showDateFilters(["audit", "profiles"])).toBe(false)
			expect(config.showDateFilters([])).toBe(false)
		})
	})

	describe("deployments config", () => {
		const config = getProviderUiConfig("deployments")

		it("returns correct heading", () => {
			expect(config.heading).toBe("Leveranserapporter")
		})

		it("returns correct instance label", () => {
			expect(config.instanceLabel).toBe("Team")
		})

		it("returns loading message referencing NDA", () => {
			expect(config.loadingMessage).toContain("NDA")
		})

		it("returns downloading message referencing NDA", () => {
			expect(config.downloadingMessage).toContain("NDA")
		})

		it("returns external link label for NDA", () => {
			expect(config.externalLinkLabel).toContain("NDA")
		})

		it("returns status table description mentioning leveranserapporter", () => {
			expect(config.statusTableDescription).toContain("leveranserapporter")
		})

		it("returns no-instances warning mentioning team", () => {
			expect(config.noInstancesWarning).toContain("team")
		})

		it("has label for deployment_evidence_report", () => {
			expect(config.evidenceTypeLabels).toHaveProperty("deployment_evidence_report")
		})

		it("formats instanceId as-is", () => {
			expect(config.formatInstanceId("my-team")).toBe("my-team")
		})

		it("never shows date filters", () => {
			expect(config.showDateFilters(["deployment_evidence_report"])).toBe(false)
			expect(config.showDateFilters([])).toBe(false)
		})
	})

	it("throws for unknown provider type", () => {
		expect(() => getProviderUiConfig("unknown" as "oracle")).toThrow("Unknown provider type")
	})
})
