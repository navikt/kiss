import { PlusIcon } from "@navikt/aksel-icons"
import { Button, Checkbox, HStack, TextField } from "@navikt/ds-react"
import type { PendingChoice } from "../shared"

export function AddPendingChoiceForm({
	existingCount,
	onAdd,
}: {
	existingCount: number
	onAdd: (choice: PendingChoice) => void
}) {
	function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault()
		const fd = new FormData(e.currentTarget)
		const label = (fd.get("label") as string)?.trim()
		if (!label) return
		onAdd({
			clientId: crypto.randomUUID(),
			label,
			requiresComment: fd.get("requiresComment") === "on",
			requiresLink: fd.get("requiresLink") === "on",
			displayOrder: existingCount,
			effects: [],
		})
		e.currentTarget.reset()
	}

	return (
		<form onSubmit={handleSubmit}>
			<HStack gap="space-4" align="end" wrap>
				<TextField label="Navn" name="label" size="small" />
				<Checkbox name="requiresComment" size="small">
					Krev kommentar
				</Checkbox>
				<Checkbox name="requiresLink" size="small">
					Krev lenke
				</Checkbox>
				<Button type="submit" size="small" variant="secondary-neutral" icon={<PlusIcon aria-hidden />}>
					Legg til valg
				</Button>
			</HStack>
		</form>
	)
}
