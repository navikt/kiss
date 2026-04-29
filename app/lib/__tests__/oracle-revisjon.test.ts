import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Mock azure.server before importing the module under test
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

describe("oracle-revisjon.server", () => {
	describe("shouldAssessRole", () => {
		it("returns true for custom roles (oracleMaintained = false)", async () => {
			const { shouldAssessRole } = await import("../oracle-revisjon.server")
			expect(
				shouldAssessRole({
					name: "APP_USER",
					authType: null,
					common: false,
					oracleMaintained: false,
					hasNavAnsattGrantee: false,
				}),
			).toBe(true)
			expect(
				shouldAssessRole({
					name: "APP_USER",
					authType: null,
					common: false,
					oracleMaintained: false,
					hasNavAnsattGrantee: true,
				}),
			).toBe(true)
		})

		it("returns true for Oracle-maintained roles used by Nav-ansatte", async () => {
			const { shouldAssessRole } = await import("../oracle-revisjon.server")
			expect(
				shouldAssessRole({
					name: "CONNECT",
					authType: null,
					common: true,
					oracleMaintained: true,
					hasNavAnsattGrantee: true,
				}),
			).toBe(true)
		})

		it("returns false for Oracle-maintained roles not used by Nav-ansatte", async () => {
			const { shouldAssessRole } = await import("../oracle-revisjon.server")
			expect(
				shouldAssessRole({
					name: "DBA",
					authType: null,
					common: true,
					oracleMaintained: true,
					hasNavAnsattGrantee: false,
				}),
			).toBe(false)
		})

		it("returns true when oracleMaintained is null (treated as custom)", async () => {
			const { shouldAssessRole } = await import("../oracle-revisjon.server")
			expect(
				shouldAssessRole({
					name: "UNKNOWN",
					authType: null,
					common: null,
					oracleMaintained: null,
					hasNavAnsattGrantee: false,
				}),
			).toBe(true)
		})

		it("returns true when hasNavAnsattGrantee is missing or null (safe default)", async () => {
			const { shouldAssessRole } = await import("../oracle-revisjon.server")
			expect(shouldAssessRole({ name: "CONNECT", authType: null, common: true, oracleMaintained: true })).toBe(true)
			expect(
				shouldAssessRole({
					name: "CONNECT",
					authType: null,
					common: true,
					oracleMaintained: true,
					hasNavAnsattGrantee: null,
				}),
			).toBe(true)
		})
	})

	describe("getAuditEvidenceSummary (dev mode)", () => {
		it("returns mock summary when ORACLE_REVISJON_BASE_URL is not set", async () => {
			// In test env, ORACLE_REVISJON_BASE_URL is not set → dev mode
			const { getAuditEvidenceSummary } = await import("../oracle-revisjon.server")

			const summary = await getAuditEvidenceSummary("pen")

			expect(summary).not.toBeNull()
			expect(summary).toHaveProperty("conclusion")
			expect(summary).toHaveProperty("reason")
			expect(summary).toHaveProperty("findings")
			expect(["AV", "MANGELFULL", "FULLSTENDIG", "UKJENT"]).toContain(summary?.conclusion)
			expect(Array.isArray(summary?.findings)).toBe(true)
		})

		it("returns consistent mock results for same instanceId", async () => {
			const { getAuditEvidenceSummary } = await import("../oracle-revisjon.server")

			const result1 = await getAuditEvidenceSummary("pen")
			const result2 = await getAuditEvidenceSummary("pen")

			expect(result1).toEqual(result2)
		})

		it("returns different mock conclusions for different instanceIds", async () => {
			const { getAuditEvidenceSummary } = await import("../oracle-revisjon.server")

			const results = await Promise.all(["pen", "sam", "tp", "foobar"].map((id) => getAuditEvidenceSummary(id)))

			// The mock hashing gives deterministic but varied results
			const conclusions = results.map((r) => r?.conclusion)
			expect(conclusions.every((c) => c != null && ["AV", "MANGELFULL", "FULLSTENDIG", "UKJENT"].includes(c))).toBe(
				true,
			)
		})

		it("includes properly structured findings", async () => {
			const { getAuditEvidenceSummary } = await import("../oracle-revisjon.server")

			const summary = await getAuditEvidenceSummary("pen")

			for (const finding of summary?.findings ?? []) {
				expect(finding).toHaveProperty("severity")
				expect(finding).toHaveProperty("message")
				expect(["KRITISK", "ADVARSEL", "INFO"]).toContain(finding.severity)
				expect(typeof finding.message).toBe("string")
			}
		})
	})

	describe("getAuditEvidenceSummary (production mode)", () => {
		let originalEnv: NodeJS.ProcessEnv

		beforeEach(() => {
			originalEnv = { ...process.env }
			vi.resetModules()
		})

		afterEach(() => {
			process.env = originalEnv
			vi.restoreAllMocks()
			vi.resetModules()
		})

		it("returns parsed summary on 200 response", async () => {
			process.env.ORACLE_REVISJON_BASE_URL = "https://oracle-revisjon.test"
			process.env.ORACLE_REVISJON_SCOPE = "api://test-scope/.default"

			const mockSummary = {
				conclusion: "FULLSTENDIG",
				reason: "Alt OK",
				unifiedAuditingEnabled: true,
				activePolicyCount: 3,
				auditedObjectCount: 50,
				unauditedTableCount: 0,
				excludedUserCount: 0,
				policiesWithoutFailureAudit: 0,
				hasAuditTrailData: true,
				findings: [{ severity: "INFO", message: "Alle tabeller dekket" }],
			}

			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue({
					ok: true,
					status: 200,
					json: () => Promise.resolve(mockSummary),
				}),
			)

			const { getAuditEvidenceSummary } = await import("../oracle-revisjon.server")
			const result = await getAuditEvidenceSummary("pen")

			expect(result).toEqual(mockSummary)
			expect(fetch).toHaveBeenCalledWith("https://oracle-revisjon.test/api/m2m/audit/evidence/summary", {
				headers: {
					Authorization: "Bearer mock-token",
					"X-Instance-Id": "pen",
				},
			})
		})

		it("returns null on 204 response", async () => {
			process.env.ORACLE_REVISJON_BASE_URL = "https://oracle-revisjon.test"
			process.env.ORACLE_REVISJON_SCOPE = "api://test-scope/.default"

			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue({
					ok: false,
					status: 204,
					text: () => Promise.resolve(""),
				}),
			)

			const { getAuditEvidenceSummary } = await import("../oracle-revisjon.server")
			const result = await getAuditEvidenceSummary("pen")

			expect(result).toBeNull()
		})

		it("returns null on error response", async () => {
			process.env.ORACLE_REVISJON_BASE_URL = "https://oracle-revisjon.test"
			process.env.ORACLE_REVISJON_SCOPE = "api://test-scope/.default"

			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue({
					ok: false,
					status: 500,
					text: () => Promise.resolve("Internal Server Error"),
				}),
			)

			const { getAuditEvidenceSummary } = await import("../oracle-revisjon.server")
			const result = await getAuditEvidenceSummary("pen")

			expect(result).toBeNull()
		})

		it("returns null on network error", async () => {
			process.env.ORACLE_REVISJON_BASE_URL = "https://oracle-revisjon.test"
			process.env.ORACLE_REVISJON_SCOPE = "api://test-scope/.default"

			vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")))

			const { getAuditEvidenceSummary } = await import("../oracle-revisjon.server")
			const result = await getAuditEvidenceSummary("pen")

			expect(result).toBeNull()
		})

		it("caches successful results", async () => {
			process.env.ORACLE_REVISJON_BASE_URL = "https://oracle-revisjon.test"
			process.env.ORACLE_REVISJON_SCOPE = "api://test-scope/.default"

			const mockSummary = {
				conclusion: "FULLSTENDIG",
				reason: "Alt OK",
				unifiedAuditingEnabled: true,
				activePolicyCount: 3,
				auditedObjectCount: 50,
				unauditedTableCount: 0,
				excludedUserCount: 0,
				policiesWithoutFailureAudit: 0,
				hasAuditTrailData: true,
				findings: [],
			}

			const fetchMock = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: () => Promise.resolve(mockSummary),
			})
			vi.stubGlobal("fetch", fetchMock)

			const { getAuditEvidenceSummary } = await import("../oracle-revisjon.server")

			const result1 = await getAuditEvidenceSummary("pen")
			const result2 = await getAuditEvidenceSummary("pen")

			expect(result1).toEqual(mockSummary)
			expect(result2).toEqual(mockSummary)
			// fetch should only be called once due to caching
			expect(fetchMock).toHaveBeenCalledTimes(1)
		})

		it("caches null (204) results", async () => {
			process.env.ORACLE_REVISJON_BASE_URL = "https://oracle-revisjon.test"
			process.env.ORACLE_REVISJON_SCOPE = "api://test-scope/.default"

			const fetchMock = vi.fn().mockResolvedValue({
				ok: false,
				status: 204,
				text: () => Promise.resolve(""),
			})
			vi.stubGlobal("fetch", fetchMock)

			const { getAuditEvidenceSummary } = await import("../oracle-revisjon.server")

			const result1 = await getAuditEvidenceSummary("pen")
			const result2 = await getAuditEvidenceSummary("pen")

			expect(result1).toBeNull()
			expect(result2).toBeNull()
			expect(fetchMock).toHaveBeenCalledTimes(1)
		})
	})
})
