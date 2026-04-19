import { BodyShort, Button, HStack, Modal } from "@navikt/ds-react"
import type { RefObject } from "react"
import { Form } from "react-router"
import type { DeleteTarget } from "../shared"

export function DeleteConfirmModal({
	modalRef,
	deleteTarget,
	isNew,
	onClose,
	onConfirmPendingDelete,
}: {
	modalRef: RefObject<HTMLDialogElement | null>
	deleteTarget: DeleteTarget | null
	isNew: boolean
	onClose: () => void
	onConfirmPendingDelete: () => void
}) {
	return (
		<Modal
			ref={modalRef}
			header={{ heading: deleteTarget?.type === "choice" ? "Slett valg" : "Slett effekt" }}
			onClose={onClose}
		>
			<Modal.Body>
				<BodyShort>
					Er du sikker på at du vil slette{" "}
					{deleteTarget?.type === "choice" ? `valget «${deleteTarget.label}»` : `effekten for ${deleteTarget?.label}`}?
					{deleteTarget?.type === "choice" && " Alle tilhørende effekter vil også slettes."}
				</BodyShort>
			</Modal.Body>
			<Modal.Footer>
				{deleteTarget?.type === "choice" && !isNew ? (
					<Form method="post" onSubmit={() => modalRef.current?.close()}>
						<input type="hidden" name="intent" value="deleteChoice" />
						<input type="hidden" name="choiceId" value={deleteTarget.id} />
						<HStack gap="space-4">
							<Button type="button" variant="secondary" size="small" onClick={() => modalRef.current?.close()}>
								Avbryt
							</Button>
							<Button type="submit" variant="danger" size="small">
								Slett valg
							</Button>
						</HStack>
					</Form>
				) : deleteTarget?.type === "effect" && !isNew ? (
					<Form method="post" onSubmit={() => modalRef.current?.close()}>
						<input type="hidden" name="intent" value="deleteEffect" />
						<input type="hidden" name="effectId" value={deleteTarget.id} />
						<HStack gap="space-4">
							<Button type="button" variant="secondary" size="small" onClick={() => modalRef.current?.close()}>
								Avbryt
							</Button>
							<Button type="submit" variant="danger" size="small">
								Slett effekt
							</Button>
						</HStack>
					</Form>
				) : (
					<HStack gap="space-4">
						<Button type="button" variant="secondary" size="small" onClick={() => modalRef.current?.close()}>
							Avbryt
						</Button>
						<Button
							type="button"
							variant="danger"
							size="small"
							onClick={() => {
								onConfirmPendingDelete()
								modalRef.current?.close()
							}}
						>
							Slett {deleteTarget?.type === "choice" ? "valg" : "effekt"}
						</Button>
					</HStack>
				)}
			</Modal.Footer>
		</Modal>
	)
}
