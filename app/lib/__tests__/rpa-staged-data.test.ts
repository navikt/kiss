import { describe, expect, it } from "vitest"
import { applyRpaStagedDataPatch, parseRpaStagedData } from "~/lib/rpa-staged-data"

const baseData = parseRpaStagedData({
	activityType: "rpa_user_maintenance",
	schemaVersion: 1,
	seededAt: "2025-01-01T00:00:00.000Z",
	users: [
		{
			userObjectId: "user-nais-1",
			displayName: "Nais Robot",
			userPrincipalName: "robot@nav.no",
			accountEnabled: true,
			rpaGroupName: "RPA-gruppe-A",
			matchSource: "nais",
			isGone: false,
			owner: null,
			needComment: null,
			criticalityComment: null,
			securityComment: null,
			decision: null,
			decisionDeadline: null,
		},
		{
			userObjectId: "user-manual-1",
			displayName: "Manual Robot",
			userPrincipalName: "manual@nav.no",
			accountEnabled: false,
			rpaGroupName: "RPA-gruppe-B",
			matchSource: "manual",
			isGone: false,
			owner: "Ole Nordmann",
			needComment: "Trengs for X",
			criticalityComment: null,
			securityComment: null,
			decision: "videreføres",
			decisionDeadline: null,
		},
		{
			userObjectId: "user-gone-1",
			displayName: null,
			userPrincipalName: null,
			accountEnabled: null,
			rpaGroupName: null,
			matchSource: null,
			isGone: true,
			owner: "Kari Nordmann",
			needComment: null,
			criticalityComment: null,
			securityComment: null,
			decision: "avvikles",
			decisionDeadline: "2025-06-01",
		},
	],
})

describe("rpa staged data", () => {
	describe("set-assessment", () => {
		it("setter enkeltfelt uten å påvirke andre", () => {
			const updated = applyRpaStagedDataPatch(baseData, {
				op: "set-assessment",
				userObjectId: "user-nais-1",
				owner: "Ny Eier",
			})
			expect(updated.users[0]).toMatchObject({ owner: "Ny Eier", decision: null, needComment: null })
			// Andre brukere er uendret
			expect(updated.users[1]).toMatchObject({ owner: "Ole Nordmann", decision: "videreføres" })
		})

		it("setter beslutning uten å endre null-frist", () => {
			const updated = applyRpaStagedDataPatch(baseData, {
				op: "set-assessment",
				userObjectId: "user-nais-1",
				decision: "avvikles",
			})
			// User had decisionDeadline: null, setting decision alone doesn't add a deadline
			expect(updated.users[0]).toMatchObject({ decision: "avvikles", decisionDeadline: null })
		})

		it("setter beslutning og frist", () => {
			const updated = applyRpaStagedDataPatch(baseData, {
				op: "set-assessment",
				userObjectId: "user-nais-1",
				decision: "endres",
				decisionDeadline: "2025-12-31",
			})
			expect(updated.users[0]).toMatchObject({ decision: "endres", decisionDeadline: "2025-12-31" })
		})

		it("rydder opp frist når beslutning endres til videreføres", () => {
			// Start med avvikles + frist
			const withDeadline = applyRpaStagedDataPatch(baseData, {
				op: "set-assessment",
				userObjectId: "user-nais-1",
				decision: "endres",
				decisionDeadline: "2025-12-31",
			})
			// Endre til videreføres
			const updated = applyRpaStagedDataPatch(withDeadline, {
				op: "set-assessment",
				userObjectId: "user-nais-1",
				decision: "videreføres",
			})
			expect(updated.users[0]).toMatchObject({ decision: "videreføres", decisionDeadline: null })
		})

		it("lar isGone-brukere få vurderinger satt", () => {
			const updated = applyRpaStagedDataPatch(baseData, {
				op: "set-assessment",
				userObjectId: "user-gone-1",
				owner: "Gammel Eier",
			})
			expect(updated.users[2]).toMatchObject({ isGone: true, owner: "Gammel Eier" })
		})

		it("kaster feil for ukjent bruker", () => {
			expect(() =>
				applyRpaStagedDataPatch(baseData, {
					op: "set-assessment",
					userObjectId: "finnes-ikke",
					owner: "Eier",
				}),
			).toThrow("Fant ikke bruker finnes-ikke")
		})

		it("er idempotent — samme patch gir samme resultat", () => {
			const patch = { op: "set-assessment" as const, userObjectId: "user-nais-1", owner: "Stabil Eier" }
			const once = applyRpaStagedDataPatch(baseData, patch)
			const twice = applyRpaStagedDataPatch(once, patch)
			expect(JSON.stringify(once.users)).toBe(JSON.stringify(twice.users))
		})

		it("no-op gir identisk JSON.stringify", () => {
			// Patch med samme verdi som allerede er lagret — ingen endring
			const patch = {
				op: "set-assessment" as const,
				userObjectId: "user-manual-1",
				owner: "Ole Nordmann",
				decision: "videreføres" as const,
			}
			const updated = applyRpaStagedDataPatch(baseData, patch)
			expect(JSON.stringify(baseData.users)).toBe(JSON.stringify(updated.users))
		})
	})

	describe("Zod schema superRefine", () => {
		it("avviser duplikate userObjectId", () => {
			expect(() =>
				parseRpaStagedData({
					activityType: "rpa_user_maintenance",
					schemaVersion: 1,
					seededAt: "2025-01-01T00:00:00.000Z",
					users: [
						{
							userObjectId: "dup",
							displayName: null,
							userPrincipalName: null,
							accountEnabled: null,
							rpaGroupName: null,
							matchSource: "nais",
							isGone: false,
							owner: null,
							needComment: null,
							criticalityComment: null,
							securityComment: null,
							decision: null,
							decisionDeadline: null,
						},
						{
							userObjectId: "dup",
							displayName: null,
							userPrincipalName: null,
							accountEnabled: null,
							rpaGroupName: null,
							matchSource: "nais",
							isGone: false,
							owner: null,
							needComment: null,
							criticalityComment: null,
							securityComment: null,
							decision: null,
							decisionDeadline: null,
						},
					],
				}),
			).toThrow()
		})

		it("avviser deadline uten gyldig beslutning", () => {
			expect(() =>
				parseRpaStagedData({
					activityType: "rpa_user_maintenance",
					schemaVersion: 1,
					seededAt: "2025-01-01T00:00:00.000Z",
					users: [
						{
							userObjectId: "u1",
							displayName: null,
							userPrincipalName: null,
							accountEnabled: null,
							rpaGroupName: null,
							matchSource: "nais",
							isGone: false,
							owner: null,
							needComment: null,
							criticalityComment: null,
							securityComment: null,
							decision: "videreføres",
							decisionDeadline: "2025-12-31",
						},
					],
				}),
			).toThrow()
		})

		it("avviser aktiv bruker uten matchSource", () => {
			expect(() =>
				parseRpaStagedData({
					activityType: "rpa_user_maintenance",
					schemaVersion: 1,
					seededAt: "2025-01-01T00:00:00.000Z",
					users: [
						{
							userObjectId: "u1",
							displayName: null,
							userPrincipalName: null,
							accountEnabled: null,
							rpaGroupName: null,
							matchSource: null,
							isGone: false,
							owner: null,
							needComment: null,
							criticalityComment: null,
							securityComment: null,
							decision: null,
							decisionDeadline: null,
						},
					],
				}),
			).toThrow()
		})
	})
})
