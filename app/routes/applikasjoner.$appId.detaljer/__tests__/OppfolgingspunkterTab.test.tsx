import { cleanup, render, screen } from "@testing-library/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, describe, expect, it } from "vitest"

import { OppfolgingspunkterTab } from "../tabs/OppfolgingspunkterTab"

afterEach(cleanup)

function renderWithRouter(ui: React.ReactElement) {
	const router = createMemoryRouter([{ path: "/", element: ui }], {
		initialEntries: ["/"],
	})
	return render(<RouterProvider router={router} />)
}

const sectionSlugMap: Record<string, string> = {
	"s-01": "pensjon-og-ufore",
}

function makePoint(overrides: Partial<Parameters<typeof OppfolgingspunkterTab>[0]["followUpPoints"][0]> = {}) {
	return {
		id: "fup-1",
		reviewId: "rev-1",
		routineId: "routine-1",
		routineName: "Sikkerhetstesting",
		sectionId: "s-01",
		reviewTitle: "Gjennomgang Q1 2026",
		reviewedAt: "2026-03-01T10:00:00Z",
		text: "Automatisert pentest mangler",
		description: null,
		resolution: null,
		status: "needs_follow_up" as const,
		createdBy: "A123456",
		resolvedAt: null,
		resolvedBy: null,
		...overrides,
	}
}

describe("OppfolgingspunkterTab", () => {
	it("viser tom-tekst når det ikke er noen oppfølgingspunkter", () => {
		renderWithRouter(<OppfolgingspunkterTab followUpPoints={[]} sectionSlugMap={sectionSlugMap} />)
		expect(screen.getByText(/Ingen oppfølgingspunkter er registrert/)).toBeDefined()
	})

	it("viser tabellen når det finnes oppfølgingspunkter", () => {
		renderWithRouter(<OppfolgingspunkterTab followUpPoints={[makePoint()]} sectionSlugMap={sectionSlugMap} />)
		expect(screen.getByText("Automatisert pentest mangler")).toBeDefined()
		expect(screen.queryByText(/Ingen oppfølgingspunkter/)).toBeNull()
	})

	it("sorterer needs_follow_up før completed", () => {
		const points = [
			makePoint({ id: "fup-2", text: "Løst punkt", status: "completed", reviewedAt: "2026-03-01T10:00:00Z" }),
			makePoint({ id: "fup-1", text: "Åpent punkt", status: "needs_follow_up", reviewedAt: "2026-03-01T10:00:00Z" }),
		]
		renderWithRouter(<OppfolgingspunkterTab followUpPoints={points} sectionSlugMap={sectionSlugMap} />)
		const rows = screen.getAllByRole("row")
		// rows[0] = header, rows[1] = first data row, rows[2] = second
		expect(rows[1].textContent).toContain("Åpent punkt")
		expect(rows[2].textContent).toContain("Løst punkt")
	})

	it("sorterer nyere gjennomganger først innen samme status", () => {
		const points = [
			makePoint({
				id: "fup-1",
				text: "Gammelt åpent punkt",
				status: "needs_follow_up",
				reviewedAt: "2025-01-01T00:00:00Z",
			}),
			makePoint({
				id: "fup-2",
				text: "Nytt åpent punkt",
				status: "needs_follow_up",
				reviewedAt: "2026-06-01T00:00:00Z",
			}),
		]
		renderWithRouter(<OppfolgingspunkterTab followUpPoints={points} sectionSlugMap={sectionSlugMap} />)
		const rows = screen.getAllByRole("row")
		expect(rows[1].textContent).toContain("Nytt åpent punkt")
		expect(rows[2].textContent).toContain("Gammelt åpent punkt")
	})

	it("viser resolution selv om status er needs_follow_up", () => {
		const point = makePoint({ resolution: "Delvis fikset, følger opp" })
		renderWithRouter(<OppfolgingspunkterTab followUpPoints={[point]} sectionSlugMap={sectionSlugMap} />)
		expect(screen.getByText(/Delvis fikset, følger opp/)).toBeDefined()
		expect(screen.getByText(/Oppfølging:/)).toBeDefined()
	})

	it("viser lenke til gjennomgang når sectionId er kjent", () => {
		renderWithRouter(<OppfolgingspunkterTab followUpPoints={[makePoint()]} sectionSlugMap={sectionSlugMap} />)
		const link = screen.getByRole("link", { name: "Gjennomgang Q1 2026" })
		expect(link.getAttribute("href")).toContain("/seksjoner/pensjon-og-ufore/rutiner/routine-1/gjennomgang/rev-1")
	})

	it("viser ikke lenke når sectionId ikke finnes i sectionSlugMap", () => {
		const point = makePoint({ sectionId: "ukjent-seksjon" })
		renderWithRouter(<OppfolgingspunkterTab followUpPoints={[point]} sectionSlugMap={sectionSlugMap} />)
		expect(screen.queryByRole("link", { name: "Gjennomgang Q1 2026" })).toBeNull()
		expect(screen.getByText("Gjennomgang Q1 2026")).toBeDefined()
	})
})
