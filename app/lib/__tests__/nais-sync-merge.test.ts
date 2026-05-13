import { describe, expect, it } from "vitest"
import type { NaisAuthIntegration } from "../nais.server"
import { mergeAuthIntegrations, mergeInboundRules, mergeOptionalBoolean, mergeStringArrays } from "../nais-sync.server"

describe("mergeOptionalBoolean", () => {
	it("returns true when any is true", () => {
		expect(mergeOptionalBoolean(true, false)).toBe(true)
		expect(mergeOptionalBoolean(false, true)).toBe(true)
		expect(mergeOptionalBoolean(true, undefined)).toBe(true)
		expect(mergeOptionalBoolean(undefined, true)).toBe(true)
		expect(mergeOptionalBoolean(true, true)).toBe(true)
	})

	it("returns false when any is explicit false and none is true", () => {
		expect(mergeOptionalBoolean(false, false)).toBe(false)
		expect(mergeOptionalBoolean(false, undefined)).toBe(false)
		expect(mergeOptionalBoolean(undefined, false)).toBe(false)
	})

	it("returns undefined only when both are undefined", () => {
		expect(mergeOptionalBoolean(undefined, undefined)).toBeUndefined()
	})
})

describe("mergeStringArrays", () => {
	it("returns undefined when both are undefined", () => {
		expect(mergeStringArrays(undefined, undefined)).toBeUndefined()
	})

	it("returns the array when one side is undefined", () => {
		expect(mergeStringArrays(["a", "b"], undefined)).toEqual(["a", "b"])
		expect(mergeStringArrays(undefined, ["c"])).toEqual(["c"])
	})

	it("unions and deduplicates", () => {
		const result = mergeStringArrays(["a", "b"], ["b", "c"])
		expect(result).toHaveLength(3)
		expect(new Set(result)).toEqual(new Set(["a", "b", "c"]))
	})

	it("returns undefined for empty arrays", () => {
		expect(mergeStringArrays([], [])).toBeUndefined()
	})
})

describe("mergeInboundRules", () => {
	it("returns undefined when both are undefined", () => {
		expect(mergeInboundRules(undefined, undefined)).toBeUndefined()
	})

	it("deduplicates by application+namespace+cluster", () => {
		const a = [{ application: "app-a", namespace: "ns1", cluster: "dev-gcp" }]
		const b = [
			{ application: "app-a", namespace: "ns1", cluster: "dev-gcp" },
			{ application: "app-b" },
		]
		const result = mergeInboundRules(a, b)!
		expect(result).toHaveLength(2)
		expect(result[0]).toEqual({ application: "app-a", namespace: "ns1", cluster: "dev-gcp" })
		expect(result[1]).toEqual({ application: "app-b" })
	})

	it("unions rules from different environments", () => {
		const devRules = [{ application: "dev-only", namespace: "team", cluster: "dev-gcp" }]
		const prodRules = [{ application: "prod-only", namespace: "team", cluster: "prod-gcp" }]
		const result = mergeInboundRules(devRules, prodRules)!
		expect(result).toHaveLength(2)
	})
})

describe("mergeAuthIntegrations", () => {
	const base: NaisAuthIntegration = { type: "entra_id", enabled: true }

	it("merges all fields from two environments", () => {
		const dev: NaisAuthIntegration = {
			type: "entra_id",
			enabled: true,
			allowAllUsers: false,
			groups: ["group-a"],
			claimsExtra: ["claim-1"],
			inboundRules: [{ application: "dev-app", namespace: "ns", cluster: "dev-gcp" }],
		}
		const prod: NaisAuthIntegration = {
			type: "entra_id",
			enabled: true,
			allowAllUsers: true,
			groups: ["group-a", "group-b"],
			claimsExtra: ["claim-2"],
			inboundRules: [{ application: "prod-app", namespace: "ns", cluster: "prod-gcp" }],
		}

		const result = mergeAuthIntegrations(dev, prod)
		expect(result.type).toBe("entra_id")
		expect(result.allowAllUsers).toBe(true) // true wins
		expect(new Set(result.groups)).toEqual(new Set(["group-a", "group-b"]))
		expect(new Set(result.claimsExtra)).toEqual(new Set(["claim-1", "claim-2"]))
		expect(result.inboundRules).toHaveLength(2)
	})

	it("preserves explicit false for sidecarEnabled", () => {
		const a: NaisAuthIntegration = { ...base, sidecarEnabled: false }
		const b: NaisAuthIntegration = { ...base, sidecarEnabled: undefined }
		expect(mergeAuthIntegrations(a, b).sidecarEnabled).toBe(false)
		expect(mergeAuthIntegrations(b, a).sidecarEnabled).toBe(false)
	})

	it("returns undefined for optional fields when both are undefined", () => {
		const result = mergeAuthIntegrations(base, base)
		expect(result.allowAllUsers).toBeUndefined()
		expect(result.sidecarEnabled).toBeUndefined()
		expect(result.groups).toBeUndefined()
		expect(result.claimsExtra).toBeUndefined()
		expect(result.inboundRules).toBeUndefined()
	})
})
