import type { Meta, StoryObj } from "@storybook/react"
import { mockRapporterData } from "@storybook-mocks/data"
import { renderWithLoader } from "@storybook-mocks/router"
import SeksjonRapporterIndex from "../index"

const meta = {
	title: "Sider/Seksjoner/Rapporter",
	component: SeksjonRapporterIndex,
} satisfies Meta<typeof SeksjonRapporterIndex>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	name: "Tom – ingen rapporter ennå",
	render: () => renderWithLoader(SeksjonRapporterIndex, mockRapporterData(), "/seksjoner/pensjon-og-ufore/rapporter"),
}

export const IngenApplikasjoner: Story = {
	name: "Ingen applikasjoner i seksjonen",
	render: () =>
		renderWithLoader(SeksjonRapporterIndex, mockRapporterData({ apps: [] }), "/seksjoner/pensjon-og-ufore/rapporter"),
}

export const MedFerdigeRapporter: Story = {
	name: "Med fullførte rapporter",
	render: () =>
		renderWithLoader(
			SeksjonRapporterIndex,
			mockRapporterData({
				existingReports: [
					{
						id: "report-1",
						name: "Seksjonsrapport – Pensjon og uføre – 31.5.2026",
						status: "completed",
						progressMessage: null,
						reportBucketPath: "reports/seksjon-1/report-1.zip",
						createdAt: "2026-05-31T10:00:00Z",
						createdBy: "A123456",
					},
					{
						id: "report-2",
						name: "Seksjonsrapport – Pensjon og uføre – 15.5.2026",
						status: "completed",
						progressMessage: null,
						reportBucketPath: "reports/seksjon-1/report-2.zip",
						createdAt: "2026-05-15T08:30:00Z",
						createdBy: "B654321",
					},
				],
			}),
			"/seksjoner/pensjon-og-ufore/rapporter",
		),
}

export const MedPagaendeRapport: Story = {
	name: "Med rapport som genereres",
	render: () =>
		renderWithLoader(
			SeksjonRapporterIndex,
			mockRapporterData({
				existingReports: [
					{
						id: "report-3",
						name: "Seksjonsrapport – Pensjon og uføre – 31.5.2026",
						status: "running",
						progressMessage: "Behandler Pesys (2/5)…",
						reportBucketPath: null,
						createdAt: "2026-05-31T14:00:00Z",
						createdBy: "A123456",
					},
				],
			}),
			"/seksjoner/pensjon-og-ufore/rapporter",
		),
}

export const MedFeiletRapport: Story = {
	name: "Med feilet rapport",
	render: () =>
		renderWithLoader(
			SeksjonRapporterIndex,
			mockRapporterData({
				existingReports: [
					{
						id: "report-4",
						name: "Seksjonsrapport – Pensjon og uføre – 30.5.2026",
						status: "failed",
						progressMessage: "Rapport generering feilet.",
						reportBucketPath: null,
						createdAt: "2026-05-30T09:00:00Z",
						createdBy: "A123456",
					},
				],
			}),
			"/seksjoner/pensjon-og-ufore/rapporter",
		),
}
