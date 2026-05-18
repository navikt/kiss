import type { Meta, StoryObj } from "@storybook/react"
import { mockRedigerRutineData } from "@storybook-mocks/data"
import { renderWithLoader } from "@storybook-mocks/router"
import RedigerRutine from "../index"

const meta = {
	title: "Sider/Seksjoner/Rutiner/Rediger",
	component: RedigerRutine,
} satisfies Meta<typeof RedigerRutine>
export default meta
type Story = StoryObj<typeof meta>

export const FlereAktiviteter: Story = {
	name: "Flere vedlikeholdsaktiviteter",
	render: () =>
		renderWithLoader(RedigerRutine, mockRedigerRutineData(), "/seksjoner/pensjon-og-ufore/rutiner/routine-1/rediger"),
}

export const EnAktivitet: Story = {
	name: "Én vedlikeholdsaktivitet",
	render: () =>
		renderWithLoader(
			RedigerRutine,
			mockRedigerRutineData({ activityLinks: ["oracle_evidence_audit"] }),
			"/seksjoner/pensjon-og-ufore/rutiner/routine-1/rediger",
		),
}

export const IngenAktiviteter: Story = {
	name: "Ingen vedlikeholdsaktiviteter",
	render: () =>
		renderWithLoader(
			RedigerRutine,
			mockRedigerRutineData({ activityLinks: [] }),
			"/seksjoner/pensjon-og-ufore/rutiner/routine-1/rediger",
		),
}
