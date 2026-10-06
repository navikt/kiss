import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { createRoutesStub } from "react-router"
import { afterEach, describe, expect, it } from "vitest"
import NyGjennomgang from "../index"

afterEach(() => cleanup())

const path = "/seksjoner/:seksjon/rutiner/:rutineId/gjennomgang/ny"

function renderPage() {
	const Stub = createRoutesStub([
		{
			path,
			Component: NyGjennomgang,
			loader() {
				return {
					section: { id: "section-1", slug: "test-seksjon" },
					routine: { name: "Testrutine", isSectionRoutine: 0 },
					apps: [{ id: "app-1", name: "test-app" }],
					oracleInstancesByAppId: {},
					hasOracleActivity: false,
					loaderConflictError: null,
					currentUser: { navIdent: "Z990001", name: "Glad Fjord" },
				}
			},
		},
	])
	return render(<Stub initialEntries={["/seksjoner/test-seksjon/rutiner/routine-1/gjennomgang/ny"]} />)
}

function getParticipantsHiddenInput() {
	return document.querySelector('input[name="participants"]') as HTMLInputElement
}

describe("NyGjennomgang", () => {
	it("forhåndsutfyller innlogget bruker som deltaker", async () => {
		renderPage()
		// Venter til ruten er hydrert (loaderen i createRoutesStub kjører asynkront).
		await screen.findByRole("button", { name: /^Glad Fjord \(Z990001\)/ })
		const hidden = getParticipantsHiddenInput()
		expect(hidden).not.toBeNull()
		const participants = JSON.parse(hidden.value) as Array<{ navIdent: string; displayName: string | null }>
		expect(participants).toEqual([{ navIdent: "Z990001", displayName: "Glad Fjord" }])
	})

	it("lar brukeren fjerne seg selv som deltaker", async () => {
		renderPage()
		const removeButton = await screen.findByRole("button", { name: /^Glad Fjord \(Z990001\)/ })
		fireEvent.click(removeButton)

		const hidden = getParticipantsHiddenInput()
		const participants = JSON.parse(hidden.value) as Array<{ navIdent: string; displayName: string | null }>
		expect(participants).toEqual([])
	})
})
