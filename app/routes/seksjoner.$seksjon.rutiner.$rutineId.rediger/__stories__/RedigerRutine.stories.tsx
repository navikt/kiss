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

export const GodkjennErstatning: Story = {
	name: "Godkjenn rutine som erstatter eksisterende (viser modal)",
	render: () =>
		renderWithLoader(
			RedigerRutine,
			mockRedigerRutineData({
				routine: {
					status: "ready",
					sourceRoutineId: "original-routine-id",
				},
			}),
			"/seksjoner/pensjon-og-ufore/rutiner/routine-1/rediger",
		),
	parameters: {
		docs: {
			description: {
				story:
					'Klikk på "Godkjenn"-knappen for å se modalen som lar brukeren velge om eksisterende rutinegjennomganger skal beholde sin frist (continue) eller starte på nytt (reset).',
			},
		},
	},
}

export const GodkjennNy: Story = {
	name: "Godkjenn ny rutine (uten erstatning)",
	render: () =>
		renderWithLoader(
			RedigerRutine,
			mockRedigerRutineData({
				routine: {
					status: "ready",
					sourceRoutineId: null,
				},
			}),
			"/seksjoner/pensjon-og-ufore/rutiner/routine-1/rediger",
		),
	parameters: {
		docs: {
			description: {
				story:
					'Rutinen er helt ny (ingen sourceRoutineId). "Godkjenn"-knappen vises ikke på redigeringssiden for nye rutiner. Godkjenning av nye rutiner skjer fra rutinedetaljsiden etter at status er satt til "ready".',
			},
		},
	},
}
