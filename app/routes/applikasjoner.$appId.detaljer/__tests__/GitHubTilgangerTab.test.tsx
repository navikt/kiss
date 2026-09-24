import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it } from "vitest"
import { GitHubTilgangerTab } from "../tabs/GitHubTilgangerTab"

afterEach(cleanup)

const syncedAt = "2026-06-01T10:00:00Z"

describe("GitHubTilgangerTab", () => {
	it("shows display name, GitHub username and NAV ident for a resolved user", () => {
		render(
			<GitHubTilgangerTab
				teams={[]}
				collaborators={[
					{
						id: "collaborator-1",
						username: "glad-fjord",
						displayName: "Glad Fjord",
						navIdent: "Z990001",
						permission: "admin",
						syncedAt,
					},
				]}
				changeLog={[]}
				sharedApplications={[]}
			/>,
		)

		expect(screen.getAllByText("Glad Fjord")).toHaveLength(2)
		expect(screen.getAllByRole("link", { name: "@glad-fjord" })).toHaveLength(2)
		expect(screen.getAllByText("Z990001")).toHaveLength(2)
	})

	it("falls back to GitHub username when display name is blank", () => {
		render(
			<GitHubTilgangerTab
				teams={[]}
				collaborators={[
					{
						id: "collaborator-1",
						username: "glad-fjord",
						displayName: "  ",
						navIdent: " ",
						permission: "admin",
						syncedAt,
					},
				]}
				changeLog={[]}
				sharedApplications={[]}
			/>,
		)

		expect(screen.getAllByRole("link", { name: "glad-fjord" })).toHaveLength(2)
	})

	it("shows enriched details for team members", () => {
		render(
			<GitHubTilgangerTab
				teams={[
					{
						id: "team-1",
						teamSlug: "sikkerhet",
						teamName: "Sikkerhet",
						permission: "push",
						syncedAt,
						members: [
							{
								username: "rask-elv",
								displayName: "Rask Elv",
								navIdent: "Z990042",
								role: "member",
							},
						],
					},
				]}
				collaborators={[]}
				changeLog={[]}
				sharedApplications={[]}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: "Vis medlemmer av Sikkerhet" }))

		expect(screen.getAllByText("Rask Elv")).toHaveLength(2)
		expect(screen.getAllByRole("link", { name: "@rask-elv" })).toHaveLength(2)
		expect(screen.getAllByText("Z990042")).toHaveLength(2)
	})

	it("shows other applications that use the same repository", () => {
		render(
			<MemoryRouter>
				<GitHubTilgangerTab
					teams={[]}
					collaborators={[]}
					changeLog={[]}
					sharedApplications={[{ id: "app-2", name: "Kalkulator", gitRepository: "navikt/shared-repo" }]}
				/>
			</MemoryRouter>,
		)

		expect(screen.getByRole("heading", { name: "Andre applikasjoner med samme repository" })).toBeTruthy()
		expect(screen.getByRole("link", { name: "Kalkulator" }).getAttribute("href")).toBe("/applikasjoner/app-2/detaljer")
		expect(screen.getByText("navikt/shared-repo")).toBeTruthy()
	})
})
