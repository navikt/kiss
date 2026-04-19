import { Checkbox, CheckboxGroup } from "@navikt/ds-react"

interface Control {
	id: string
	controlId: string
	name: string
	responsible: string | null
}

interface Props {
	controls: Control[]
	selectedControlIds: string[]
	onChange: (newIds: string[]) => void
}

export function KontrollerField({ controls, selectedControlIds, onChange }: Props) {
	if (controls.length === 0) return null
	return (
		<CheckboxGroup legend="Tilknyttede krav" size="small" value={selectedControlIds} onChange={onChange}>
			{controls.map((ctrl) => (
				<Checkbox key={ctrl.id} name="controlIds" value={ctrl.id}>
					{ctrl.controlId} – {ctrl.name}
					{ctrl.responsible && ` (${ctrl.responsible})`}
				</Checkbox>
			))}
		</CheckboxGroup>
	)
}
