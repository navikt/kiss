import { describe, expect, it } from "vitest"
import {
	applyOracleRoleCriticalityPatch,
	ORACLE_ROLE_CRITICALITY_ACTIVITY_TYPE,
	ORACLE_ROLE_CRITICALITY_SCHEMA_VERSION,
	parseOracleRoleCriticalityStagedData,
	toOracleRoleCriticalitySnapshot,
} from "../oracle-role-staged-data"

const baseData = parseOracleRoleCriticalityStagedData({
	activityType: "oracle_role_criticality",
	schemaVersion: 1,
	seededAt: "2025-01-01T00:00:00.000Z",
	apiUnavailable: false,
	roles: [
		{
			instanceId: "inst-1",
			roleName: "CONNECT",
			oracleMaintained: false,
			common: false,
			isNew: false,
			isGone: false,
			criticality: "high",
			criticalitySetBy: "Z990001",
			criticalitySetAt: "2025-01-01T00:00:00.000Z",
		},
		{
			instanceId: "inst-1",
			roleName: "RESOURCE",
			oracleMaintained: false,
			common: false,
			isNew: true,
			isGone: false,
			criticality: null,
			criticalitySetBy: null,
			criticalitySetAt: null,
		},
		{
			instanceId: "inst-2",
			roleName: "GONE_ROLE",
			oracleMaintained: false,
			common: false,
			isNew: false,
			isGone: true,
			criticality: "medium",
			criticalitySetBy: "Z990002",
			criticalitySetAt: "2025-01-01T00:00:00.000Z",
		},
	],
})

describe("applyOracleRoleCriticalityPatch", () => {
	describe("set-criticality", () => {
		it("setter kritikalitet på en rolle uten å påvirke andre", () => {
			const updated = applyOracleRoleCriticalityPatch(baseData, {
				op: "set-criticality",
				instanceId: "inst-1",
				roleName: "RESOURCE",
				criticality: "low",
				setBy: "Z990003",
				setAt: "2025-06-01T12:00:00.000Z",
			})
			const role = updated.roles.find((r) => r.roleName === "RESOURCE")
			expect(role).toMatchObject({
				criticality: "low",
				criticalitySetBy: "Z990003",
				criticalitySetAt: "2025-06-01T12:00:00.000Z",
			})
			// Andre roller uendret
			expect(updated.roles.find((r) => r.roleName === "CONNECT")).toMatchObject({ criticality: "high" })
		})

		it("overskriver eksisterende kritikalitet", () => {
			const updated = applyOracleRoleCriticalityPatch(baseData, {
				op: "set-criticality",
				instanceId: "inst-1",
				roleName: "CONNECT",
				criticality: "low",
				setBy: "Z990001",
				setAt: "2025-06-01T12:00:00.000Z",
			})
			expect(updated.roles.find((r) => r.roleName === "CONNECT")?.criticality).toBe("low")
		})

		it("er idempotent — samme patch gir samme resultat", () => {
			const patch = {
				op: "set-criticality" as const,
				instanceId: "inst-1",
				roleName: "RESOURCE",
				criticality: "medium" as const,
				setBy: "Z990001",
				setAt: "2025-06-01T12:00:00.000Z",
			}
			const once = applyOracleRoleCriticalityPatch(baseData, patch)
			const twice = applyOracleRoleCriticalityPatch(once, patch)
			expect(JSON.stringify(once.roles)).toBe(JSON.stringify(twice.roles))
		})

		it("kaster feil for ukjent rolle", () => {
			expect(() =>
				applyOracleRoleCriticalityPatch(baseData, {
					op: "set-criticality",
					instanceId: "inst-1",
					roleName: "FINNES_IKKE",
					criticality: "low",
					setBy: "Z990001",
					setAt: "2025-06-01T12:00:00.000Z",
				}),
			).toThrow("inst-1:FINNES_IKKE")
		})

		it("kaster feil for isGone-rolle", () => {
			expect(() =>
				applyOracleRoleCriticalityPatch(baseData, {
					op: "set-criticality",
					instanceId: "inst-2",
					roleName: "GONE_ROLE",
					criticality: "low",
					setBy: "Z990001",
					setAt: "2025-06-01T12:00:00.000Z",
				}),
			).toThrow("inst-2:GONE_ROLE")
		})

		it("skiller mellom samme rollenavn på ulike instanser", () => {
			const dataWithSameRoleOnTwoInstances = parseOracleRoleCriticalityStagedData({
				activityType: "oracle_role_criticality",
				schemaVersion: 1,
				seededAt: "2025-01-01T00:00:00.000Z",
				apiUnavailable: false,
				roles: [
					{
						instanceId: "inst-A",
						roleName: "SHARED",
						oracleMaintained: false,
						common: false,
						isNew: false,
						isGone: false,
						criticality: null,
						criticalitySetBy: null,
						criticalitySetAt: null,
					},
					{
						instanceId: "inst-B",
						roleName: "SHARED",
						oracleMaintained: false,
						common: false,
						isNew: false,
						isGone: false,
						criticality: null,
						criticalitySetBy: null,
						criticalitySetAt: null,
					},
				],
			})

			const updated = applyOracleRoleCriticalityPatch(dataWithSameRoleOnTwoInstances, {
				op: "set-criticality",
				instanceId: "inst-A",
				roleName: "SHARED",
				criticality: "high",
				setBy: "Z990001",
				setAt: "2025-06-01T12:00:00.000Z",
			})

			expect(updated.roles.find((r) => r.instanceId === "inst-A")?.criticality).toBe("high")
			expect(updated.roles.find((r) => r.instanceId === "inst-B")?.criticality).toBeNull()
		})
	})
})

describe("toOracleRoleCriticalitySnapshot", () => {
	it("inkluderer riktig type og schemaVersion", () => {
		const snapshot = toOracleRoleCriticalitySnapshot(baseData)
		expect(snapshot.type).toBe(ORACLE_ROLE_CRITICALITY_ACTIVITY_TYPE)
		expect(snapshot.schemaVersion).toBe(ORACLE_ROLE_CRITICALITY_SCHEMA_VERSION)
	})

	it("utelater isNew fra snapshot-roller", () => {
		const snapshot = toOracleRoleCriticalitySnapshot(baseData)
		for (const role of snapshot.roles) {
			expect(role).not.toHaveProperty("isNew")
		}
	})

	it("bevarer isGone i snapshot", () => {
		const snapshot = toOracleRoleCriticalitySnapshot(baseData)
		const gone = snapshot.roles.find((r) => r.roleName === "GONE_ROLE")
		expect(gone?.isGone).toBe(true)
	})

	it("setter ikke apiUnavailable når false i staged data", () => {
		const snapshot = toOracleRoleCriticalitySnapshot(baseData)
		expect(snapshot.apiUnavailable).toBeUndefined()
	})

	it("setter apiUnavailable: true når unavailable", () => {
		const unavailableData = parseOracleRoleCriticalityStagedData({
			...baseData,
			apiUnavailable: true,
		})
		const snapshot = toOracleRoleCriticalitySnapshot(unavailableData)
		expect(snapshot.apiUnavailable).toBe(true)
	})
})

describe("Zod schema superRefine", () => {
	it("avviser duplikate instanceId:roleName-nøkler", () => {
		expect(() =>
			parseOracleRoleCriticalityStagedData({
				activityType: "oracle_role_criticality",
				schemaVersion: 1,
				seededAt: "2025-01-01T00:00:00.000Z",
				apiUnavailable: false,
				roles: [
					{
						instanceId: "inst-1",
						roleName: "ROLE",
						oracleMaintained: false,
						common: false,
						isNew: false,
						isGone: false,
						criticality: null,
						criticalitySetBy: null,
						criticalitySetAt: null,
					},
					{
						instanceId: "inst-1",
						roleName: "ROLE",
						oracleMaintained: false,
						common: false,
						isNew: false,
						isGone: false,
						criticality: "high",
						criticalitySetBy: "Z990001",
						criticalitySetAt: "2025-01-01T00:00:00.000Z",
					},
				],
			}),
		).toThrow()
	})

	it("tillater samme rollenavn på ulike instanser", () => {
		expect(() =>
			parseOracleRoleCriticalityStagedData({
				activityType: "oracle_role_criticality",
				schemaVersion: 1,
				seededAt: "2025-01-01T00:00:00.000Z",
				apiUnavailable: false,
				roles: [
					{
						instanceId: "inst-A",
						roleName: "ROLE",
						oracleMaintained: false,
						common: false,
						isNew: false,
						isGone: false,
						criticality: null,
						criticalitySetBy: null,
						criticalitySetAt: null,
					},
					{
						instanceId: "inst-B",
						roleName: "ROLE",
						oracleMaintained: false,
						common: false,
						isNew: false,
						isGone: false,
						criticality: null,
						criticalitySetBy: null,
						criticalitySetAt: null,
					},
				],
			}),
		).not.toThrow()
	})

	it("avviser rolle med isNew=true og isGone=true", () => {
		expect(() =>
			parseOracleRoleCriticalityStagedData({
				activityType: "oracle_role_criticality",
				schemaVersion: 1,
				seededAt: "2025-01-01T00:00:00.000Z",
				apiUnavailable: false,
				roles: [
					{
						instanceId: "inst-1",
						roleName: "CONTRADICTING",
						oracleMaintained: false,
						common: false,
						isNew: true,
						isGone: true,
						criticality: null,
						criticalitySetBy: null,
						criticalitySetAt: null,
					},
				],
			}),
		).toThrow()
	})

	it("avviser feil schemaVersion", () => {
		expect(() =>
			parseOracleRoleCriticalityStagedData({
				activityType: "oracle_role_criticality",
				schemaVersion: 99,
				seededAt: "2025-01-01T00:00:00.000Z",
				apiUnavailable: false,
				roles: [],
			}),
		).toThrow()
	})

	it("avviser feil activityType", () => {
		expect(() =>
			parseOracleRoleCriticalityStagedData({
				activityType: "rpa_user_maintenance",
				schemaVersion: 1,
				seededAt: "2025-01-01T00:00:00.000Z",
				apiUnavailable: false,
				roles: [],
			}),
		).toThrow()
	})
})
