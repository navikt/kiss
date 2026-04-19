import { Checkbox, Select, TextField } from "@navikt/ds-react"
import { MarkdownEditor } from "~/components/MarkdownEditor"
import {
	frequencyLabels,
	isFrequencyAtLeastAsOften,
	ROUTINE_FREQUENCIES,
	type RoutineFrequency,
} from "~/lib/routine-frequencies"

interface Props {
	name: string
	description: string | null
	frequency: RoutineFrequency
	onFrequencyChange: (value: RoutineFrequency) => void
	minimumFrequency: RoutineFrequency | null
	status: string | null
	appliesToAllInSection: boolean
}

export function GrunnleggendeFields({
	name,
	description,
	frequency,
	onFrequencyChange,
	minimumFrequency,
	status,
	appliesToAllInSection,
}: Props) {
	return (
		<>
			<TextField label="Navn" name="name" defaultValue={name} size="small" autoComplete="off" />
			<MarkdownEditor label="Beskrivelse" name="description" defaultValue={description ?? ""} />
			<Select
				label="Frekvens"
				name="frequency"
				value={frequency}
				onChange={(e) => onFrequencyChange(e.target.value as RoutineFrequency)}
				size="small"
				description={minimumFrequency ? `Krav krever minimum: ${frequencyLabels[minimumFrequency]}` : undefined}
			>
				{ROUTINE_FREQUENCIES.map((freq) => (
					<option
						key={freq}
						value={freq}
						disabled={minimumFrequency ? !isFrequencyAtLeastAsOften(freq, minimumFrequency) : false}
					>
						{frequencyLabels[freq]}
						{minimumFrequency === freq ? " (fra krav)" : ""}
					</option>
				))}
			</Select>

			<Select label="Status" name="status" defaultValue={status ?? "active"} size="small">
				<option value="draft">Utkast</option>
				<option value="active">Aktiv</option>
				<option value="archived">Arkivert</option>
			</Select>

			<Checkbox name="appliesToAllInSection" defaultChecked={appliesToAllInSection} size="small">
				Gjelder alle applikasjoner i seksjonen
			</Checkbox>
		</>
	)
}
