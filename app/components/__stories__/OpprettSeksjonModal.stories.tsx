import type { Meta, StoryObj } from "@storybook/react"
import { createRoutesStub } from "react-router"
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

const adminSeksjonerRoute = {
	path: "/admin/seksjoner",
	action: async ({ request }: { request: Request }) => {
		const formData = await request.formData()
		const name = formData.get("name")
		// Simuler slug-konflikt for navn "Konflikt"
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
