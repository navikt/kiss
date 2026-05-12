import { render, screen } from "@testing-library/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { describe, expect, it } from "vitest"
import { PersisteringTab } from "../tabs/PersisteringTab"

function renderWithRouter(ui: React.ReactElement) {
	const router = createMemoryRouter([{ path: "/", element: ui, action: async () => ({ ok: true }) }], {
		initialEntries: ["/"],
	})
	return render(<RouterProvider router={router} />)
}

const defaultProps = {
	persistence: [],
	oracleAuditSummaries: {},
	oracleRoles: [],
	canAdmin: false,
}

describe("PersisteringTab – inaccessibleOracleGroups alert", () => {
	it("does not render alert when inaccessibleOracleGroups is empty", () => {
		renderWithRouter(<PersisteringTab {...defaultProps} inaccessibleOracleGroups={[]} />)
		expect(screen.queryByText(/Du mangler tilgang/)).toBeNull()
	})

	it("does not render alert when inaccessibleOracleGroups is omitted", () => {
		renderWithRouter(<PersisteringTab {...defaultProps} />)
		expect(screen.queryByText(/Du mangler tilgang/)).toBeNull()
	})

	it("renders alert with single group name", () => {
		renderWithRouter(
			<PersisteringTab {...defaultProps} inaccessibleOracleGroups={[{ id: "g1", name: "Oracle-Prod-Readers" }]} />,
		)
		expect(screen.getByText(/Du mangler tilgang/)).toBeDefined()
		expect(screen.getByText("Oracle-Prod-Readers")).toBeDefined()
		expect(screen.getByText(/Entra ID-gruppe:/)).toBeDefined()
	})

	it("renders alert with multiple group names and plural form", () => {
		renderWithRouter(
			<PersisteringTab
				{...defaultProps}
				inaccessibleOracleGroups={[
					{ id: "g1", name: "Oracle-Prod-Readers" },
					{ id: "g2", name: "Oracle-Test-Readers" },
				]}
			/>,
		)
		expect(screen.getByText(/Entra ID-grupper:/)).toBeDefined()
		expect(screen.getAllByText("Oracle-Prod-Readers").length).toBeGreaterThan(0)
		expect(screen.getAllByText("Oracle-Test-Readers").length).toBeGreaterThan(0)
	})
})
