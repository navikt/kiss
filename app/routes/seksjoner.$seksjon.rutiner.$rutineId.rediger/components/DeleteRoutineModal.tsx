import { BodyLong, Button, HStack, Modal } from "@navikt/ds-react"
import { Form } from "react-router"

interface Props {
	modalRef: React.RefObject<HTMLDialogElement | null>
	routineName: string
}

export function DeleteRoutineModal({ modalRef, routineName }: Props) {
	return (
		<Modal ref={modalRef} header={{ heading: `Slett rutine: ${routineName}` }}>
			<Modal.Body>
				<BodyLong>Er du sikker på at du vil slette rutinen «{routineName}»?</BodyLong>
			</Modal.Body>
			<Modal.Footer>
				<Form method="post" onSubmit={() => modalRef.current?.close()}>
					<input type="hidden" name="intent" value="delete" />
					<HStack gap="space-4">
						<Button type="submit" variant="danger" size="small">
							Slett
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
