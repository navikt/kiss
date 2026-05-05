import type { Meta, StoryObj } from "@storybook/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { EconomySystemSection } from "../components/EconomySystemSection"

function DataRouterWrapper({ children }: { children: React.ReactNode }) {
	const router = createMemoryRouter([{ path: "/", element: children }], { initialEntries: ["/"] })
	return <RouterProvider router={router} />
}

const meta = {
	title: "Screening/EconomySystemSection",
	component: EconomySystemSection,
	decorators: [
		(Story) => (
			<DataRouterWrapper>
				<div style={{ maxWidth: "700px", padding: "var(--ax-space-8)" }}>
					<Story />
				</div>
			</DataRouterWrapper>
		),
	],
} satisfies Meta<typeof EconomySystemSection>
export default meta
type Story = StoryObj<typeof meta>

export const NyKlassifisering: Story = {
	name: "Ny klassifisering (tom)",
	args: {
		classification: null,
		questionId: "q-economy-1",
		confirmed: false,
	},
}

export const KlassifisertSomOkonomisystem: Story = {
	name: "Klassifisert som økonomisystem",
	args: {
		classification: {
			id: "ec-1",
			isEconomySystem: true,
			economySystemType: "hjelpesystem",
			justification:
				"Applikasjonen fatter vedtak som forplikter Nav økonomisk og produserer grunnlag for bokførte transaksjoner i hovedbok.",
			validFrom: "2026-03-01T00:00:00Z",
			validUntil: "2027-03-01T00:00:00Z",
		},
		questionId: "q-economy-1",
		confirmed: true,
	},
}

export const KlassifisertSomIkkeOkonomisystem: Story = {
	name: "Klassifisert som IKKE økonomisystem",
	args: {
		classification: {
			id: "ec-2",
			isEconomySystem: false,
			economySystemType: null,
			justification:
				"Applikasjonen er et rent informasjonssystem uten påvirkning på økonomiske disposisjoner eller bokførte transaksjoner.",
			validFrom: "2026-01-15T00:00:00Z",
			validUntil: "2027-01-15T00:00:00Z",
		},
		questionId: "q-economy-1",
		confirmed: true,
	},
}

export const UtloptKlassifisering: Story = {
	name: "Utløpt klassifisering (trenger revisjon)",
	args: {
		classification: {
			id: "ec-3",
			isEconomySystem: true,
			economySystemType: "regnskapssystem",
			justification: "Systemet inneholder hovedbok og reskontro for Nav.",
			validFrom: "2024-11-01T00:00:00Z",
			validUntil: "2025-11-01T00:00:00Z",
			isExpired: true,
		},
		questionId: "q-economy-1",
		confirmed: true,
	},
}

export const UtloptNeiKlassifisering: Story = {
	name: "Utløpt NEI-klassifisering (trenger revisjon)",
	args: {
		classification: {
			id: "ec-3b",
			isEconomySystem: false,
			economySystemType: null,
			justification: "Applikasjonen har kun lesende tilgang til økonomidata.",
			validFrom: "2024-06-01T00:00:00Z",
			validUntil: "2025-06-01T00:00:00Z",
			isExpired: true,
		},
		questionId: "q-economy-1",
		confirmed: true,
	},
}

export const Fakturabehandling: Story = {
	name: "Fakturabehandlingssystem",
	args: {
		classification: {
			id: "ec-4",
			isEconomySystem: true,
			economySystemType: "fakturabehandling",
			justification: "Systemet håndterer innkommende fakturaer og videresender til reskontro.",
			validFrom: "2026-04-01T00:00:00Z",
			validUntil: "2027-04-01T00:00:00Z",
		},
		questionId: "q-economy-1",
		confirmed: true,
	},
}

export const Lonnssystem: Story = {
	name: "Lønnssystem",
	args: {
		classification: {
			id: "ec-5",
			isEconomySystem: true,
			economySystemType: "lonnssystem",
			justification: "Systemet beregner og utbetaler lønn for Nav-ansatte.",
			validFrom: "2026-02-15T00:00:00Z",
			validUntil: "2027-02-15T00:00:00Z",
		},
		questionId: "q-economy-1",
		confirmed: false,
	},
}

export const GyldigNesteManed: Story = {
	name: "Gyldig – utløper snart",
	args: {
		classification: {
			id: "ec-6",
			isEconomySystem: true,
			economySystemType: "hjelpesystem",
			justification: "Systemet beregner tilskudd som fører til utbetalinger.",
			validFrom: "2025-06-15T00:00:00Z",
			validUntil: "2026-06-15T00:00:00Z",
			isExpired: false,
		},
		questionId: "q-economy-1",
		confirmed: true,
	},
}

export const Regnskapssystem: Story = {
	name: "Type: Regnskapssystem",
	args: {
		classification: {
			id: "ec-7",
			isEconomySystem: true,
			economySystemType: "regnskapssystem",
			justification: "Hovedsystemet for regnskap og bokføring i Nav.",
			validFrom: "2026-01-01T00:00:00Z",
			validUntil: "2027-01-01T00:00:00Z",
			isExpired: false,
		},
		questionId: "q-economy-1",
		confirmed: true,
	},
}
