import { describe, expect, it } from "vitest"
import { buildBreadcrumbs } from "../breadcrumbs"

// ─── Helpers ────────────────────────────────────────────────────────────────

function crumbLabels(crumbs: ReturnType<typeof buildBreadcrumbs>) {
	return crumbs.map((c) => c.label)
}

/** Format a date the same way reviewLabel does, to stay locale-agnostic in tests. */
function reviewDate(isoString: string) {
	return `Gjennomgang ${new Date(isoString).toLocaleDateString("nb-NO")}`
}

const REVIEW_DATE = "2026-04-01T10:00:00.000Z"
const REVIEW_LABEL = reviewDate(REVIEW_DATE)

// ─── buildBreadcrumbs ────────────────────────────────────────────────────────

describe("buildBreadcrumbs", () => {
	it("returns empty array for root path", () => {
		expect(buildBreadcrumbs("/", {}, {})).toEqual([])
	})

	it("returns empty array for unrecognised path", () => {
		expect(buildBreadcrumbs("/ukjent/sti", {}, {})).toEqual([])
	})

	// ── Seksjoner ──

	it("resolves seksjoner path", () => {
		const crumbs = buildBreadcrumbs("/seksjoner", {}, {})
		expect(crumbLabels(crumbs)).toEqual(["Seksjoner"])
		expect(crumbs[0].to).toBeNull() // last crumb has no link
	})

	it("resolves seksjon detail path using seksjonName from loader data", () => {
		const crumbs = buildBreadcrumbs(
			"/seksjoner/utvikling",
			{ seksjonName: "Seksjon Utvikling" },
			{ seksjon: "utvikling" },
		)
		expect(crumbLabels(crumbs)).toEqual(["Seksjoner", "Seksjon Utvikling"])
		expect(crumbs[0].to).toBe("/seksjoner")
		expect(crumbs[1].to).toBeNull()
	})

	it("resolves rutiner list path", () => {
		const crumbs = buildBreadcrumbs(
			"/seksjoner/utvikling/rutiner",
			{ seksjonName: "Utvikling" },
			{ seksjon: "utvikling" },
		)
		expect(crumbLabels(crumbs)).toEqual(["Seksjoner", "Utvikling", "Rutiner"])
		expect(crumbs[2].to).toBeNull()
	})

	it("resolves rutine detail path with routine name", () => {
		const crumbs = buildBreadcrumbs(
			"/seksjoner/utvikling/rutiner/abc-123",
			{ routine: { name: "Kvartalsvis tilgang" }, seksjonName: "Utvikling" },
			{ seksjon: "utvikling", rutineId: "abc-123" },
		)
		expect(crumbLabels(crumbs)).toEqual(["Seksjoner", "Utvikling", "Rutiner", "Kvartalsvis tilgang"])
		expect(crumbs[3].to).toBeNull()
	})

	// ── Gjennomgang (seksjon-rutine, no app) ──

	describe("gjennomgang without application", () => {
		const sectionData = {
			seksjonName: "Utvikling",
			routine: { name: "Kvartalsvis tilgang" },
			review: { reviewedAt: REVIEW_DATE, applicationName: null, applicationId: null },
		}
		const params = { seksjon: "utvikling", rutineId: "abc-123", gjennomgangId: "rev-456" }
		const path = "/seksjoner/utvikling/rutiner/abc-123/gjennomgang/rev-456"

		it("produces five crumbs (no app crumb)", () => {
			const crumbs = buildBreadcrumbs(path, sectionData, params)
			expect(crumbLabels(crumbs)).toEqual(["Seksjoner", "Utvikling", "Rutiner", "Kvartalsvis tilgang", REVIEW_LABEL])
		})

		it("last crumb has no link (current page)", () => {
			const crumbs = buildBreadcrumbs(path, sectionData, params)
			expect(crumbs.at(-1)?.to).toBeNull()
		})

		it("routine crumb links to rutine detail", () => {
			const crumbs = buildBreadcrumbs(path, sectionData, params)
			const routineCrumb = crumbs.find((c) => c.label === "Kvartalsvis tilgang")
			expect(routineCrumb?.to).toBe("/seksjoner/utvikling/rutiner/abc-123")
		})
	})

	// ── Gjennomgang (app-specific) ──

	describe("gjennomgang with application", () => {
		const appData = {
			seksjonName: "Utvikling",
			routine: { name: "Kvartalsvis tilgang" },
			review: {
				reviewedAt: REVIEW_DATE,
				applicationName: "pensjon-frontend",
				applicationId: "app-uuid-001",
			},
		}
		const params = { seksjon: "utvikling", rutineId: "abc-123", gjennomgangId: "rev-456" }
		const path = "/seksjoner/utvikling/rutiner/abc-123/gjennomgang/rev-456"

		it("inserts app name crumb between routine and review date", () => {
			const crumbs = buildBreadcrumbs(path, appData, params)
			expect(crumbLabels(crumbs)).toEqual([
				"Seksjoner",
				"Utvikling",
				"Rutiner",
				"Kvartalsvis tilgang",
				"pensjon-frontend",
				REVIEW_LABEL,
			])
		})

		it("app crumb links to section app detail page", () => {
			const crumbs = buildBreadcrumbs(path, appData, params)
			const appCrumb = crumbs.find((c) => c.label === "pensjon-frontend")
			expect(appCrumb?.to).toBe("/seksjoner/utvikling/applikasjoner/app-uuid-001/detaljer")
		})

		it("last crumb (review date) has no link", () => {
			const crumbs = buildBreadcrumbs(path, appData, params)
			expect(crumbs.at(-1)?.to).toBeNull()
		})

		it("routine crumb still links to rutine detail", () => {
			const crumbs = buildBreadcrumbs(path, appData, params)
			const routineCrumb = crumbs.find((c) => c.label === "Kvartalsvis tilgang")
			expect(routineCrumb?.to).toBe("/seksjoner/utvikling/rutiner/abc-123")
		})
	})

	describe("gjennomgang with applicationId but no applicationName", () => {
		const appData = {
			seksjonName: "Utvikling",
			routine: { name: "Kvartalsvis tilgang" },
			review: {
				reviewedAt: REVIEW_DATE,
				applicationName: null,
				applicationId: "app-uuid-001",
			},
		}
		const params = { seksjon: "utvikling", rutineId: "abc-123", gjennomgangId: "rev-456" }
		const path = "/seksjoner/utvikling/rutiner/abc-123/gjennomgang/rev-456"

		it("still inserts app crumb using applicationId as label", () => {
			const crumbs = buildBreadcrumbs(path, appData, params)
			expect(crumbLabels(crumbs)).toEqual([
				"Seksjoner",
				"Utvikling",
				"Rutiner",
				"Kvartalsvis tilgang",
				"app-uuid-001",
				REVIEW_LABEL,
			])
		})

		it("app crumb links to section app detail page", () => {
			const crumbs = buildBreadcrumbs(path, appData, params)
			const appCrumb = crumbs.find((c) => c.label === "app-uuid-001")
			expect(appCrumb?.to).toBe("/seksjoner/utvikling/applikasjoner/app-uuid-001/detaljer")
		})
	})

	// ── Ny gjennomgang ──

	it("resolves ny gjennomgang path", () => {
		const crumbs = buildBreadcrumbs(
			"/seksjoner/utvikling/rutiner/abc-123/gjennomgang/ny",
			{ seksjonName: "Utvikling", routine: { name: "Kvartalsvis tilgang" } },
			{ seksjon: "utvikling", rutineId: "abc-123" },
		)
		expect(crumbLabels(crumbs)).toEqual(["Seksjoner", "Utvikling", "Rutiner", "Kvartalsvis tilgang", "Ny gjennomgang"])
		expect(crumbs.at(-1)?.to).toBeNull()
	})

	// ── Condition / PathFn receive data ──

	it("condition prop skips segment when returning false", () => {
		// Reuse gjennomgang path with no applicationName — app crumb must not appear
		const crumbs = buildBreadcrumbs(
			"/seksjoner/utvikling/rutiner/abc-123/gjennomgang/rev-456",
			{ seksjonName: "Utvikling", routine: { name: "Ruten" }, review: { reviewedAt: "2026-01-01T00:00:00.000Z" } },
			{ seksjon: "utvikling", rutineId: "abc-123", gjennomgangId: "rev-456" },
		)
		const labels = crumbLabels(crumbs)
		expect(labels).not.toContain(undefined)
		expect(labels.filter((l) => l === "")).toHaveLength(0)
		expect(labels.length).toBe(5) // no app crumb
	})
})
