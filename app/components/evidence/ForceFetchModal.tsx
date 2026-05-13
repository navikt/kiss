import { Alert, Button, Modal, Textarea, VStack } from "@navikt/ds-react"
import { useEffect, useRef, useState } from "react"
import type { EvidenceItemStatus } from "~/lib/evidence-providers/types"
import { statusLabel } from "./EvidenceStatusBadge"

interface Props {
	open: boolean
	onClose: () => void
	onConfirm: (justification: string) => void
	/** Human-readable label for the evidence type */
	evidenceTypeLabel: string
	status: EvidenceItemStatus
}

export function ForceFetchModal({ open, onClose, onConfirm, evidenceTypeLabel, status }: Props) {
	const [justification, setJustification] = useState("")
	const modalRef = useRef<HTMLDialogElement>(null)

	useEffect(() => {
		if (open) setJustification("")
	}, [open])

	return (
		<Modal ref={modalRef} open={open} onClose={onClose} header={{ heading: "Hent ufullstendig bevis" }}>
			<Modal.Body>
				<VStack gap="space-4">
					<Alert variant="warning" size="small">
						Beviset «{evidenceTypeLabel}» har status «{statusLabel(status)}» og er ikke fullstendig. Du kan likevel
						hente det, men du må oppgi en begrunnelse.
					</Alert>
					<Textarea
						label="Begrunnelse"
						description="Forklar hvorfor du henter beviset selv om det ikke er fullstendig"
						value={justification}
						onChange={(e) => setJustification(e.target.value)}
						minRows={3}
					/>
				</VStack>
			</Modal.Body>
			<Modal.Footer>
				<Button variant="primary" onClick={() => onConfirm(justification)} disabled={!justification.trim()}>
					Hent bevis med begrunnelse
				</Button>
				<Button variant="secondary" onClick={onClose}>
					Avbryt
				</Button>
			</Modal.Footer>
		</Modal>
	)
}
