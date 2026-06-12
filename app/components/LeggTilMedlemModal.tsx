import { PlusIcon } from "@navikt/aksel-icons"
import { Button, HStack, Modal, Select, VStack } from "@navikt/ds-react"
import { useRef, useState } from "react"
import { Form } from "react-router"
import { PersonSingleCombobox } from "~/components/PersonSingleCombobox"
import type { UserRole } from "~/db/schema/organization"
import { userRoleLabels } from "~/db/schema/organization"

interface LeggTilMedlemModalProps {
	assignableRoles: UserRole[]
}

export function LeggTilMedlemModal({ assignableRoles }: LeggTilMedlemModalProps) {
	const modalRef = useRef<HTMLDialogElement>(null)
	const [hasSelection, setHasSelection] = useState(false)
	const [formKey, setFormKey] = useState(0)

	function handleOpen() {
		setHasSelection(false)
		setFormKey((k) => k + 1)
		modalRef.current?.showModal()
	}

	return (
		<>
			<Button variant="secondary" size="small" icon={<PlusIcon aria-hidden />} onClick={handleOpen}>
				Legg til teammedlem
			</Button>

			<Modal ref={modalRef} header={{ heading: "Legg til teammedlem" }}>
				<Form key={formKey} method="post" onSubmit={() => modalRef.current?.close()}>
					<input type="hidden" name="intent" value="add-member" />
					<Modal.Body>
						<VStack gap="space-6">
							<PersonSingleCombobox
								name="person"
								label="Person"
								description="Søk på navn eller NAV-ident"
								required
								onSelectionChange={(person) => setHasSelection(person !== null)}
							/>
							<Select label="Rolle" name="role" size="small" defaultValue={assignableRoles[0]}>
								{assignableRoles.map((r) => (
									<option key={r} value={r}>
										{userRoleLabels[r]}
									</option>
								))}
							</Select>
						</VStack>
					</Modal.Body>
					<Modal.Footer>
						<HStack gap="space-4">
							<Button type="submit" size="small" disabled={!hasSelection}>
								Legg til
							</Button>
							<Button type="button" variant="secondary" size="small" onClick={() => modalRef.current?.close()}>
								Avbryt
							</Button>
						</HStack>
					</Modal.Footer>
				</Form>
			</Modal>
		</>
	)
}
