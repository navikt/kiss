import { describe, expect, it } from "vitest"
import { resolveAppUrl } from "../SearchDialog"

const appResult = {
	type: "application" as const,
	id: "app-123",
	url: "/applikasjoner/app-123/detaljer",
	title: "Min app",
	teams: [
		{ teamSlug: "eessi-pensjon", sectionSlug: "pensjon-og-ufore" },
		{ teamSlug: "motta-pensjon", sectionSlug: "pensjon-og-ufore" },
	],
}

const nonAppResult = {
	type: "section" as const,
	id: "sec-1",
	url: "/seksjoner/pensjon-og-ufore",
	title: "Pensjon",
}

describe("resolveAppUrl", () => {
	it("returns team-context URL when on a team page and app belongs to team", () => {
		const url = resolveAppUrl(appResult, "/seksjoner/pensjon-og-ufore/team/eessi-pensjon")
		expect(url).toBe("/seksjoner/pensjon-og-ufore/team/eessi-pensjon/applikasjoner/app-123/detaljer")
	})

	it("returns team-context URL when deep inside a team route", () => {
		const url = resolveAppUrl(
			appResult,
			"/seksjoner/pensjon-og-ufore/team/eessi-pensjon/applikasjoner/other-app/detaljer",
		)
		expect(url).toBe("/seksjoner/pensjon-og-ufore/team/eessi-pensjon/applikasjoner/app-123/detaljer")
	})

	it("returns section-context URL when on a team page but app does not belong to team", () => {
		const url = resolveAppUrl(appResult, "/seksjoner/pensjon-og-ufore/team/annet-team")
		expect(url).toBe("/seksjoner/pensjon-og-ufore/applikasjoner/app-123/detaljer")
	})

	it("returns section-context URL when on a section page", () => {
		const url = resolveAppUrl(appResult, "/seksjoner/pensjon-og-ufore")
		expect(url).toBe("/seksjoner/pensjon-og-ufore/applikasjoner/app-123/detaljer")
	})

	it("returns section-context URL when deep in a section route (not team)", () => {
		const url = resolveAppUrl(appResult, "/seksjoner/pensjon-og-ufore/rutiner")
		expect(url).toBe("/seksjoner/pensjon-og-ufore/applikasjoner/app-123/detaljer")
	})

	it("returns fallback URL when on a different section", () => {
		const url = resolveAppUrl(appResult, "/seksjoner/annen-seksjon/rutiner")
		expect(url).toBe("/applikasjoner/app-123/detaljer")
	})

	it("returns fallback URL when not in any section", () => {
		const url = resolveAppUrl(appResult, "/admin/brukere")
		expect(url).toBe("/applikasjoner/app-123/detaljer")
	})

	it("returns fallback URL for non-app results", () => {
		const url = resolveAppUrl(nonAppResult, "/seksjoner/pensjon-og-ufore/team/eessi-pensjon")
		expect(url).toBe("/seksjoner/pensjon-og-ufore")
	})

	it("returns fallback URL when app has no teams", () => {
		const noTeamsApp = { ...appResult, teams: [] }
		const url = resolveAppUrl(noTeamsApp, "/seksjoner/pensjon-og-ufore")
		expect(url).toBe("/applikasjoner/app-123/detaljer")
	})

	it("returns fallback URL when app teams is undefined", () => {
		const noTeamsApp = { ...appResult, teams: undefined }
		const url = resolveAppUrl(noTeamsApp, "/seksjoner/pensjon-og-ufore")
		expect(url).toBe("/applikasjoner/app-123/detaljer")
	})
})
