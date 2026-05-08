import { render, screen } from "@testing-library/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { describe, expect, it } from "vitest"
import { ScreeningerTab } from "../tabs/ScreeningerTab"

function renderWithRouter(ui: React.ReactElement) {
	const router = createMemoryRouter([{ path: "/", element: ui, action: async () => ({ ok: true }) }], {
		initialEntries: ["/"],
	})
	return render(<RouterProvider router={router} />)
}

describe("ScreeningerTab", () => {
	it("renders without crashing when screeningSessions is empty", () => {
		renderWithRouter(<ScreeningerTab screeningSessions={[]} appBasePath="/applikasjoner/app-1" canAdmin={false} />)
		expect(screen.getByText("Ingen screeninger er opprettet ennå.")).toBeDefined()
	})

	it("renders without crashing when screeningSessions is undefined", () => {
		// Simulates the case where loader data doesn't include screeningSessions
		renderWithRouter(
			<ScreeningerTab
				screeningSessions={undefined as unknown as []}
				appBasePath="/applikasjoner/app-1"
				canAdmin={false}
			/>,
		)
		expect(screen.getAllByText("Ingen screeninger er opprettet ennå.").length).toBeGreaterThan(0)
	})

	it("renders draft and completed sessions", () => {
		const sessions = [
			{
				id: "s-1",
				title: "Compliance-screening Q1",
				status: "draft",
				completedAt: null,
				completedBy: null,
				createdAt: "2026-01-15T10:00:00Z",
				createdBy: "Z991234",
				archivedAt: null,
				archivedBy: null,
				archiveReason: null,
				participants: [{ userIdent: "Z991234", userName: "Test Bruker" }],
			},
			{
				id: "s-2",
				title: "Compliance-screening Q4 2025",
				status: "completed",
				completedAt: "2025-12-20T14:00:00Z",
				completedBy: "Z995678",
				createdAt: "2025-12-01T10:00:00Z",
				createdBy: "Z995678",
				archivedAt: null,
				archivedBy: null,
				archiveReason: null,
				participants: [],
			},
		]
		renderWithRouter(
			<ScreeningerTab screeningSessions={sessions} appBasePath="/applikasjoner/app-1" canAdmin={false} />,
		)
		expect(screen.getByText("Påbegynte")).toBeDefined()
		expect(screen.getByText("Fullførte")).toBeDefined()
	})
})
