import type { Meta, StoryObj } from "@storybook/react"
import { withRouter } from "@storybook-mocks/router"
import { SortableActivityList } from "../SortableActivityList"

const meta = {
	title: "Komponenter/SortableActivityList",
	component: SortableActivityList,
	decorators: [withRouter],
	parameters: { layout: "padded" },
} satisfies Meta<typeof SortableActivityList>
export default meta
type Story = StoryObj<typeof meta>

export const Tom: Story = {
	name: "Ingen aktiviteter valgt",
	args: {},
}

export const EnAktivitet: Story = {
	name: "Én aktivitet",
	args: {
		initialActivities: [{ id: "oracle_evidence_audit", type: "oracle_evidence_audit" }],
	},
}

export const ToAktiviteter: Story = {
	name: "To aktiviteter",
	args: {
		initialActivities: [
			{ id: "oracle_evidence_audit", type: "oracle_evidence_audit" },
			{ id: "entra_id_group_maintenance", type: "entra_id_group_maintenance" },
		],
	},
}

export const FlereAktiviteter: Story = {
	name: "Tre aktiviteter (full rekkefølge)",
	args: {
		initialActivities: [
			{ id: "entra_id_group_maintenance", type: "entra_id_group_maintenance" },
			{ id: "oracle_evidence_audit", type: "oracle_evidence_audit" },
			{ id: "deployment_evidence_report", type: "deployment_evidence_report" },
		],
	},
}

export const AlleAktiviteter: Story = {
	name: "Alle tilgjengelige aktiviteter",
	args: {
		initialActivities: [
			{ id: "oracle_evidence_audit", type: "oracle_evidence_audit" },
			{ id: "entra_id_group_maintenance", type: "entra_id_group_maintenance" },
			{ id: "deployment_evidence_report", type: "deployment_evidence_report" },
			{ id: "oracle_evidence_roles", type: "oracle_evidence_roles" },
		],
	},
}

export const MedManuelleSteg: Story = {
	name: "Med manuelle sjekkliste-steg",
	args: {
		initialActivities: [
			{ id: "oracle_evidence_audit", type: "oracle_evidence_audit" },
			{
				id: "step-1",
				type: "manual_activity",
				stepTitle: "Bekreft tilgang",
				stepDescription: "Sjekk at alle har riktig tilgang",
			},
			{ id: "step-2", type: "manual_activity", stepTitle: "Arkiver dokumentasjon", stepDescription: "" },
		],
	},
}

export const Deaktivert: Story = {
	name: "Deaktivert (read-only)",
	args: {
		initialActivities: [
			{ id: "oracle_evidence_audit", type: "oracle_evidence_audit" },
			{ id: "entra_id_group_maintenance", type: "entra_id_group_maintenance" },
			{ id: "deployment_evidence_report", type: "deployment_evidence_report" },
		],
		disabled: true,
	},
}
