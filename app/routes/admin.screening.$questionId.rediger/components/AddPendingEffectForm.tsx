import { PlusIcon } from "@navikt/aksel-icons"
import { Button, HStack, Select } from "@navikt/ds-react"
import { screeningEffectLabels } from "~/db/schema/screening"
import type { ControlOption, PendingEffectItem } from "../shared"

export function AddPendingEffectForm({
	choiceClientId,
	controls,
	onAdd,
}: {
	choiceClientId: string
	controls: ControlOption[]
	onAdd: (choiceClientId: string, eff: PendingEffectItem) => void
}) {
	function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault()
		const fd = new FormData(e.currentTarget)
		const controlTextId = fd.get("controlTextId") as string
		if (!controlTextId) return
		const control = controls.find((c) => c.controlId === controlTextId)
		onAdd(choiceClientId, {
			clientId: crypto.randomUUID(),
			controlTextId,
			controlName: control?.name ?? "",
			effect: (fd.get("effect") as string) || null,
			comment: (fd.get("comment") as string) || null,
		})
		e.currentTarget.reset()
	}

	return (
		<form onSubmit={handleSubmit}>
			<HStack gap="space-4" align="end" wrap>
				<Select label="Kontroll" name="controlTextId" size="small">
					<option value="">Velg kontroll</option>
					{controls.map((c) => (
						<option key={c.controlId} value={c.controlId}>
							{c.controlId} – {c.name}
						</option>
					))}
				</Select>
				<Select label="Effekt" name="effect" size="small">
					<option value="">Ingen</option>
					{Object.entries(screeningEffectLabels).map(([v, l]) => (
						<option key={v} value={v}>
							{l}
						</option>
					))}
				</Select>
				<Button type="submit" size="small" variant="secondary-neutral" icon={<PlusIcon aria-hidden />}>
					Legg til effekt
				</Button>
			</HStack>
		</form>
	)
}
