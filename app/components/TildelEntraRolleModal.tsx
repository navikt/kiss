import { PlusIcon } from "@navikt/aksel-icons"
import { BodyLong, Button, HStack, Modal, Select, VStack } from "@navikt/ds-react"
import { useRef, useState } from "react"
import { Form } from "react-router"
import type { UserRole } from "~/db/schema/organization"
import { userRoleLabels } from "~/db/schema/organization"

interface EntraMember {
	navIdent: string
	displayName: string | null
}

interface TildelEntraRolleModalProps {
	entraMembers: EntraMember[]
	assignableRoles: UserRole[]
}

/** Modal for å tildele Tech Lead/Produktleder blant medlemmene av teamets koblede Entra ID-gruppe. */
export function TildelEntraRolleModal({ entraMembers, assignableRoles }: TildelEntraRolleModalProps) {
	const modalRef = useRef<HTMLDialogElement>(null)
	const [formKey, setFormKey] = useState(0)
	const hasMembers = entraMembers.length > 0

	function handleOpen() {
		setFormKey((k) => k + 1)
		modalRef.current?.showModal()
	}

	return (
		<>
			<Button variant="secondary" size="small" icon={<PlusIcon aria-hidden />} onClick={handleOpen}>
				Tildel rolle
			</Button>

			<Modal ref={modalRef} header={{ heading: "Tildel rolle til gruppemedlem" }}>
				{hasMembers ? (
					<Form key={formKey} method="post" onSubmit={() => modalRef.current?.close()}>
						<input type="hidden" name="intent" value="add-member" />
						<Modal.Body>
							<VStack gap="space-6">
								<Select label="Gruppemedlem" name="person" size="small" required defaultValue="">
									<option value="" disabled>
										Velg medlem
									</option>
									{entraMembers.map((m) => {
										const displayName = m.displayName?.trim()
										return (
											<option key={m.navIdent} value={m.navIdent}>
												{displayName ? `${displayName} (${m.navIdent})` : m.navIdent}
											</option>
										)
									})}
								</Select>
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
								<Button type="submit" size="small">
									Tildel
								</Button>
								<Button type="button" variant="secondary" size="small" onClick={() => modalRef.current?.close()}>
									Avbryt
								</Button>
							</HStack>
						</Modal.Footer>
					</Form>
				) : (
					<>
						<Modal.Body>
							<BodyLong size="small">
								Ingen medlemmer er synkronisert fra den koblede Entra ID-gruppen ennå. Vent til neste synkronisering,
								eller sjekk at gruppen faktisk har medlemmer.
							</BodyLong>
						</Modal.Body>
						<Modal.Footer>
							<Button type="button" variant="secondary" size="small" onClick={() => modalRef.current?.close()}>
								Lukk
							</Button>
						</Modal.Footer>
					</>
				)}
			</Modal>
		</>
	)
}
