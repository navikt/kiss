import { describe, expect, it } from "vitest"
import {
	DEPLOYMENT_EVIDENCE_ACTIVITY_TYPES,
	deploymentEvidenceTypesForActivity,
	getEvidenceTypesForActivity,
	getProviderTypeForActivity,
	isDeploymentEvidenceActivityType,
	isOracleEvidenceActivityType,
	ORACLE_EVIDENCE_ACTIVITY_TYPES,
	ROUTINE_ACTIVITY_TYPES,
} from "../activity-types"

describe("isDeploymentEvidenceActivityType", () => {
	it("returns true for deployment evidence types", () => {
		expect(isDeploymentEvidenceActivityType("deployment_evidence_report")).toBe(true)
	})

	it("returns false for Oracle types", () => {
		expect(isDeploymentEvidenceActivityType("oracle_evidence_audit")).toBe(false)
	})

	it("returns false for non-evidence types", () => {
		expect(isDeploymentEvidenceActivityType("entra_id_group_maintenance")).toBe(false)
	})

	it("returns false for unknown strings", () => {
		expect(isDeploymentEvidenceActivityType("unknown")).toBe(false)
	})
})

describe("getProviderTypeForActivity", () => {
	it("returns 'oracle' for all Oracle evidence types", () => {
		for (const type of ORACLE_EVIDENCE_ACTIVITY_TYPES) {
			expect(getProviderTypeForActivity(type)).toBe("oracle")
		}
	})

	it("returns 'deployments' for all deployment evidence types", () => {
		for (const type of DEPLOYMENT_EVIDENCE_ACTIVITY_TYPES) {
			expect(getProviderTypeForActivity(type)).toBe("deployments")
		}
	})

	it("returns null for entra_id_group_maintenance", () => {
		expect(getProviderTypeForActivity("entra_id_group_maintenance")).toBeNull()
	})

	it("returns null for rpa_user_maintenance", () => {
		expect(getProviderTypeForActivity("rpa_user_maintenance")).toBeNull()
	})

	it("returns null for unknown activity types", () => {
		expect(getProviderTypeForActivity("unknown_type")).toBeNull()
	})
})

describe("getEvidenceTypesForActivity", () => {
	it("returns correct evidence types for Oracle activities", () => {
		expect(getEvidenceTypesForActivity("oracle_evidence_audit")).toEqual(["audit"])
		expect(getEvidenceTypesForActivity("oracle_evidence_all")).toEqual([
			"audit",
			"profiles",
			"roles",
			"users",
			"period",
		])
	})

	it("returns correct evidence types for deployment activities", () => {
		expect(getEvidenceTypesForActivity("deployment_evidence_report")).toEqual(["deployment_evidence_report"])
	})

	it("returns null for non-evidence types", () => {
		expect(getEvidenceTypesForActivity("entra_id_group_maintenance")).toBeNull()
	})

	it("returns null for rpa_user_maintenance", () => {
		expect(getEvidenceTypesForActivity("rpa_user_maintenance")).toBeNull()
	})

	it("returns null for unknown types", () => {
		expect(getEvidenceTypesForActivity("unknown")).toBeNull()
	})
})

describe("ROUTINE_ACTIVITY_TYPES", () => {
	it("includes all Oracle evidence types", () => {
		for (const type of ORACLE_EVIDENCE_ACTIVITY_TYPES) {
			expect(ROUTINE_ACTIVITY_TYPES).toContain(type)
		}
	})

	it("includes all deployment evidence types", () => {
		for (const type of DEPLOYMENT_EVIDENCE_ACTIVITY_TYPES) {
			expect(ROUTINE_ACTIVITY_TYPES).toContain(type)
		}
	})

	it("includes entra_id_group_maintenance", () => {
		expect(ROUTINE_ACTIVITY_TYPES).toContain("entra_id_group_maintenance")
	})

	it("includes rpa_user_maintenance", () => {
		expect(ROUTINE_ACTIVITY_TYPES).toContain("rpa_user_maintenance")
	})
})

describe("deploymentEvidenceTypesForActivity", () => {
	it("covers all deployment evidence activity types", () => {
		for (const type of DEPLOYMENT_EVIDENCE_ACTIVITY_TYPES) {
			expect(deploymentEvidenceTypesForActivity[type]).toBeDefined()
			expect(deploymentEvidenceTypesForActivity[type].length).toBeGreaterThan(0)
		}
	})
})

describe("consistency between type guards and provider mapping", () => {
	it("every Oracle type maps to 'oracle' provider", () => {
		for (const type of ORACLE_EVIDENCE_ACTIVITY_TYPES) {
			expect(isOracleEvidenceActivityType(type)).toBe(true)
			expect(getProviderTypeForActivity(type)).toBe("oracle")
		}
	})

	it("every deployment type maps to 'deployments' provider", () => {
		for (const type of DEPLOYMENT_EVIDENCE_ACTIVITY_TYPES) {
			expect(isDeploymentEvidenceActivityType(type)).toBe(true)
			expect(getProviderTypeForActivity(type)).toBe("deployments")
		}
	})
})
