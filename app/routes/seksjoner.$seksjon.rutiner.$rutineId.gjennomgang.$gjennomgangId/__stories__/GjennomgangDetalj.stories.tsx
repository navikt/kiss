import type { Meta, StoryObj } from "@storybook/react"
import { mockGjennomgangDetaljData, mockGjennomgangDetaljOracleEvidenceData } from "@storybook-mocks/data"
import type { ComponentType } from "react"
import { createRoutesStub } from "react-router"
import GjennomgangDetalj from "../index"

// ─── Helpers ────────────────────────────────────────────────────────

const ROUTE_PATH = "seksjoner/pensjon-og-ufore/rutiner/routine-1/gjennomgang/rev-1"
const BASE_URL = `/${ROUTE_PATH}`

const oracleApiRoutes = [
	{
		path: "/api/evidence-status",
		loader: () => ({
			providerType: "oracle",
			sourceLabel: "Pensjon Prod",
			collectedAt: "2026-03-01T10:00:00Z",
			externalUrl: "https://pensjon-oracle-revisjon.ansatt.nav.no/PENSJON_PROD/audit/review",
			items: [
				{
					id: "audit",
					label: "Oracle Unified Audit",
					status: "ok",
					formats: ["excel", "pdf"],
					canDownload: true,
					error: null,
				},
			],
			metadata: { instanceId: "PENSJON_PROD", instanceName: "Pensjon Prod" },
		}),
	},
	{
		path: "/api/evidence-download",
		action: () => ({
			success: true,
			download: { id: "dl-new", fileName: "evidence.xlsx", sizeBytes: 1000, source: "m2m_api" },
		}),
	},
]

const graphApiRoutes = [
	{
		path: "/api/graph/users",
		loader: () => ({
			results: [
				{ navIdent: "Z994433", displayName: "Varm Solstråle", mail: "varm.solstrale@nav.no" },
				{ navIdent: "Z995544", displayName: "Klok Ugle", mail: "klok.ugle@nav.no" },
			],
		}),
	},
]

// biome-ignore lint/suspicious/noExplicitAny: Route components have varying prop shapes from React Router
function renderWizard(Component: ComponentType<any>, loaderData: unknown, step?: string) {
	const initialEntry = step ? `${BASE_URL}?step=${step}` : BASE_URL
	const Stub = createRoutesStub([
		{ path: ROUTE_PATH, Component, loader: () => loaderData, action: async () => ({ ok: true }) },
		...oracleApiRoutes,
		...graphApiRoutes,
	])
	return <Stub initialEntries={[initialEntry]} />
}

// ─── Meta ───────────────────────────────────────────────────────────

const meta = {
	title: "Sider/Seksjoner/Rutiner/Gjennomgang/Wizard",
	component: GjennomgangDetalj,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof GjennomgangDetalj>
export default meta
type Story = StoryObj<typeof meta>

// ─── Wizard – Steg for steg (Utkast) ───────────────────────────────

export const Innledning: Story = {
	name: "Steg 1 – Innledning",
	render: () => renderWizard(GjennomgangDetalj, mockGjennomgangDetaljData({ status: "draft" }), "innledning"),
}

export const Krav: Story = {
	name: "Steg 2 – Krav",
	render: () => renderWizard(GjennomgangDetalj, mockGjennomgangDetaljData({ status: "draft" }), "krav"),
}

export const Regelsett: Story = {
	name: "Steg 3 – Regelsett",
	render: () => renderWizard(GjennomgangDetalj, mockGjennomgangDetaljData({ status: "draft" }), "regelsett"),
}

export const Rutine: Story = {
	name: "Steg 4 – Rutine",
	render: () => renderWizard(GjennomgangDetalj, mockGjennomgangDetaljData({ status: "draft" }), "rutine"),
}

export const Dokumentasjon: Story = {
	name: "Steg 5 – Dokumentasjon",
	render: () => renderWizard(GjennomgangDetalj, mockGjennomgangDetaljData({ status: "draft" }), "dokumentasjon"),
}

export const Oppfølgingspunkter: Story = {
	name: "Steg 6 – Oppfølgingspunkter",
	render: () =>
		renderWizard(
			GjennomgangDetalj,
			mockGjennomgangDetaljData({ status: "draft", followUpPoints: "mixed" }),
			"oppfolging",
		),
}

export const Fullfør: Story = {
	name: "Steg 7 – Fullfør",
	render: () =>
		renderWizard(GjennomgangDetalj, mockGjennomgangDetaljData({ status: "draft", followUpPoints: "mixed" }), "fullfor"),
}

// ─── Betingede steg ─────────────────────────────────────────────────

export const UtenKravOgRegelsett: Story = {
	name: "Uten krav og regelsett",
	render: () => {
		const data = {
			...mockGjennomgangDetaljData({ status: "draft" }),
			routine: {
				...mockGjennomgangDetaljData({ status: "draft" }).routine,
				controls: [],
			},
			linkedRulesets: [],
		}
		return renderWizard(GjennomgangDetalj, data)
	},
}

// ─── Oracle-aktivitet ───────────────────────────────────────────────

export const AktivitetOracle: Story = {
	name: "Aktivitet – Oracle evidence",
	render: () =>
		renderWizard(GjennomgangDetalj, mockGjennomgangDetaljOracleEvidenceData({ withDownloads: true }), "aktivitet"),
}

export const AktivitetOracleAlleTyper: Story = {
	name: "Aktivitet – Oracle alle typer",
	render: () =>
		renderWizard(
			GjennomgangDetalj,
			mockGjennomgangDetaljOracleEvidenceData({
				evidenceTypes: ["audit", "profiles", "roles", "users", "period"],
				withDownloads: true,
			}),
			"aktivitet",
		),
}

// ─── Fullført gjennomgang (read-only) ──────────────────────────────

export const FullførtInnledning: Story = {
	name: "Fullført – Innledning (read-only)",
	render: () =>
		renderWizard(
			GjennomgangDetalj,
			mockGjennomgangDetaljData({ status: "completed", followUpPoints: "all_resolved" }),
			"innledning",
		),
}

export const FullførtDokumentasjon: Story = {
	name: "Fullført – Dokumentasjon (read-only)",
	render: () =>
		renderWizard(
			GjennomgangDetalj,
			mockGjennomgangDetaljData({ status: "completed", followUpPoints: "all_resolved" }),
			"dokumentasjon",
		),
}

export const FullførtFullførSteg: Story = {
	name: "Fullført – Fullfør-steg",
	render: () =>
		renderWizard(
			GjennomgangDetalj,
			mockGjennomgangDetaljData({ status: "completed", followUpPoints: "all_resolved" }),
			"fullfor",
		),
}

// ─── Må følges opp ─────────────────────────────────────────────────

export const MåFølgesOppOppfølging: Story = {
	name: "Må følges opp – Oppfølgingspunkter",
	render: () =>
		renderWizard(
			GjennomgangDetalj,
			mockGjennomgangDetaljData({ status: "needs_follow_up", followUpPoints: "all_open" }),
			"oppfolging",
		),
}

export const MåFølgesOppDelvisAdressert: Story = {
	name: "Må følges opp – delvis adressert",
	render: () =>
		renderWizard(
			GjennomgangDetalj,
			mockGjennomgangDetaljData({ status: "needs_follow_up", followUpPoints: "mixed" }),
			"oppfolging",
		),
}

// ─── Forkastet ─────────────────────────────────────────────────────

export const Forkastet: Story = {
	name: "Forkastet",
	render: () => renderWizard(GjennomgangDetalj, mockGjennomgangDetaljData({ status: "discarded" }), "fullfor"),
}
