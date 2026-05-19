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
		initialActivities: ["oracle_evidence_audit"],
	},
}

export const ToAktiviteter: Story = {
	name: "To aktiviteter",
	args: {
		initialActivities: ["oracle_evidence_audit", "entra_id_group_maintenance"],
	},
}

export const FlereAktiviteter: Story = {
	name: "Tre aktiviteter (full rekkefølge)",
	args: {
		initialActivities: ["entra_id_group_maintenance", "oracle_evidence_audit", "deployment_evidence_report"],
	},
}

export const AlleAktiviteter: Story = {
	name: "Alle tilgjengelige aktiviteter",
	args: {
		initialActivities: [
			"oracle_evidence_audit",
			"entra_id_group_maintenance",
			"deployment_evidence_report",
			"oracle_evidence_roles",
		],
	},
}

export const Deaktivert: Story = {
	name: "Deaktivert (read-only)",
	args: {
		initialActivities: ["oracle_evidence_audit", "entra_id_group_maintenance", "deployment_evidence_report"],
		disabled: true,
	},
}
