import type { Meta, StoryObj } from "@storybook/react"
import type { ComponentProps } from "react"
import { createRoutesStub } from "react-router"
import { ParticipantsCombobox } from "../ParticipantsCombobox"

// ─── Helpers ────────────────────────────────────────────────────────

const graphApiRoute = {
	path: "/api/graph/users",
	loader: ({ request }: { request: Request }) => {
		const q = new URL(request.url).searchParams.get("q") ?? ""
		const all = [
			{ navIdent: "Z990010", displayName: "Klok Ugle", mail: "klok.ugle@nav.no" },
			{ navIdent: "Z990011", displayName: "Frisk Bekk", mail: "frisk.bekk@nav.no" },
			{ navIdent: "Z990012", displayName: "Rolig Dal", mail: "rolig.dal@nav.no" },
		]
		return { results: all.filter((u) => u.displayName.toLowerCase().includes(q.toLowerCase())) }
	},
}

function ParticipantsComboboxWrapper(props: ComponentProps<typeof ParticipantsCombobox>) {
	const Stub = createRoutesStub([
		{
			path: "/",
			Component: () => (
				<div style={{ maxWidth: 480, padding: "2rem" }}>
					<ParticipantsCombobox {...props} />
				</div>
			),
		},
		graphApiRoute,
	])
	return <Stub initialEntries={["/"]} />
}

// ─── Meta ───────────────────────────────────────────────────────────

const meta = {
	title: "Components/ParticipantsCombobox",
	component: ParticipantsComboboxWrapper,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ParticipantsComboboxWrapper>

export default meta
type Story = StoryObj<typeof meta>

// ─── Stories ────────────────────────────────────────────────────────

export const Tom: Story = {
	name: "Tom – ingen deltakere",
	args: {
		name: "participants",
		label: "Deltakere",
		description: "Søk opp og legg til deltakere via NAV-ident eller navn",
	},
}

export const MedStandarddeltakere: Story = {
	name: "Med forhåndsvalgte deltakere",
	args: {
		name: "participants",
		label: "Deltakere",
		defaultParticipants: [
			{ navIdent: "Z990001", displayName: "Glad Fjord" },
			{ navIdent: "Z990002", displayName: "Modig Bjørk" },
		],
	},
}

export const MedHurtigvalg: Story = {
	name: "Med hurtigvalg fra teamet",
	args: {
		name: "participants",
		label: "Deltakere",
		description: "Søk opp og legg til deltakere via NAV-ident eller navn",
		quickAddOptions: [
			{ navIdent: "Z990001", displayName: "Glad Fjord" },
			{ navIdent: "Z990002", displayName: "Modig Bjørk" },
			{ navIdent: "Z990003", displayName: "Rask Elv" },
			{ navIdent: "Z990004", displayName: "Stille Skog" },
			{ navIdent: "Z990005", displayName: "Varm Solstråle" },
		],
	},
}

export const MedHurtigvalgOgForhåndsvalgte: Story = {
	name: "Hurtigvalg – noen allerede lagt til",
	args: {
		name: "participants",
		label: "Deltakere",
		defaultParticipants: [
			{ navIdent: "Z990001", displayName: "Glad Fjord" },
			{ navIdent: "Z990003", displayName: "Rask Elv" },
		],
		quickAddOptions: [
			{ navIdent: "Z990001", displayName: "Glad Fjord" },
			{ navIdent: "Z990002", displayName: "Modig Bjørk" },
			{ navIdent: "Z990003", displayName: "Rask Elv" },
			{ navIdent: "Z990004", displayName: "Stille Skog" },
		],
	},
}
