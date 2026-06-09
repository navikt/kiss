import type { Meta, StoryObj } from "@storybook/react"
import { createRoutesStub } from "react-router"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { OpprettSeksjonModal } from "../OpprettSeksjonModal"

// ─── Helpers ────────────────────────────────────────────────────────

const graphApiRoute = {
	path: "/api/graph/users",
	loader: ({ request }: { request: Request }) => {
		const q = new URL(request.url).searchParams.get("q") ?? ""
		const all = [
			{ navIdent: "Z990001", displayName: "Glad Fjord", mail: "glad.fjord@nav.no" },
			{ navIdent: "Z990002", displayName: "Rask Elv", mail: "rask.elv@nav.no" },
			{ navIdent: "Z990003", displayName: "Stille Skog", mail: "stille.skog@nav.no" },
		]
		return { results: all.filter((u) => u.displayName.toLowerCase().includes(q.toLowerCase())) }
	},
}

// Capture last submitted form data for assertions in interaction tests
let lastSubmit: Record<string, string> = {}

const adminSeksjonerRoute = {
	path: "/admin/seksjoner",
	action: async ({ request }: { request: Request }) => {
		const formData = await request.formData()
		lastSubmit = Object.fromEntries(formData.entries()) as Record<string, string>
		const name = formData.get("name")
		if (name === "Konflikt") {
			return { success: false, error: `En seksjon med navn «Konflikt» finnes allerede. Velg et annet navn.` }
		}
		return { success: true, message: `Seksjon «${name}» opprettet.` }
	},
}

function ModalWrapper({ open = true }: { open?: boolean }) {
	const Stub = createRoutesStub([
		{
			path: "/",
			Component: () => <OpprettSeksjonModal open={open} onClose={() => {}} />,
		},
		graphApiRoute,
		adminSeksjonerRoute,
	])
	return <Stub initialEntries={["/"]} />
}

// ─── Meta ───────────────────────────────────────────────────────────

const meta = {
	title: "Components/OpprettSeksjonModal",
	component: ModalWrapper,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ModalWrapper>

export default meta
type Story = StoryObj<typeof meta>

// ─── Stories ────────────────────────────────────────────────────────

export const Aapen: Story = {
	name: "Åpen modal – tom",
	args: { open: true },
}

export const Lukket: Story = {
	name: "Lukket modal",
	args: { open: false },
}

export const OpprettSeksjonFullFlyt: Story = {
	name: "Full flyt: navn + seksjonsleder + teknologileder → action mottar korrekte verdier",
	args: { open: true },
	play: async ({ canvasElement }) => {
		lastSubmit = {}
		const canvas = within(canvasElement)

		// 1. Navn på seksjon
		await userEvent.type(canvas.getByRole("textbox", { name: /Navn/i }), "Ny testseksjon")

		// 2. Søk og velg seksjonsleder
		const seksjonslederInput = canvas.getByRole("combobox", { name: /Seksjonsleder/i })
		await userEvent.type(seksjonslederInput, "Glad")
		await waitFor(() => canvas.getByRole("option", { name: /Glad Fjord/i }))
		await userEvent.click(canvas.getByRole("option", { name: /Glad Fjord/i }))
		await waitFor(() => expect(seksjonslederInput).toHaveValue("Glad Fjord (Z990001)"))

		// 3. Søk og velg teknologileder — seksjonsleder skal beholdes under dette
		const teknologilederInput = canvas.getByRole("combobox", { name: /Teknologileder/i })
		await userEvent.type(teknologilederInput, "Rask")
		await waitFor(() => canvas.getByRole("option", { name: /Rask Elv/i }))
		await userEvent.click(canvas.getByRole("option", { name: /Rask Elv/i }))
		await waitFor(() => expect(teknologilederInput).toHaveValue("Rask Elv (Z990002)"))

		// Verifiser at seksjonsleder ikke ble nullstilt da teknologileder ble valgt
		expect(seksjonslederInput).toHaveValue("Glad Fjord (Z990001)")

		// 4. Send inn skjemaet
		await userEvent.click(canvas.getByRole("button", { name: /Opprett seksjon/i }))

		// 5. Verifiser at action mottok navn, seksjonsleder og teknologileder
		await waitFor(() => {
			expect(lastSubmit.name).toBe("Ny testseksjon")
			const leader = JSON.parse(lastSubmit.sectionLeader ?? "{}")
			expect(leader.navIdent).toBe("Z990001")
			expect(leader.displayName).toBe("Glad Fjord")
			const tech = JSON.parse(lastSubmit.techLead ?? "{}")
			expect(tech.navIdent).toBe("Z990002")
			expect(tech.displayName).toBe("Rask Elv")
		})
	},
}
