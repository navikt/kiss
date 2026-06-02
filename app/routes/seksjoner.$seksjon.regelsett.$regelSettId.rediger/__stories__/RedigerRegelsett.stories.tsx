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
 * Aktivt regelsett uten kategori satt.
 * «Kategori»-feltet vises nederst i skjemaet med «— Ingen kategori —» som default.
 * Velg en kategori og lagre for å se at den persisteres.
 */
export const RegelsetUtenKategori: Story = {
	name: "Aktivt regelsett – uten kategori",
	render: () => <StoryWrapper loaderData={regelsetUtenKategoriData} />,
}

/**
 * Aktivt regelsett med kategori «Tilgangskontroll».
 * «Kategori»-feltet er forhåndsvalgt til «Tilgangskontroll».
 * Dette styrer hvilke screening-spørsmål kan begrense til å kun vise dette regelsettet.
 */
export const RegelsetMedTilgangskontroll: Story = {
	name: "Aktivt regelsett – kategori: Tilgangskontroll",
	render: () => <StoryWrapper loaderData={regelsetMedTilgangskontrollData} />,
}

/**
 * Aktivt regelsett med kategori «Endringskontroll».
 * Demonstrerer den andre tilgjengelige kategorien.
 */
export const RegelsetMedEndringskontroll: Story = {
	name: "Aktivt regelsett – kategori: Endringskontroll",
	render: () => <StoryWrapper loaderData={regelsetMedEndringskontrollData} />,
}

/**
 * Godkjent regelsett med kategori «Tilgangskontroll».
 * Redigeringsknapper er deaktivert for ikke-admin-brukere,
 * men viser at kategori allerede er satt fra forrige versjon.
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
