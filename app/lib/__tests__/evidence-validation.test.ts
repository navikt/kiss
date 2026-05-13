import { describe, expect, it } from "vitest"
import {
	buildProviderMetadata,
	extractProviderParams,
	getProviderSourceId,
} from "../evidence-providers/validation.server"

describe("extractProviderParams", () => {
	it("extracts Oracle params from URLSearchParams", () => {
		const params = new URLSearchParams({
			instanceId: "pen",
			fromUtc: "2026-01-01",
			toUtc: "2026-03-31",
		})
		const result = extractProviderParams("oracle", params)
		expect(result).toEqual({
			instanceId: "pen",
			fromUtc: "2026-01-01",
			toUtc: "2026-03-31",
		})
	})

	it("extracts Oracle params with optional dates as undefined", () => {
		const params = new URLSearchParams({ instanceId: "pen" })
		const result = extractProviderParams("oracle", params)
		expect(result).toEqual({
			instanceId: "pen",
			fromUtc: undefined,
			toUtc: undefined,
		})
	})

	it("extracts Oracle params from FormData", () => {
		const formData = new FormData()
		formData.set("instanceId", "  pen  ")
		formData.set("fromUtc", "2026-01-01")
		const result = extractProviderParams("oracle", formData)
		expect(result).toEqual({
			instanceId: "pen",
			fromUtc: "2026-01-01",
			toUtc: undefined,
		})
	})

	it("extracts deployments params from URLSearchParams", () => {
		const params = new URLSearchParams({
			team: "myteam",
			environment: "prod",
			appName: "myapp",
			periodType: "quarterly",
			periodStart: "2026-Q1",
		})
		const result = extractProviderParams("deployments", params)
		expect(result).toEqual({
			team: "myteam",
			environment: "prod",
			appName: "myapp",
			periodType: "quarterly",
			periodStart: "2026-Q1",
		})
	})

	it("returns empty strings for missing deployments params", () => {
		const params = new URLSearchParams()
		const result = extractProviderParams("deployments", params)
		expect(result).toEqual({
			team: "",
			environment: "",
			appName: "",
			periodType: "",
			periodStart: "",
		})
	})
})

describe("buildProviderMetadata", () => {
	it("builds Oracle metadata with all fields", () => {
		const params = { instanceId: "pen" }
		const extra = {
			evidenceType: "audit",
			apiInstanceName: "PESYS Prod",
			reviewProgressSnapshot: { totalStatements: 100 },
		}
		const result = buildProviderMetadata("oracle", params, extra)
		expect(result).toEqual({
			instanceId: "pen",
			evidenceType: "audit",
			apiInstanceName: "PESYS Prod",
			reviewProgressSnapshot: { totalStatements: 100 },
		})
	})

	it("builds Oracle metadata with null extras", () => {
		const result = buildProviderMetadata("oracle", { instanceId: "pen" }, {})
		expect(result).toEqual({
			instanceId: "pen",
			evidenceType: null,
			apiInstanceName: null,
			reviewProgressSnapshot: null,
		})
	})

	it("builds deployments metadata", () => {
		const params = {
			team: "myteam",
			environment: "prod",
			appName: "myapp",
			periodType: "quarterly",
			periodStart: "2026-Q1",
		}
		const extra = { reportId: "report-123" }
		const result = buildProviderMetadata("deployments", params, extra)
		expect(result).toEqual({
			team: "myteam",
			environment: "prod",
			appName: "myapp",
			periodType: "quarterly",
			periodStart: "2026-Q1",
			reportId: "report-123",
		})
	})
})

describe("getProviderSourceId", () => {
	it("returns instanceId for Oracle", () => {
		expect(getProviderSourceId("oracle", { instanceId: "pen" })).toBe("pen")
	})

	it("returns empty string for Oracle without instanceId", () => {
		expect(getProviderSourceId("oracle", {})).toBe("")
	})

	it("returns team/env/app for deployments", () => {
		expect(
			getProviderSourceId("deployments", {
				team: "myteam",
				environment: "prod",
				appName: "myapp",
			}),
		).toBe("myteam/prod/myapp")
	})

	it("filters empty parts for deployments", () => {
		expect(getProviderSourceId("deployments", { team: "myteam" })).toBe("myteam")
	})
})
