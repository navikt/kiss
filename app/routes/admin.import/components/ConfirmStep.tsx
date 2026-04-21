import { Alert, Button } from "@navikt/ds-react"
import { Form } from "react-router"
import type { StagingDiff } from "../shared"

interface ConfirmStepProps {
	stagingDiff: StagingDiff | undefined
	excludedChanges: Set<string>
}

export function ConfirmStep({ stagingDiff, excludedChanges }: ConfirmStepProps) {
	return (
		<>
			{stagingDiff?.unmatchedTechnologyElements && stagingDiff.unmatchedTechnologyElements.length > 0 && (
				<Alert variant="info">
					Følgende teknologielementer finnes ikke i systemet og vil bli opprettet automatisk ved aktivering:
					<ul>
						{stagingDiff.unmatchedTechnologyElements.map((u, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: static list
							<li key={i}>
								<strong>{u.text}</strong>
								{u.description && <> — {u.description}</>} (brukt i {u.controlId})
							</li>
						))}
					</ul>
				</Alert>
			)}
			<div>
				<Form method="post">
					<input type="hidden" name="intent" value="activate" />
					<input type="hidden" name="excludedChanges" value={JSON.stringify([...excludedChanges])} />
					<Button type="submit" variant="primary">
						Aktiver
					</Button>
				</Form>
			</div>
		</>
	)
}
