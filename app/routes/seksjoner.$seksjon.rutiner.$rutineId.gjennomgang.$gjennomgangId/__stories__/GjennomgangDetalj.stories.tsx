import type { Meta, StoryObj } from "@storybook/react"
import {
	MOCK_MANUAL_ACTIVITY_STEP_IDS,
	mockGjennomgangDetaljData,
	mockGjennomgangDetaljManualActivityData,
	mockGjennomgangDetaljOracleEvidenceData,
	mockGjennomgangDetaljRpaMaintenanceData,
	mockGjennomgangMultiActivityData,
} from "@storybook-mocks/data"
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

export const InnledningMedTeammedlemmer: Story = {
	name: "Steg 1 – Innledning med teammedlemmer (hurtigvalg)",
	render: () => {
		const data = {
			...mockGjennomgangDetaljData({ status: "draft" }),
			teamMembers: [
				{
					teamName: "Starte pensjon",
					members: [
						{ navIdent: "Z990001", name: "Glad Fjord" },
						{ navIdent: "Z990002", name: "Modig Bjørk" },
						{ navIdent: "Z990003", name: "Rask Elv" },
					],
				},
				{
					teamName: "Beregning",
					members: [
						{ navIdent: "Z990004", name: "Stille Skog" },
						{ navIdent: "Z990005", name: "Varm Solstråle" },
					],
				},
			],
		}
		return renderWizard(GjennomgangDetalj, data, "innledning")
	},
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
		renderWizard(GjennomgangDetalj, mockGjennomgangDetaljOracleEvidenceData({ withDownloads: true }), "aktivitet-0"),
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
			"aktivitet-0",
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

// ─── Flere vedlikeholdsaktiviteter ──────────────────────────────────

export const MultiAktivitetOversikt: Story = {
	name: "Multi-aktivitet – Innledning",
	render: () => renderWizard(GjennomgangDetalj, mockGjennomgangMultiActivityData(), "innledning"),
}

export const MultiAktivitetOracle: Story = {
	name: "Multi-aktivitet – Oracle (steg 1)",
	render: () => renderWizard(GjennomgangDetalj, mockGjennomgangMultiActivityData(), "aktivitet-0"),
}

export const MultiAktivitetEntra: Story = {
	name: "Multi-aktivitet – Entra ID (steg 2)",
	render: () => renderWizard(GjennomgangDetalj, mockGjennomgangMultiActivityData(), "aktivitet-1"),
}

export const MultiAktivitetDeployment: Story = {
	name: "Multi-aktivitet – Deployment (steg 3)",
	render: () => renderWizard(GjennomgangDetalj, mockGjennomgangMultiActivityData(), "aktivitet-2"),
}

export const MultiAktivitetFullført: Story = {
	name: "Multi-aktivitet – Fullført (read-only)",
	render: () =>
		renderWizard(GjennomgangDetalj, mockGjennomgangMultiActivityData({ status: "completed" }), "aktivitet-0"),
}

// ─── RPA User Maintenance ───────────────────────────────────────────

export const AktivitetRpaVedlikehold: Story = {
	name: "Aktivitet – RPA-brukervedlikehold (utkast)",
	render: () => renderWizard(GjennomgangDetalj, mockGjennomgangDetaljRpaMaintenanceData(), "aktivitet-0"),
}

export const AktivitetRpaVedlikeholdFullført: Story = {
	name: "Aktivitet – RPA-brukervedlikehold (fullført)",
	render: () => {
		const base = mockGjennomgangDetaljRpaMaintenanceData()
		return renderWizard(
			GjennomgangDetalj,
			{
				...base,
				activities: base.activities.map((a) => ({
					...a,
					status: "completed",
					completedAt: "2026-05-10T12:00:00Z",
				})),
			},
			"aktivitet-0",
		)
	},
}

// ─── Manuell aktivitet ─────────────────────────────────────────────

export const AktivitetManualActivitySteg1: Story = {
	name: "Aktivitet – Manuell aktivitet: steg 1 (utkast)",
	render: () =>
		renderWizard(
			GjennomgangDetalj,
			mockGjennomgangDetaljManualActivityData(),
			`sjekkliste-steg-${MOCK_MANUAL_ACTIVITY_STEP_IDS.step1}`,
		),
}

export const AktivitetManualActivitySteg2: Story = {
	name: "Aktivitet – Manuell aktivitet: steg 2 (utkast)",
	render: () =>
		renderWizard(
			GjennomgangDetalj,
			mockGjennomgangDetaljManualActivityData(),
			`sjekkliste-steg-${MOCK_MANUAL_ACTIVITY_STEP_IDS.step2}`,
		),
}

export const AktivitetManualActivitySteg3: Story = {
	name: "Aktivitet – Manuell aktivitet: steg 3 (utkast)",
	render: () =>
		renderWizard(
			GjennomgangDetalj,
			mockGjennomgangDetaljManualActivityData(),
			`sjekkliste-steg-${MOCK_MANUAL_ACTIVITY_STEP_IDS.step3}`,
		),
}

export const AktivitetManualActivityDokumentasjon: Story = {
	name: "Aktivitet – Manuell aktivitet: dokumentasjon-sammendrag (utkast)",
	render: () => renderWizard(GjennomgangDetalj, mockGjennomgangDetaljManualActivityData(), "dokumentasjon"),
}

export const AktivitetManualActivityFullført: Story = {
	name: "Aktivitet – Manuell aktivitet: steg 1 (fullført, read-only)",
	render: () =>
		renderWizard(
			GjennomgangDetalj,
			mockGjennomgangDetaljManualActivityData({ status: "completed" }),
			`sjekkliste-steg-${MOCK_MANUAL_ACTIVITY_STEP_IDS.step1}`,
		),
}

export const AktivitetManualActivityFullførtDokumentasjon: Story = {
	name: "Aktivitet – Manuell aktivitet: dokumentasjon-sammendrag (fullført, read-only)",
	render: () =>
		renderWizard(GjennomgangDetalj, mockGjennomgangDetaljManualActivityData({ status: "completed" }), "dokumentasjon"),
}
