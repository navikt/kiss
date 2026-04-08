import { Alert, BodyLong, Button, Heading, HStack, Modal, Table, Tag, TextField, VStack } from "@navikt/ds-react"
import { useRef, useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, useActionData, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getRecentAuditLog } from "~/db/queries/audit.server"
import {
	createDomain,
	deleteDomain,
	getAllActiveDomains,
	getDomainWithCounts,
	updateDomain,
} from "~/db/queries/framework.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"

interface DomainRow {
	id: string
	code: string
	name: string
	displayOrder: number
	riskCount: number
	controlCount: number
}

export async function loader({ request }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const rawDomains = await getAllActiveDomains()
	const domains: DomainRow[] = await Promise.all(
		rawDomains.map(async (d) => {
			const detail = await getDomainWithCounts(d.id)
			return {
				id: d.id,
				code: d.code,
				name: d.name,
				displayOrder: d.displayOrder,
				riskCount: detail?.riskCount ?? 0,
				controlCount: detail?.controlCount ?? 0,
			}
		}),
	)

	const allAudit = await getRecentAuditLog(100)
	const auditEntries = allAudit.filter((e) => e.entityType === "framework_domain")

	return data({ domains, auditEntries })
}

type ActionResult = { success: true; message: string } | { success: false; error: string }

export async function action({ request }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)
	const userId = authedUser.navIdent

	const formData = await request.formData()
	const intent = formData.get("intent")

	switch (intent) {
		case "create-domain": {
			const code = formData.get("code")
			const name = formData.get("name")
			const displayOrder = formData.get("displayOrder")
			if (typeof code !== "string" || !code.trim()) {
				return data<ActionResult>({ success: false, error: "Kode er påkrevd." })
			}
			if (typeof name !== "string" || !name.trim()) {
				return data<ActionResult>({ success: false, error: "Navn er påkrevd." })
			}
			const order = Number(displayOrder) || 0
			try {
				await createDomain(code.trim().toUpperCase(), name.trim(), order, userId)
				return data<ActionResult>({ success: true, message: `Domene «${name.trim()}» opprettet.` })
			} catch (err) {
				return data<ActionResult>({
					success: false,
					error: err instanceof Error ? err.message : "Ukjent feil",
				})
			}
		}

		case "update-domain": {
			const id = formData.get("id")
			const code = formData.get("code")
			const name = formData.get("name")
			const displayOrder = formData.get("displayOrder")
			if (typeof id !== "string" || typeof code !== "string" || typeof name !== "string") {
				return data<ActionResult>({ success: false, error: "Mangler påkrevde felt." })
			}
			if (!code.trim() || !name.trim()) {
				return data<ActionResult>({ success: false, error: "Kode og navn er påkrevd." })
			}
			const order = Number(displayOrder) || 0
			try {
				await updateDomain(id, code.trim().toUpperCase(), name.trim(), order, userId)
				return data<ActionResult>({ success: true, message: `Domene «${name.trim()}» oppdatert.` })
			} catch (err) {
				return data<ActionResult>({
					success: false,
					error: err instanceof Error ? err.message : "Ukjent feil",
				})
			}
		}

		case "delete-domain": {
			const id = formData.get("id")
			if (typeof id !== "string") {
				return data<ActionResult>({ success: false, error: "Mangler domene-ID." })
			}
			try {
				await deleteDomain(id, userId)
				return data<ActionResult>({ success: true, message: "Domene slettet." })
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

function EditDomainModal({ domain, open, onClose }: { domain: DomainRow; open: boolean; onClose: () => void }) {
	return (
		<Modal open={open} onClose={onClose} header={{ heading: `Rediger domene: ${domain.name}` }}>
			<Modal.Body>
				<Form method="post" onSubmit={onClose}>
					<input type="hidden" name="intent" value="update-domain" />
					<input type="hidden" name="id" value={domain.id} />
					<VStack gap="space-6">
						<TextField label="Kode" name="code" defaultValue={domain.code} />
						<TextField label="Navn" name="name" defaultValue={domain.name} />
						<TextField
							label="Visningsrekkefølge"
							name="displayOrder"
							type="number"
							defaultValue={String(domain.displayOrder)}
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

function DeleteDomainModal({ domain, open, onClose }: { domain: DomainRow; open: boolean; onClose: () => void }) {
	const hasChildren = domain.riskCount > 0
	return (
		<Modal open={open} onClose={onClose} header={{ heading: `Slett domene: ${domain.name}` }}>
			<Modal.Body>
				{hasChildren ? (
					<Alert variant="warning">
						Domenet kan ikke slettes fordi det har {domain.riskCount} risikoer tilknyttet. Flytt eller slett disse
						først.
					</Alert>
				) : (
					<BodyLong>Er du sikker på at du vil slette domenet «{domain.name}»?</BodyLong>
				)}
			</Modal.Body>
			<Modal.Footer>
				{hasChildren ? (
					<Button type="button" variant="secondary" onClick={onClose}>
						Lukk
					</Button>
				) : (
					<Form method="post" onSubmit={onClose}>
						<input type="hidden" name="intent" value="delete-domain" />
						<input type="hidden" name="id" value={domain.id} />
						<HStack gap="space-4">
							<Button type="submit" variant="danger">
								Slett
							</Button>
							<Button type="button" variant="tertiary" onClick={onClose}>
								Avbryt
							</Button>
						</HStack>
					</Form>
				)}
			</Modal.Footer>
		</Modal>
	)
}

const actionLabels: Record<string, string> = {
	domain_created: "Domene opprettet",
	domain_updated: "Domene oppdatert",
	domain_deleted: "Domene slettet",
}

export default function AdminDomener() {
	const { domains, auditEntries } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const formRef = useRef<HTMLFormElement>(null)
	const [editingDomain, setEditingDomain] = useState<DomainRow | null>(null)
	const [deletingDomain, setDeletingDomain] = useState<DomainRow | null>(null)

	return (
		<VStack gap="space-6">
			<Heading size="xlarge" level="2">
				Administrer domener
			</Heading>
			<BodyLong>Opprett, rediger og slett domener for risikoer og kontroller i kontrollrammeverket.</BodyLong>

			{actionData && "success" in actionData && actionData.success && (
				<Alert variant="success">{actionData.message}</Alert>
			)}
			{actionData && "success" in actionData && !actionData.success && (
				<Alert variant="error">{actionData.error}</Alert>
			)}

			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Opprett nytt domene
				</Heading>
				<Form
					method="post"
					ref={formRef}
					onSubmit={() => {
						setTimeout(() => formRef.current?.reset(), 0)
					}}
				>
					<input type="hidden" name="intent" value="create-domain" />
					<HStack gap="space-4" align="end" wrap>
						<TextField label="Kode" name="code" size="small" htmlSize={8} />
						<TextField label="Navn" name="name" size="small" />
						<TextField
							label="Rekkefølge"
							name="displayOrder"
							size="small"
							type="number"
							defaultValue="0"
							htmlSize={6}
						/>
						<Button type="submit" variant="primary" size="small">
							Opprett
						</Button>
					</HStack>
				</Form>
			</VStack>

			{domains.length > 0 && (
				<VStack gap="space-4">
					<Heading size="medium" level="3">
						Eksisterende domener
					</Heading>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
					<section className="table-scroll" tabIndex={0} aria-label="Domener">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Kode</Table.HeaderCell>
									<Table.HeaderCell scope="col">Navn</Table.HeaderCell>
									<Table.HeaderCell scope="col" align="right">
										Rekkefølge
									</Table.HeaderCell>
									<Table.HeaderCell scope="col" align="right">
										Risikoer
									</Table.HeaderCell>
									<Table.HeaderCell scope="col" align="right">
										Kontroller
									</Table.HeaderCell>
									<Table.HeaderCell scope="col">Handlinger</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{domains.map((domain) => (
									<Table.Row key={domain.id}>
										<Table.DataCell>
											<Tag variant="info" size="xsmall">
												{domain.code}
											</Tag>
										</Table.DataCell>
										<Table.DataCell>{domain.name}</Table.DataCell>
										<Table.DataCell align="right">{domain.displayOrder}</Table.DataCell>
										<Table.DataCell align="right">{domain.riskCount}</Table.DataCell>
										<Table.DataCell align="right">{domain.controlCount}</Table.DataCell>
										<Table.DataCell>
											<HStack gap="space-2">
												<Button variant="tertiary" size="xsmall" onClick={() => setEditingDomain(domain)}>
													Rediger
												</Button>
												<Button variant="tertiary" size="xsmall" onClick={() => setDeletingDomain(domain)}>
													Slett
												</Button>
											</HStack>
										</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				</VStack>
			)}

			{domains.length === 0 && <BodyLong>Ingen domener funnet. Opprett et nytt domene ovenfor.</BodyLong>}

			{auditEntries.length > 0 && (
				<VStack gap="space-4">
					<Heading size="medium" level="3">
						Endringslogg
					</Heading>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
					<section className="table-scroll" tabIndex={0} aria-label="Endringslogg for domener">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Tidspunkt</Table.HeaderCell>
									<Table.HeaderCell scope="col">Handling</Table.HeaderCell>
									<Table.HeaderCell scope="col">Detaljer</Table.HeaderCell>
									<Table.HeaderCell scope="col">Utført av</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{auditEntries.map((entry) => (
									<Table.Row key={entry.id}>
										<Table.DataCell>{new Date(entry.performedAt).toLocaleString("nb-NO")}</Table.DataCell>
										<Table.DataCell>
											<Tag
												variant={
													entry.action.includes("deleted")
														? "error"
														: entry.action.includes("created")
															? "success"
															: "info"
												}
												size="xsmall"
											>
												{actionLabels[entry.action] ?? entry.action}
											</Tag>
										</Table.DataCell>
										<Table.DataCell>
											{entry.previousValue && entry.newValue
												? `«${entry.previousValue}» → «${entry.newValue}»`
												: entry.newValue
													? `«${entry.newValue}»`
													: entry.previousValue
														? `«${entry.previousValue}»`
														: "–"}
										</Table.DataCell>
										<Table.DataCell>{entry.performedBy}</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				</VStack>
			)}

			{editingDomain && (
				<EditDomainModal domain={editingDomain} open={!!editingDomain} onClose={() => setEditingDomain(null)} />
			)}

			{deletingDomain && (
				<DeleteDomainModal domain={deletingDomain} open={!!deletingDomain} onClose={() => setDeletingDomain(null)} />
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
