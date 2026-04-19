import { Button, HStack, Modal, Radio, RadioGroup, VStack } from "@navikt/ds-react"
import { useState } from "react"
import { Form } from "react-router"

interface Props {
	modalRef: React.RefObject<HTMLDialogElement | null>
	routineName: string
	hasSource: boolean
}

export function ApproveReplaceModal({ modalRef, routineName, hasSource }: Props) {
	const [action, setAction] = useState<"replace" | "new">(hasSource ? "replace" : "new")
	const [deadlinePolicy, setDeadlinePolicy] = useState<"continue" | "reset">("continue")

	return (
		<Modal ref={modalRef} header={{ heading: `Godkjenn rutine: ${routineName}` }}>
			<Modal.Body>
				<VStack gap="space-8">
					{hasSource && (
						<RadioGroup
							legend="Hva skal skje med den opprinnelige rutinen?"
							value={action}
							onChange={(val) => setAction(val as "replace" | "new")}
							size="small"
						>
							<Radio value="replace">Erstatt den opprinnelige rutinen</Radio>
							<Radio value="new">Legg til som en ny rutine (behold begge)</Radio>
						</RadioGroup>
					)}
					{action === "replace" && (
						<RadioGroup
							legend="Fristpolicy for applikasjoner"
							description="Velg om applikasjonene som bruker den gamle rutinen skal beholde sin eksisterende frist eller starte på nytt."
							value={deadlinePolicy}
							onChange={(val) => setDeadlinePolicy(val as "continue" | "reset")}
							size="small"
						>
							<Radio value="continue">Behold eksisterende frist (basert på ny frekvens fra forrige gjennomgang)</Radio>
							<Radio value="reset">Krev ny gjennomgang (fristen starter fra nå)</Radio>
						</RadioGroup>
					)}
				</VStack>
			</Modal.Body>
			<Modal.Footer>
				<Form method="post" onSubmit={() => modalRef.current?.close()}>
					<input type="hidden" name="intent" value={action === "replace" ? "approve-replace" : "approve-as-new"} />
					{action === "replace" && <input type="hidden" name="deadlinePolicy" value={deadlinePolicy} />}
					<HStack gap="space-4">
						<Button type="submit" variant="primary" size="small">
							Godkjenn
						</Button>
						<Button type="button" variant="secondary" size="small" onClick={() => modalRef.current?.close()}>
							Avbryt
						</Button>
					</HStack>
				</Form>
			</Modal.Footer>
		</Modal>
	)
}
