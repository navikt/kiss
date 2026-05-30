import {
	Alert,
	BodyLong,
	Button,
	Heading,
	HStack,
	Modal,
	Table,
	Tag,
	Textarea,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { useRef, useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, useActionData, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import {
	archiveTechnologyElement,
	createTechnologyElement,
	getAllTechnologyElements,
	getTechnologyElementWithCounts,
	unarchiveTechnologyElement,
	updateTechnologyElement,
} from "~/db/queries/technology-elements.server"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { isAdmin } from "~/lib/authorization.server"

interface ElementRow {
	id: string
	name: string
	slug: string
	description: string | null
	displayOrder: number
	controlCount: number
	appCount: number
	archivedAt: string | null
}

export async function loader({ request }: LoaderFunctionArgs) {
	const authedUser = await requireAuthenticatedUser(request)
	if (!isAdmin(authedUser)) {
		throw new Response("Ikke tilgang", { status: 403 })
	}

	const rawElements = await getAllTechnologyElements({ includeArchived: true })
	const elements: ElementRow[] = await Promise.all(
		rawElements.map(async (el) => {
			const detail = await getTechnologyElementWithCounts(el.id)
			return {
				id: el.id,
				name: el.name,
				slug: el.slug,
				description: el.description,
				displayOrder: el.displayOrder,
				controlCount: detail?.controlCount ?? 0,
				appCount: detail?.appCount ?? 0,
				archivedAt: el.archivedAt ? el.archivedAt.toISOString() : null,
			}
		}),
	)

	return data({ elements })
}

type ActionResult = { success: true; message: string } | { success: false; error: string }

export async function action({ request }: ActionFunctionArgs) {
	const authedUser = await requireAuthenticatedUser(request)
	if (!isAdmin(authedUser)) return data<ActionResult>({ success: false, error: "Ikke tilgang" }, { status: 403 })
	const userId = authedUser.navIdent

	const formData = await request.formData()
	const intent = formData.get("intent")

	switch (intent) {
		case "create-element": {
			const name = formData.get("name")
			const slug = formData.get("slug")
			const description = (formData.get("description") as string)?.trim() || null
			const displayOrder = formData.get("displayOrder")
			if (typeof name !== "string" || !name.trim()) {
				return data<ActionResult>({ success: false, error: "Navn er påkrevd." })
			}
			if (typeof slug !== "string" || !slug.trim()) {
				return data<ActionResult>({ success: false, error: "Slug er påkrevd." })
			}
			const order = Number(displayOrder) || 0
			try {
				await createTechnologyElement(name.trim(), slug.trim(), description, order, userId)
				return data<ActionResult>({ success: true, message: `Element «${name.trim()}» opprettet.` })
			} catch (err) {
				return data<ActionResult>({
					success: false,
					error: err instanceof Error ? err.message : "Ukjent feil",
				})
			}
		}

		case "update-element": {
			const id = formData.get("id")
			const name = formData.get("name")
			const slug = formData.get("slug")
			const description = (formData.get("description") as string)?.trim() || null
			const displayOrder = formData.get("displayOrder")
			if (typeof id !== "string" || typeof name !== "string" || typeof slug !== "string") {
				return data<ActionResult>({ success: false, error: "Mangler påkrevde felt." })
			}
			if (!name.trim() || !slug.trim()) {
				return data<ActionResult>({ success: false, error: "Navn og slug er påkrevd." })
			}
			const order = Number(displayOrder) || 0
			try {
				await updateTechnologyElement(
					id,
					{ name: name.trim(), slug: slug.trim(), description, displayOrder: order },
					userId,
				)
				return data<ActionResult>({ success: true, message: `Element «${name.trim()}» oppdatert.` })
			} catch (err) {
				return data<ActionResult>({
					success: false,
					error: err instanceof Error ? err.message : "Ukjent feil",
				})
			}
		}

		case "archive-element": {
			const id = formData.get("id")
			if (typeof id !== "string") {
				return data<ActionResult>({ success: false, error: "Mangler element-ID." })
			}
			try {
				await archiveTechnologyElement(id, userId)
				return data<ActionResult>({ success: true, message: "Element arkivert." })
			} catch (err) {
				return data<ActionResult>({
					success: false,
					error: err instanceof Error ? err.message : "Ukjent feil",
				})
			}
		}

		case "unarchive-element": {
			const id = formData.get("id")
			if (typeof id !== "string") {
				return data<ActionResult>({ success: false, error: "Mangler element-ID." })
			}
			try {
				await unarchiveTechnologyElement(id, userId)
				return data<ActionResult>({ success: true, message: "Element reaktivert." })
			} catch (err) {
				return data<ActionResult>({
					success: false,
					error: err instanceof Error ? err.message : "Ukjent feil",
				})
			}
		}

		default:
			return data<ActionResult>({ success: false, error: "Ugyldig handling." })
	}
}

function EditElementModal({ element, open, onClose }: { element: ElementRow; open: boolean; onClose: () => void }) {
	return (
		<Modal open={open} onClose={onClose} header={{ heading: `Rediger element: ${element.name}` }}>
			<Modal.Body>
				<Form method="post" onSubmit={onClose}>
					<input type="hidden" name="intent" value="update-element" />
					<input type="hidden" name="id" value={element.id} />
					<VStack gap="space-6">
						<TextField label="Navn" name="name" defaultValue={element.name} />
						<TextField label="Slug" name="slug" defaultValue={element.slug} />
						<Textarea label="Beskrivelse" name="description" defaultValue={element.description ?? ""} minRows={2} />
						<TextField
							label="Visningsrekkefølge"
							name="displayOrder"
							type="number"
							defaultValue={String(element.displayOrder)}
						/>
						<HStack gap="space-4">
							<Button type="submit" variant="primary">
								Lagre
							</Button>
							<Button type="button" variant="tertiary" onClick={onClose}>
								Avbryt
							</Button>
						</HStack>
					</VStack>
				</Form>
			</Modal.Body>
		</Modal>
	)
}

function ArchiveElementModal({ element, open, onClose }: { element: ElementRow; open: boolean; onClose: () => void }) {
	const inUse = element.controlCount > 0 || element.appCount > 0
	return (
		<Modal open={open} onClose={onClose} header={{ heading: `Arkiver element: ${element.name}` }}>
			<Modal.Body>
				<BodyLong>
					Elementet skjules fra velgere og auto-detect, men beholder all data og historikk. Eksisterende koblinger
					(kontroller, applikasjoner, rutiner, screening) påvirkes ikke.
					{inUse && (
						<>
							{" "}
							Elementet er i dag brukt av {element.controlCount} kontroll(er) og {element.appCount} applikasjon(er).
						</>
					)}
				</BodyLong>
			</Modal.Body>
			<Modal.Footer>
				<Form method="post" onSubmit={onClose}>
					<input type="hidden" name="intent" value="archive-element" />
					<input type="hidden" name="id" value={element.id} />
					<HStack gap="space-4">
						<Button type="submit" variant="danger">
							Arkiver
						</Button>
						<Button type="button" variant="tertiary" onClick={onClose}>
							Avbryt
						</Button>
					</HStack>
				</Form>
			</Modal.Footer>
		</Modal>
	)
}

export default function AdminTeknologielementer() {
	const { elements } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const formRef = useRef<HTMLFormElement>(null)
	const [editingElement, setEditingElement] = useState<ElementRow | null>(null)
	const [archivingElement, setArchivingElement] = useState<ElementRow | null>(null)

	return (
		<VStack gap="space-6">
			<Heading size="xlarge" level="2">
				Administrer teknologielementer
			</Heading>
			<BodyLong>Opprett, rediger og slett teknologielementer som brukes i kontroller og applikasjoner.</BodyLong>

			{actionData && "success" in actionData && actionData.success && (
				<Alert variant="success">{actionData.message}</Alert>
			)}
			{actionData && "success" in actionData && !actionData.success && (
				<Alert variant="error">{actionData.error}</Alert>
			)}

			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Opprett nytt element
				</Heading>
				<Form
					method="post"
					ref={formRef}
					onSubmit={() => {
						setTimeout(() => formRef.current?.reset(), 0)
					}}
				>
					<input type="hidden" name="intent" value="create-element" />
					<VStack gap="space-4">
						<HStack gap="space-4" align="end" wrap>
							<TextField label="Navn" name="name" size="small" />
							<TextField label="Slug" name="slug" size="small" />
							<TextField
								label="Rekkefølge"
								name="displayOrder"
								size="small"
								type="number"
								defaultValue="0"
								htmlSize={6}
							/>
						</HStack>
						<Textarea label="Beskrivelse" name="description" size="small" minRows={2} />
						<div>
							<Button type="submit" variant="primary" size="small">
								Opprett
							</Button>
						</div>
					</VStack>
				</Form>
			</VStack>

			{elements.length > 0 && (
				<VStack gap="space-4">
					<Heading size="medium" level="3">
						Eksisterende elementer
					</Heading>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
					<section className="table-scroll" tabIndex={0} aria-label="Teknologielementer">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Navn</Table.HeaderCell>
									<Table.HeaderCell scope="col">Slug</Table.HeaderCell>
									<Table.HeaderCell scope="col">Beskrivelse</Table.HeaderCell>
									<Table.HeaderCell scope="col" align="right">
										Rekkefølge
									</Table.HeaderCell>
									<Table.HeaderCell scope="col" align="right">
										Kontroller
									</Table.HeaderCell>
									<Table.HeaderCell scope="col" align="right">
										Applikasjoner
									</Table.HeaderCell>
									<Table.HeaderCell scope="col">Handlinger</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{elements.map((el) => (
									<Table.Row key={el.id}>
										<Table.DataCell>
											<HStack gap="space-2" align="center">
												{el.name}
												{el.archivedAt && (
													<Tag variant="neutral" size="xsmall">
														Arkivert
													</Tag>
												)}
											</HStack>
										</Table.DataCell>
										<Table.DataCell>
											<Tag variant="info" size="xsmall">
												{el.slug}
											</Tag>
										</Table.DataCell>
										<Table.DataCell>{el.description ?? "–"}</Table.DataCell>
										<Table.DataCell align="right">{el.displayOrder}</Table.DataCell>
										<Table.DataCell align="right">{el.controlCount}</Table.DataCell>
										<Table.DataCell align="right">{el.appCount}</Table.DataCell>
										<Table.DataCell>
											<HStack gap="space-2">
												{!el.archivedAt && (
													<Button variant="tertiary" size="xsmall" onClick={() => setEditingElement(el)}>
														Rediger
													</Button>
												)}
												{el.archivedAt ? (
													<Form method="post">
														<input type="hidden" name="intent" value="unarchive-element" />
														<input type="hidden" name="id" value={el.id} />
														<Button type="submit" variant="tertiary" size="xsmall">
															Reaktiver
														</Button>
													</Form>
												) : (
													<Button variant="tertiary" size="xsmall" onClick={() => setArchivingElement(el)}>
														Arkiver
													</Button>
												)}
											</HStack>
										</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				</VStack>
			)}

			{elements.length === 0 && <BodyLong>Ingen teknologielementer funnet. Opprett et nytt element ovenfor.</BodyLong>}

			{editingElement && (
				<EditElementModal element={editingElement} open={!!editingElement} onClose={() => setEditingElement(null)} />
			)}

			{archivingElement && (
				<ArchiveElementModal
					element={archivingElement}
					open={!!archivingElement}
					onClose={() => setArchivingElement(null)}
				/>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
