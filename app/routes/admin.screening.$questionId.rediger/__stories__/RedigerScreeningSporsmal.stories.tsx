import type { Meta, StoryObj } from "@storybook/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import EditScreeningQuestion from "~/routes/admin.screening.$questionId.rediger"
import { eksisterendeSporsmalData, godkjentSporsmalData, nyttSporsmalData } from "./mock-data"

/**
 * Wrapper that provides React Router context and mocks loader data.
 * The component uses useLoaderData(), so we inject data via the route loader.
 */
function StoryWrapper({ loaderData }: { loaderData: unknown }) {
	const router = createMemoryRouter(
		[
			{
				path: "/",
				element: <EditScreeningQuestion />,
				loader: () => loaderData,
				action: async () => ({ success: true }),
			},
		],
		{ initialEntries: ["/"] },
	)
	return (
		<div style={{ maxWidth: "80rem", margin: "0 auto", padding: "2rem" }}>
			<RouterProvider router={router} />
		</div>
	)
}

// ─── Meta ─────────────────────────────────────────────────────────────────────

const meta = {
	title: "Screening/Rediger screening-spørsmål",
	parameters: {
		layout: "fullscreen",
	},
} satisfies Meta

export default meta
type Story = StoryObj

// ─── Stories ──────────────────────────────────────────────────────────────────

/**
 * Tomt skjema for nytt spørsmål.
 * Velg svartype «Egendefinerte valg» for å aktivere valgmuligheter og effekter.
 */
export const NyttSporsmal: Story = {
	name: "Nytt spørsmål (tomt skjema)",
	render: () => <StoryWrapper loaderData={nyttSporsmalData} />,
}

/**
 * Eksisterende boolean-spørsmål — «Ja/Nei»-valg er faste,
 * viser add-effekt-skjema under hvert valg.
 * Prøv å velge «Valgt rutine» i effekt-dropdownen for å se rutinevalget dukke opp.
 */
export const NyttBooleanSporsmal: Story = {
	name: "Nytt boolean-spørsmål (Ja/Nei forhåndsvalgt)",
	render: () => (
		<StoryWrapper
			loaderData={{
				...nyttSporsmalData,
				question: { ...nyttSporsmalData.question, answerType: "boolean" },
			}}
		/>
	),
}

/**
 * Eksisterende spørsmål med alle fire effekttyper:
 * - «Ja, med fast rutine»  → effekt: **Valgt rutine** (preset_routine) — rutinen vises i tabellen
 * - «Ja, velg rutine selv» → effekt: **Velg rutine** (select_routine) — ingen rutine i tabellen
 * - «Nei, ikke relevant»   → effekt: **Ikke relevant**
 * - «Nei»                  → effekt: Ingen (null)
 *
 * Add-effekt-skjema nederst: velg «Valgt rutine» for å se rutine-dropdown dukke opp umiddelbart.
 */
export const AlleEffekttyper: Story = {
	name: "Eksisterende spørsmål – alle effekttyper",
	render: () => <StoryWrapper loaderData={eksisterendeSporsmalData} />,
}

/**
 * Godkjent spørsmål (status=approved).
 * Viser «Tilbakestill til kladd»-knapp men ikke «Godkjenn» (allerede godkjent).
 */
export const GodkjentSporsmal: Story = {
	name: "Godkjent spørsmål (status=approved)",
	render: () => <StoryWrapper loaderData={godkjentSporsmalData} />,
}
