import type { Meta, StoryObj } from "@storybook/react"
import type { ComponentProps } from "react"
import { createRoutesStub } from "react-router"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { PersonSingleCombobox } from "../PersonSingleCombobox"

// ─── Helpers ────────────────────────────────────────────────────────

const graphApiRoute = {
	path: "/api/graph/users",
	loader: ({ request }: { request: Request }) => {
		const q = new URL(request.url).searchParams.get("q") ?? ""
		const all = [
			{ navIdent: "Z990001", displayName: "Glad Fjord", mail: "glad.fjord@nav.no" },
			{ navIdent: "Z990002", displayName: "Rask Elv", mail: "rask.elv@nav.no" },
			{ navIdent: "Z990003", displayName: "Stille Skog", mail: "stille.skog@nav.no" },
			{ navIdent: "Z990004", displayName: "Modig Bjørk", mail: null },
			{ navIdent: "Z990005", displayName: null, mail: null },
		]
		return {
			results: all.filter((u) => {
				if (!u.displayName) return u.navIdent.toLowerCase().includes(q.toLowerCase())
				return u.displayName.toLowerCase().includes(q.toLowerCase())
			}),
		}
	},
}

function PersonSingleComboboxWrapper(props: ComponentProps<typeof PersonSingleCombobox>) {
	const Stub = createRoutesStub([
		{
			path: "/",
			Component: () => (
				<div style={{ maxWidth: 480, padding: "2rem" }}>
					<PersonSingleCombobox {...props} />
				</div>
			),
		},
		graphApiRoute,
	])
	return <Stub initialEntries={["/"]} />
}

// ─── Meta ───────────────────────────────────────────────────────────

const meta = {
	title: "Components/PersonSingleCombobox",
	component: PersonSingleComboboxWrapper,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PersonSingleComboboxWrapper>

export default meta
type Story = StoryObj<typeof meta>

// ─── Stories ────────────────────────────────────────────────────────

export const Tom: Story = {
	name: "Tom – ingen valgt",
	args: {
		name: "person",
		label: "Seksjonsleder",
		description: "Søk på navn eller NAV-ident",
		required: true,
	},
}

export const MedForhåndsvalgt: Story = {
	name: "Med forhåndsvalgt person",
	args: {
		name: "person",
		label: "Seksjonsleder",
		description: "Søk på navn eller NAV-ident",
		defaultValue: { navIdent: "Z990001", displayName: "Glad Fjord" },
	},
}

export const Valgfri: Story = {
	name: "Valgfri (ikke required)",
	args: {
		name: "person",
		label: "Teknologileder",
		description: "Søk på navn eller NAV-ident (valgfritt)",
		required: false,
	},
}

export const ValgtPersonVises: Story = {
	name: "Viser valgt persons navn i inputfeltet etter valg",
	args: {
		name: "person",
		label: "Seksjonsleder",
		description: "Søk på navn eller NAV-ident",
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		const input = canvas.getByRole("combobox")

		await userEvent.type(input, "Glad")
		await waitFor(() => canvas.getByRole("option", { name: /Glad Fjord/i }))
		await userEvent.click(canvas.getByRole("option", { name: /Glad Fjord/i }))

		await waitFor(() => {
			const hidden = canvasElement.querySelector('input[type="hidden"][name="person"]') as HTMLInputElement
			const parsed = JSON.parse(hidden.value || "{}")
			expect(parsed.navIdent).toBe("Z990001")
			expect(parsed.displayName).toBe("Glad Fjord")
		})
	},
}

export const IdentUtenDuplikatVedManglendeVisningsnavn: Story = {
	name: "Viser kun ident (uten dobbel parentes) når visningsnavn mangler",
	args: {
		name: "person",
		label: "Seksjonsleder",
		description: "Søk på navn eller NAV-ident",
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		const input = canvas.getByRole("combobox")

		await userEvent.type(input, "Z990005")
		await waitFor(() => canvas.getByRole("option", { name: /Z990005/i }))
		await userEvent.click(canvas.getByRole("option", { name: /Z990005/i }))

		await waitFor(() => {
			const hidden = canvasElement.querySelector('input[type="hidden"][name="person"]') as HTMLInputElement
			const parsed = JSON.parse(hidden.value || "{}")
			expect(parsed.navIdent).toBe("Z990005")
			// displayName skal falle tilbake til ident — ikke dobbel parentes i UI
			expect(parsed.displayName).toBe("Z990005")
		})
	},
}
