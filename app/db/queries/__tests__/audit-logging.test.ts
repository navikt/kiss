import { describe, expect, it } from "vitest"
import { computeAuditStatus } from "../audit-logging.server"

describe("computeAuditStatus", () => {
	describe("Oracle databases", () => {
		it("returns 'active' for FULLSTENDIG conclusion", () => {
			expect(computeAuditStatus("oracle", null, "FULLSTENDIG", false)).toBe("active")
		})

		it("returns 'partial' for MANGELFULL conclusion", () => {
			expect(computeAuditStatus("oracle", null, "MANGELFULL", false)).toBe("partial")
		})

		it("returns 'inactive' for AV conclusion", () => {
			expect(computeAuditStatus("oracle", null, "AV", false)).toBe("inactive")
		})

		it("returns 'unknown' for UKJENT conclusion without confirmation", () => {
			expect(computeAuditStatus("oracle", null, "UKJENT", false)).toBe("unknown")
		})

		it("returns 'confirmed' for UKJENT conclusion with active confirmation", () => {
			expect(computeAuditStatus("oracle", null, "UKJENT", true)).toBe("confirmed")
		})

		it("returns 'unknown' when no summary data and no confirmation", () => {
			expect(computeAuditStatus("oracle", null, null, false)).toBe("unknown")
		})

		it("returns 'confirmed' when no summary but has manual confirmation", () => {
			expect(computeAuditStatus("oracle", null, null, true)).toBe("confirmed")
		})

		it("ignores auditLogging flag for Oracle (uses summary)", () => {
			expect(computeAuditStatus("oracle", true, "AV", false)).toBe("inactive")
		})
	})

	describe("Cloud SQL PostgreSQL databases", () => {
		it("returns 'active' when auditLogging is true", () => {
			expect(computeAuditStatus("cloud_sql_postgres", true, null, false)).toBe("active")
		})

		it("returns 'inactive' when auditLogging is false", () => {
			expect(computeAuditStatus("cloud_sql_postgres", false, null, false)).toBe("inactive")
		})

		it("returns 'unknown' when auditLogging is null and no confirmation", () => {
			expect(computeAuditStatus("cloud_sql_postgres", null, null, false)).toBe("unknown")
		})

		it("returns 'confirmed' when auditLogging is null but has confirmation", () => {
			expect(computeAuditStatus("cloud_sql_postgres", null, null, true)).toBe("confirmed")
		})
	})

	describe("Other database types", () => {
		it("returns 'unknown' for nais_postgres without confirmation", () => {
			expect(computeAuditStatus("nais_postgres", null, null, false)).toBe("unknown")
		})

		it("returns 'confirmed' for nais_postgres with confirmation", () => {
			expect(computeAuditStatus("nais_postgres", null, null, true)).toBe("confirmed")
		})

		it("returns 'unknown' for on_prem_postgres without confirmation", () => {
			expect(computeAuditStatus("on_prem_postgres", null, null, false)).toBe("unknown")
		})

		it("returns 'confirmed' for opensearch with confirmation", () => {
			expect(computeAuditStatus("opensearch", null, null, true)).toBe("confirmed")
		})
	})
})
