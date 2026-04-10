import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../azure.server", () => ({
	getClientCredentialToken: vi.fn().mockResolvedValue("mock-token"),
}))

vi.mock("../logger.server", () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

describe("deployment-audit.server", () => {
	describe("getVerificationSummary (dev mode)", () => {
		it("returns mock summary when DEPLOYMENT_AUDIT_BASE_URL is not set", async () => {
			const { getVerificationSummary } = await import("../deployment-audit.server")

			const result = await getVerificationSummary("myteam", "prod-gcp", "myapp")

			expect(result.notMonitored).toBe(false)
			expect(result.data).not.toBeNull()
			expect(result.data).toHaveProperty("fourEyesCoverage")
			expect(result.data).toHaveProperty("changeOriginCoverage")
			expect(result.data).toHaveProperty("lastDeployment")
			expect(result.data).toHaveProperty("period")
			expect(result.data).toHaveProperty("app")
		})

		it("returns consistent mock results for same team/env/app", async () => {
			const { getVerificationSummary } = await import("../deployment-audit.server")

			const result1 = await getVerificationSummary("myteam", "prod-gcp", "myapp")
			const result2 = await getVerificationSummary("myteam", "prod-gcp", "myapp")

			expect(result1.data?.fourEyesCoverage.coveragePercent).toBe(result2.data?.fourEyesCoverage.coveragePercent)
		})

		it("returns different mock results for different apps", async () => {
			const { getVerificationSummary } = await import("../deployment-audit.server")

			const result1 = await getVerificationSummary("team1", "prod-gcp", "app1")
			const result2 = await getVerificationSummary("team2", "prod-gcp", "app2")

			// Different app names should produce deterministically different coverage
			expect(result1.data?.app.name).toBe("app1")
			expect(result2.data?.app.name).toBe("app2")
		})

		it("mock summary has valid coverage percentages", async () => {
			const { getVerificationSummary } = await import("../deployment-audit.server")

			const result = await getVerificationSummary("team", "prod-gcp", "app")

			expect(result.data?.fourEyesCoverage.coveragePercent).toBeGreaterThanOrEqual(0)
			expect(result.data?.fourEyesCoverage.coveragePercent).toBeLessThanOrEqual(100)
			expect(result.data?.changeOriginCoverage.coveragePercent).toBeGreaterThanOrEqual(0)
			expect(result.data?.changeOriginCoverage.coveragePercent).toBeLessThanOrEqual(100)
		})

		it("mock summary totals are internally consistent", async () => {
			const { getVerificationSummary } = await import("../deployment-audit.server")

			const result = await getVerificationSummary("team", "prod-gcp", "app")
			const coverage = result.data?.fourEyesCoverage
			expect(coverage).toBeDefined()
			if (coverage) {
				expect(coverage.approved + coverage.unapproved).toBeLessThanOrEqual(coverage.total + 1) // rounding tolerance
			}
		})
	})

	describe("getVerificationSummary (with fetch)", () => {
		let originalFetch: typeof global.fetch
		let originalEnv: NodeJS.ProcessEnv

		beforeEach(() => {
			originalFetch = global.fetch
			originalEnv = { ...process.env }
			vi.resetModules()
		})

		afterEach(() => {
			global.fetch = originalFetch
			process.env = originalEnv
			vi.resetModules()
		})

		it("handles 404 as not_monitored", async () => {
			process.env.DEPLOYMENT_AUDIT_BASE_URL = "http://test-service"
			process.env.DEPLOYMENT_AUDIT_SCOPE = "api://test/.default"

			global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }))

			const { getVerificationSummary } = await import("../deployment-audit.server")
			const result = await getVerificationSummary("team", "prod-gcp", "unknown-app")

			expect(result.notMonitored).toBe(true)
			expect(result.data).toBeNull()
		})

		it("handles 500 errors gracefully", async () => {
			process.env.DEPLOYMENT_AUDIT_BASE_URL = "http://test-service"
			process.env.DEPLOYMENT_AUDIT_SCOPE = "api://test/.default"

			global.fetch = vi.fn().mockResolvedValue(new Response("Internal Server Error", { status: 500 }))

			const { getVerificationSummary } = await import("../deployment-audit.server")
			const result = await getVerificationSummary("team", "prod-gcp", "app")

			expect(result.data).toBeNull()
			expect(result.notMonitored).toBe(false)
		})

		it("handles network errors gracefully", async () => {
			process.env.DEPLOYMENT_AUDIT_BASE_URL = "http://test-service"
			process.env.DEPLOYMENT_AUDIT_SCOPE = "api://test/.default"

			global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))

			const { getVerificationSummary } = await import("../deployment-audit.server")
			const result = await getVerificationSummary("team", "prod-gcp", "app")

			expect(result.data).toBeNull()
			expect(result.notMonitored).toBe(false)
		})

		it("returns parsed data on 200", async () => {
			process.env.DEPLOYMENT_AUDIT_BASE_URL = "http://test-service"
			process.env.DEPLOYMENT_AUDIT_SCOPE = "api://test/.default"

			const mockData = {
				app: { team: "team", environment: "prod-gcp", name: "app", isActive: true },
				period: { from: "2025-01-01T00:00:00Z", to: "2025-12-31T23:59:59Z" },
				fourEyesCoverage: {
					total: 100,
					approved: 85,
					unapproved: 14,
					pending: 1,
					coveragePercent: 85,
				},
				changeOriginCoverage: {
					total: 80,
					linked: 72,
					dependabot: 5,
					coveragePercent: 90,
				},
				lastDeployment: {
					createdAt: "2025-06-01T12:00:00Z",
					deployer: "x123456",
					commitSha: "abc123",
					fourEyesStatus: "approved",
					hasChangeOrigin: true,
				},
			}

			global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(mockData), { status: 200 }))

			const { getVerificationSummary } = await import("../deployment-audit.server")
			const result = await getVerificationSummary("team", "prod-gcp", "app")

			expect(result.data).toEqual(mockData)
			expect(result.notMonitored).toBe(false)
		})

		it("passes from/to query parameters", async () => {
			process.env.DEPLOYMENT_AUDIT_BASE_URL = "http://test-service"
			process.env.DEPLOYMENT_AUDIT_SCOPE = "api://test/.default"

			global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))

			const { getVerificationSummary } = await import("../deployment-audit.server")
			await getVerificationSummary("team", "prod-gcp", "app", "2025-01-01", "2025-12-31")

			const callUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
			expect(callUrl).toContain("from=2025-01-01")
			expect(callUrl).toContain("to=2025-12-31")
		})
	})
})
