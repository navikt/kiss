import { PlusIcon } from "@navikt/aksel-icons"
import { BodyLong, Button, HStack, Modal, Search, Table, VStack } from "@navikt/ds-react"
import { useRef, useState } from "react"
import { Form } from "react-router"

interface AddAppModalProps {
	availableApps: { id: string; name: string }[]
	intent: string
	teamId?: string
	buttonLabel?: string
	buttonVariant?: "primary" | "secondary" | "tertiary"
}

export function AddAppModal({
	availableApps,
	teamId,
	intent,
	buttonLabel = "Legg til applikasjon",
	buttonVariant = "tertiary",
}: AddAppModalProps) {
	const modalRef = useRef<HTMLDialogElement>(null)
	const [search, setSearch] = useState("")
	const [selectedAppId, setSelectedAppId] = useState<string | null>(null)

	const filteredApps = availableApps.filter((a) => a.name.toLowerCase().includes(search.toLowerCase()))

	return (
		<>
			<Button
				variant={buttonVariant}
				size="small"
				icon={<PlusIcon aria-hidden />}
				onClick={() => {
					setSearch("")
					setSelectedAppId(null)
					modalRef.current?.showModal()
				}}
			>
				{buttonLabel}
			</Button>

			<Modal ref={modalRef} header={{ heading: "Legg til applikasjon" }}>
				<Modal.Body>
					<VStack gap="space-6">
						<Search
							label="Søk etter applikasjon"
							value={search}
							onChange={setSearch}
							onClear={() => setSearch("")}
							size="small"
						/>
						{filteredApps.length > 0 ? (
							<section
								className="table-scroll"
								// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1
								tabIndex={0}
								aria-label="Tilgjengelige applikasjoner"
								style={{ maxHeight: "20rem", overflow: "auto" }}
							>
								<Table size="small">
									<Table.Body>
										{filteredApps.map((app) => (
											<Table.Row
												key={app.id}
												selected={selectedAppId === app.id}
												onClick={() => setSelectedAppId(app.id)}
												style={{ cursor: "pointer" }}
											>
												<Table.DataCell>{app.name}</Table.DataCell>
											</Table.Row>
										))}
									</Table.Body>
								</Table>
							</section>
						) : (
							<BodyLong size="small">
								{search ? "Ingen applikasjoner funnet." : "Ingen tilgjengelige applikasjoner."}
							</BodyLong>
						)}
					</VStack>
				</Modal.Body>
				<Modal.Footer>
					<Form method="post" onSubmit={() => modalRef.current?.close()}>
						<input type="hidden" name="intent" value={intent} />
						<input type="hidden" name="applicationId" value={selectedAppId ?? ""} />
						{teamId && <input type="hidden" name="teamId" value={teamId} />}
						<HStack gap="space-4">
							<Button type="submit" size="small" disabled={!selectedAppId}>
								Legg til
							</Button>
							<Button type="button" variant="secondary" size="small" onClick={() => modalRef.current?.close()}>
								Avbryt
							</Button>
						</HStack>
					</Form>
				</Modal.Footer>
			</Modal>
		</>
	)
}
