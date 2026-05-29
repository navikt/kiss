import type { Meta, StoryObj } from "@storybook/react"
import { mockAppDetaljerData, mockRpaUsers } from "@storybook-mocks/data"
import { renderWithLoader, renderWithLoaderAndAction } from "@storybook-mocks/router"
import { data } from "react-router"
import ApplikasjonDetalj from "../index"

const meta = {
	title: "Sider/Applikasjoner/Detaljer",
	component: ApplikasjonDetalj,
} satisfies Meta<typeof ApplikasjonDetalj>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	name: "Med rutiner og seksjonsrutiner (inkl. hendelsesbaserte)",
	render: () => renderWithLoader(ApplikasjonDetalj, mockAppDetaljerData(), "/applikasjoner/app-1/detaljer"),
}

export const ManglerOracleTilgang: Story = {
	name: "Mangler Oracle-tilgang (Entra ID-grupper)",
	render: () =>
		renderWithLoader(
			ApplikasjonDetalj,
			mockAppDetaljerData({
				oracleRoles: [],
				inaccessibleOracleGroups: [
					{ id: "group-1", name: "Oracle-Pensjon-Prod-Readers" },
					{ id: "group-2", name: "Oracle-Pensjon-Test-Readers" },
				],
			}),
			"/applikasjoner/app-1/detaljer",
		),
}

export const MedRpaBrukere: Story = {
	name: "Med RPA-brukere (Autentisering-fanen)",
	render: () =>
		renderWithLoader(
			ApplikasjonDetalj,
			mockAppDetaljerData({
				rpaUsers: mockRpaUsers(),
				authIntegrations: [
					{
						id: "auth-1",
						type: "entra_id",
						sidecarEnabled: true,
						allowAllUsers: false,
						groups: JSON.stringify(["entra-rpa-1"]),
						inboundRules: null,
						claimsExtra: null,
					},
				],
			}),
			"/applikasjoner/app-1/detaljer?fane=autentisering",
		),
}

export const MedRegelsett: Story = {
	name: "Med regelsett (Regelsett-fanen)",
	render: () =>
		renderWithLoader(
			ApplikasjonDetalj,
			mockAppDetaljerData({
				appRulesets: [
					{
						id: "rs-1",
						code: "RS-01",
						name: "Sikkerhet i databasetilgang",
						description: "Regelsett for å sikre at tilgang til databaser er kontrollert og logget.",
						frequency: "quarterly",
						status: "approved",
						sectionId: "s-01",
						sectionSlug: "pensjon-og-ufore",
						sectionName: "Pensjon og uføre",
						responsibleName: "Ola Nordmann",
						responsibleRole: "tech_manager",
						approvalStatus: "valid",
						lastApproval: { validFrom: "2026-01-01T00:00:00Z", validUntil: "2027-01-01T00:00:00Z" },
						controls: [
							{ id: "c-1", controlId: "K-ST.01", shortTitle: "Tilgangsstyring" },
							{ id: "c-2", controlId: "K-ST.03", shortTitle: "Logging og overvåking" },
						],
					},
					{
						id: "rs-2",
						code: "RS-02",
						name: "Kryptering av data i transit",
						description: null,
						frequency: "annually",
						status: "approved",
						sectionId: "s-01",
						sectionSlug: "pensjon-og-ufore",
						sectionName: "Pensjon og uføre",
						responsibleName: null,
						responsibleRole: "tech_lead",
						approvalStatus: "expiring_soon",
						lastApproval: { validFrom: "2025-06-01T00:00:00Z", validUntil: "2026-06-01T00:00:00Z" },
						controls: [
							{ id: "c-3", controlId: "K-TS.02", shortTitle: "Kryptering" },
							{ id: "c-4", controlId: "K-TS.04", shortTitle: "Nettverkssikkerhet" },
							{ id: "c-5", controlId: "K-TS.05", shortTitle: "Sertifikathåndtering" },
							{ id: "c-6", controlId: "K-TS.06", shortTitle: "API-sikkerhet" },
						],
					},
					{
						id: "rs-3",
						code: null,
						name: "Personvern og dataminimering",
						description: "Regelsett som sikrer GDPR-compliance i databehandling.",
						frequency: "semi_annually",
						status: "draft",
						sectionId: "s-01",
						sectionSlug: "pensjon-og-ufore",
						sectionName: "Pensjon og uføre",
						responsibleName: null,
						responsibleRole: null,
						approvalStatus: "draft",
						lastApproval: null,
						controls: [{ id: "c-7", controlId: "K-PV.01", shortTitle: "Personvern" }],
					},
				],
			}),
			"/applikasjoner/app-1/detaljer?fane=regelsett",
		),
}

export const RutinerFane: Story = {
	name: "Rutiner-fanen (seksjonsrutiner med Kobling-kolonne)",
	render: () =>
		renderWithLoader(ApplikasjonDetalj, mockAppDetaljerData(), "/applikasjoner/app-1/detaljer?fane=rutiner"),
}

export const OppfolgingspunkterFane: Story = {
	name: "Oppfølgingspunkter-fanen (med åpne og løste punkter)",
	render: () =>
		renderWithLoader(ApplikasjonDetalj, mockAppDetaljerData(), "/applikasjoner/app-1/detaljer?fane=oppfolgingspunkter"),
}

export const OppfolgingspunkterFaneEmpty: Story = {
	name: "Oppfølgingspunkter-fanen (ingen punkter)",
	render: () =>
		renderWithLoader(
			ApplikasjonDetalj,
			mockAppDetaljerData({
				completedReviews: [],
			}),
			"/applikasjoner/app-1/detaljer?fane=oppfolgingspunkter",
		),
}

export const ErOkonomisystem: Story = {
	name: "Klassifisert som økonomisystem",
	render: () =>
		renderWithLoader(
			ApplikasjonDetalj,
			mockAppDetaljerData({
				economyClassification: {
					isEconomySystem: true,
					economySystemType: "regnskapssystem",
					justification: "Pensjon håndterer utbetaling av pensjoner og er et regnskapssystem.",
					validUntil: "2027-01-01T00:00:00Z",
				},
			}),
			"/applikasjoner/app-1/detaljer",
		),
}

// create-draft-action returnerer feil og RutinerTab viser Alert.

export const KonfliktNyGjennomgang: Story = {
	name: "Konflikt – aktiv gjennomgang finnes (RutinerTab)",
	render: () =>
		renderWithLoaderAndAction(
			ApplikasjonDetalj,
			mockAppDetaljerData(),
			() =>
				data(
					{
						success: false,
						message: null,
						error:
							"Det finnes allerede en aktiv gjennomgang for aktivitetstypen «Entra ID-gruppevedlikehold» på denne applikasjonen. Fullfør eller forkast den eksisterende gjennomgangen før du oppretter en ny.",
						intent: "create-draft",
					},
					{ status: 409 },
				),
			"/applikasjoner/app-1/detaljer?fane=rutiner",
		),
}
