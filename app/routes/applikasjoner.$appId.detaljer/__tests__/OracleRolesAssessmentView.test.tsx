import { cleanup, render, screen } from "@testing-library/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, describe, expect, it } from "vitest"

import { OracleRolesAssessmentView } from "../components/OracleRolesAssessmentView"

afterEach(cleanup)

function renderWithRouter(ui: React.ReactElement) {
	const router = createMemoryRouter([{ path: "/", element: ui }], {
		initialEntries: ["/"],
	})
	return render(<RouterProvider router={router} />)
}

const emptyAssessments = {}

const assessments = {
	"pensjon-db-01:APP_USER": { criticality: "high" as const, updatedBy: "Z990001", updatedAt: "2026-04-15T10:00:00Z" },
	"pensjon-db-01:BATCH_ROLE": { criticality: "low" as const, updatedBy: "Z990002", updatedAt: "2026-04-15T11:00:00Z" },
	"pensjon-db-02:CONNECT": {
		criticality: "very_high" as const,
		updatedBy: "Z990001",
		updatedAt: "2026-04-16T08:00:00Z",
	},
}

const sourceReview = {
	reviewId: "rev-1",
	title: "Oracle-gjennomgang Q2 2026",
	reviewedAt: "2026-04-15T00:00:00Z",
	gjennomgangUrl: "/seksjoner/pensjon/rutiner/rut-1/gjennomgang/rev-1",
}

describe("OracleRolesAssessmentView", () => {
	describe("tom tilstand", () => {
		it("viser tom-melding når ingen vurderinger finnes", () => {
			renderWithRouter(<OracleRolesAssessmentView assessments={emptyAssessments} sourceReview={null} />)
			expect(screen.getByText(/Ingen kritikalitetsvurdering av Oracle-roller er registrert/)).toBeDefined()
		})

		it("viser tom-melding med hint om å fullføre rutinegjennomgang", () => {
			renderWithRouter(<OracleRolesAssessmentView assessments={emptyAssessments} sourceReview={null} />)
			expect(screen.getByText(/Fullfør en rutinegjennomgang med Oracle-rollekritikalitet/)).toBeDefined()
		})

		it("viser ingen tabell ved tom tilstand", () => {
			renderWithRouter(<OracleRolesAssessmentView assessments={emptyAssessments} sourceReview={null} />)
			expect(screen.queryByRole("table")).toBeNull()
		})
	})

	describe("med vurderinger", () => {
		it("viser overskrift med antall roller", () => {
			renderWithRouter(<OracleRolesAssessmentView assessments={assessments} sourceReview={null} />)
			expect(screen.getByText("Oracle Database-roller (3)")).toBeDefined()
		})

		it("viser alle roller i tabellen", () => {
			renderWithRouter(<OracleRolesAssessmentView assessments={assessments} sourceReview={null} />)
			expect(screen.getByText("APP_USER")).toBeDefined()
			expect(screen.getByText("BATCH_ROLE")).toBeDefined()
			expect(screen.getByText("CONNECT")).toBeDefined()
		})

		it("viser instansnavn i store bokstaver", () => {
			renderWithRouter(<OracleRolesAssessmentView assessments={assessments} sourceReview={null} />)
			expect(screen.getAllByText("PENSJON-DB-01").length).toBeGreaterThan(0)
		})

		it("viser kritikalitetsetikett for roller", () => {
			renderWithRouter(<OracleRolesAssessmentView assessments={assessments} sourceReview={null} />)
			expect(screen.getByText("Høy")).toBeDefined()
			expect(screen.getByText("Lav")).toBeDefined()
			expect(screen.getByText("Svært høy")).toBeDefined()
		})

		it("sorterer roller alfabetisk på instans og deretter rolle", () => {
			renderWithRouter(<OracleRolesAssessmentView assessments={assessments} sourceReview={null} />)
			const rows = screen.getAllByRole("row")
			// rows[0] = header; rows[1..3] = data rows sorted by instanceId then roleName
			expect(rows[1].textContent).toContain("APP_USER")
			expect(rows[2].textContent).toContain("BATCH_ROLE")
			expect(rows[3].textContent).toContain("CONNECT")
		})
	})

	describe("kilde-gjennomgang", () => {
		it("viser lenke til gjennomgangen når gjennomgangUrl finnes", () => {
			renderWithRouter(<OracleRolesAssessmentView assessments={assessments} sourceReview={sourceReview} />)
			const link = screen.getByRole("link", { name: "Oracle-gjennomgang Q2 2026" })
			expect(link).toBeDefined()
			expect(link.getAttribute("href")).toBe("/seksjoner/pensjon/rutiner/rut-1/gjennomgang/rev-1")
		})

		it("viser tittel som ren tekst når gjennomgangUrl mangler", () => {
			renderWithRouter(
				<OracleRolesAssessmentView
					assessments={assessments}
					sourceReview={{ ...sourceReview, gjennomgangUrl: null }}
				/>,
			)
			expect(screen.getByText(/Oracle-gjennomgang Q2 2026/)).toBeDefined()
			expect(screen.queryByRole("link", { name: "Oracle-gjennomgang Q2 2026" })).toBeNull()
		})

		it("viser ikke kildereferanse i tom tilstand", () => {
			renderWithRouter(<OracleRolesAssessmentView assessments={emptyAssessments} sourceReview={sourceReview} />)
			expect(screen.queryByText(/Fra gjennomgang/)).toBeNull()
		})
	})
})
