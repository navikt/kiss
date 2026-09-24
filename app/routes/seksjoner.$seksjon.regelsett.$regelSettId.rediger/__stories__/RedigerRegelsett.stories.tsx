import type { Meta, StoryObj } from "@storybook/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import RegelsettRediger from "~/routes/seksjoner.$seksjon.regelsett.$regelSettId.rediger"
import {
	arkivertRegelsetData,
	godkjentRegelsetData,
	regelsetMedEndringskontrollData,
	regelsetMedTilgangskontrollData,
	regelsetUtenKategoriData,
} from "./mock-data"

/**
 * Wrapper that provides React Router context and mocks loader data.
 * The component uses useLoaderData(), so we inject data via the route loader.
 */
function StoryWrapper({ loaderData }: { loaderData: unknown }) {
	const router = createMemoryRouter(
		[
			{
				path: "/",
				element: <RegelsettRediger />,
				loader: () => loaderData,
				action: async () => ({ success: true, message: "Regelsettet er oppdatert." }),
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
	title: "Regelsett/Rediger regelsett",
	parameters: {
		layout: "fullscreen",
	},
} satisfies Meta

export default meta
type Story = StoryObj

// ─── Stories ──────────────────────────────────────────────────────────────────

/**
 * Regelsett i kladd (aldri godkjent) uten kategori satt.
 * «Kategori»-feltet vises nederst i skjemaet med «— Ingen kategori —» som default.
 * Velg en kategori og lagre for å se at den persisteres.
 */
export const RegelsetUtenKategori: Story = {
	name: "Kladd – uten kategori",
	render: () => <StoryWrapper loaderData={regelsetUtenKategoriData} />,
}

/**
 * Regelsett i kladd med kategori «Tilgangskontroll».
 * «Kategori»-feltet er forhåndsvalgt til «Tilgangskontroll».
 * Dette styrer hvilke screening-spørsmål kan begrense til å kun vise dette regelsettet.
 */
export const RegelsetMedTilgangskontroll: Story = {
	name: "Kladd – kategori: Tilgangskontroll",
	render: () => <StoryWrapper loaderData={regelsetMedTilgangskontrollData} />,
}

/**
 * Regelsett i kladd med kategori «Endringskontroll».
 * Demonstrerer den andre tilgjengelige kategorien.
 */
export const RegelsetMedEndringskontroll: Story = {
	name: "Kladd – kategori: Endringskontroll",
	render: () => <StoryWrapper loaderData={regelsetMedEndringskontrollData} />,
}

/**
 * Godkjent regelsett med kategori «Tilgangskontroll».
 * Godkjente regelsett kan ikke redigeres direkte (heller ikke av admin) —
 * siden viser i stedet en «Kopier for redigering»-knapp som oppretter en
 * ny kladd basert på dette regelsettet.
 */
export const GodkjentRegelsett: Story = {
	name: "Godkjent regelsett – kategori: Tilgangskontroll",
	render: () => <StoryWrapper loaderData={godkjentRegelsetData} />,
}

/**
 * Arkivert regelsett.
 * Viser advarsel om at regelsettet er arkivert og skjemaet er skrivebeskyttet.
 * Kategori vises i read-only-modus.
 */
export const ArkivertRegelsett: Story = {
	name: "Arkivert regelsett",
	render: () => <StoryWrapper loaderData={arkivertRegelsetData} />,
}
