import {
	Alert,
	BodyLong,
	Button,
	Detail,
	Heading,
	HStack,
	Modal,
	Select,
	Table,
	Tag,
	Textarea,
	VStack,
} from "@navikt/ds-react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, useActionData, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getRoutinesForSection } from "~/db/queries/routines.server"
import {
	approveRuleset,
	getRulesetDetail,
	getRulesetMeta,
	linkRoutineToRuleset,
	unlinkRoutineFromRuleset,
} from "~/db/queries/rulesets.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { type UserRole, userRoleLabels } from "~/db/schema/organization"
import { approvalStatusConfig } from "~/lib/approval-status"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { hasAnySectionRole, hasExactRoleForSection, isAdmin, requireAdmin } from "~/lib/authorization.server"
import { renderMarkdown } from "~/lib/markdown.server"
import { getFrequencyLabel } from "~/lib/routine-frequencies"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const { seksjon, regelSettId } = params
	if (!seksjon || !regelSettId) throw data({ message: "Mangler parametere" }, { status: 400 })

	const user = await getAuthenticatedUser(request)
	const section = await getSectionBySlug(seksjon)
	if (!section) throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })

	const ruleset = await getRulesetDetail(regelSettId)
	if (!ruleset || ruleset.sectionId !== section.id) {
		throw data({ message: "Fant ikke regelsettet" }, { status: 404 })
	}

	const canApprove =
		user !== null &&
		ruleset.status !== "archived" &&
		((ruleset.responsibleIdent !== null && user.navIdent === ruleset.responsibleIdent) ||
			(ruleset.responsibleRole !== null &&
				hasExactRoleForSection(user, ruleset.responsibleRole as UserRole, section.id)))
	const canEditDraft =
		user !== null &&
		(isAdmin(user) || hasAnySectionRole(user, section.id)) &&
		ruleset.status !== "archived" &&
		ruleset.lastApproval === null
	const userIsAdmin = user ? isAdmin(user) : false
	const canMutate = userIsAdmin && ruleset.status !== "archived"

	// Build display text for responsible
	let responsibleDisplay: string
	if (ruleset.responsibleRole) {
		const roleLabel = userRoleLabels[ruleset.responsibleRole as UserRole] ?? ruleset.responsibleRole
		const holder = ruleset.resolvedResponsible
		responsibleDisplay = holder ? `${roleLabel} (${holder.name})` : `${roleLabel} (ingen tildelt)`
	} else {
		responsibleDisplay = ruleset.responsibleName ?? "Ikke angitt"
	}

	// Load section routines for linking (exclude already-linked ones).
	// Skip når brukeren ikke kan mutere (ikke-admin eller arkivert) for å unngå unødvendig DB-last.
	const sectionRoutines = canMutate ? await getRoutinesForSection(section.id) : []
	const linkedRoutineIds = new Set(ruleset.linkedRoutines.map((r) => r.routineId))
	const availableRoutines = sectionRoutines.filter((r) => !linkedRoutineIds.has(r.id))

	return data({
		section,
		ruleset,
		canApprove,
		canEditDraft,
		canMutate,
		responsibleDisplay,
		descriptionHtml: renderMarkdown(ruleset.description),
		availableRoutines: availableRoutines.map((r) => ({ id: r.id, name: r.name })),
	})
}

type ActionResult = { success: true; message: string } | { success: false; error: string }

export async function action({ request, params }: ActionFunctionArgs) {
	const { seksjon, regelSettId } = params
	if (!seksjon || !regelSettId) throw data({ message: "Mangler parametere" }, { status: 400 })

	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)

	const section = await getSectionBySlug(seksjon)
	if (!section) throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })

	const formData = await request.formData()
	const intent = formData.get("intent")

	switch (intent) {
		case "approve": {
			const ruleset = await getRulesetDetail(regelSettId)
			if (!ruleset || ruleset.sectionId !== section.id) {
				throw data({ message: "Fant ikke regelsettet" }, { status: 404 })
			}

			if (ruleset.status === "archived") {
				return data<ActionResult>({ success: false, error: "Kan ikke godkjenne et arkivert regelsett." })
			}

			const canApprove =
				(ruleset.responsibleIdent !== null && authedUser.navIdent === ruleset.responsibleIdent) ||
				(ruleset.responsibleRole !== null &&
					hasExactRoleForSection(authedUser, ruleset.responsibleRole as UserRole, ruleset.sectionId))
			if (!canApprove) throw new Response("Ikke autorisert", { status: 403 })

			const comment = formData.get("comment")
			const approvalId = await approveRuleset({
				rulesetId: regelSettId,
				approvedBy: authedUser.navIdent,
				approvedByName: authedUser.name,
				comment: typeof comment === "string" && comment.trim() ? comment.trim() : undefined,
				frequency: ruleset.frequency,
			})
			if (!approvalId) {
				return data<ActionResult>({
					success: false,
					error: "Regelsettet ble arkivert før godkjenningen kunne lagres.",
				})
			}

			return data<ActionResult>({ success: true, message: "Regelsett godkjent." })
		}

		case "link-routine": {
			requireAdmin(authedUser)
			const meta = await getRulesetMeta(regelSettId)
			if (!meta || meta.sectionId !== section.id) {
				throw data({ message: "Fant ikke regelsettet" }, { status: 404 })
			}
			if (meta.archivedAt) {
				return data<ActionResult>({ success: false, error: "Kan ikke endre koblinger på et arkivert regelsett." })
			}
			const routineId = formData.get("routineId")
			if (typeof routineId !== "string" || !routineId.trim()) {
				return data<ActionResult>({ success: false, error: "Velg en rutine." })
			}
			const linked = await linkRoutineToRuleset(regelSettId, routineId.trim(), authedUser.navIdent)
			if (!linked) {
				return data<ActionResult>({
					success: false,
					error:
						"Kunne ikke koble rutinen til regelsettet. Rutinen kan være ugyldig eller tilhøre en annen seksjon, eller regelsettet kan være arkivert.",
				})
			}
			return data<ActionResult>({ success: true, message: "Rutine koblet til regelsettet." })
		}

		case "unlink-routine": {
			requireAdmin(authedUser)
			const meta = await getRulesetMeta(regelSettId)
			if (!meta || meta.sectionId !== section.id) {
				throw data({ message: "Fant ikke regelsettet" }, { status: 404 })
			}
			if (meta.archivedAt) {
				return data<ActionResult>({ success: false, error: "Kan ikke endre koblinger på et arkivert regelsett." })
			}
			const linkId = formData.get("linkId")
			if (typeof linkId !== "string" || !linkId.trim()) {
				return data<ActionResult>({ success: false, error: "Mangler kobling-ID." })
			}
			const unlinked = await unlinkRoutineFromRuleset(regelSettId, linkId.trim(), authedUser.navIdent)
			if (!unlinked) {
				return data<ActionResult>({
					success: false,
					error: "Regelsettet er arkivert eller finnes ikke.",
				})
			}
			return data<ActionResult>({ success: true, message: "Rutine fjernet fra regelsettet." })
		}

		default:
			return data<ActionResult>({ success: false, error: "Ugyldig handling." })
	}
}

export default function RegelsettDetalj() {
	const {
		section,
		ruleset,
		canApprove,
		canEditDraft,
		canMutate,
		responsibleDisplay,
		descriptionHtml,
		availableRoutines,
	} = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const [approveOpen, setApproveOpen] = useState(false)

	const cfg = approvalStatusConfig[ruleset.approvalStatus]

	return (
		<VStack gap="space-6">
			<HStack justify="space-between" align="center">
				<Heading size="large">{ruleset.name}</Heading>
				<HStack gap="space-2">
					{canApprove && (
						<Button variant="primary" size="small" onClick={() => setApproveOpen(true)}>
							Godkjenn
						</Button>
					)}
					{canEditDraft && (
						<Button
							as={Link}
							to={`/seksjoner/${section.slug}/regelsett/${ruleset.id}/rediger`}
							variant="secondary"
							size="small"
						>
							Rediger
						</Button>
					)}
				</HStack>
			</HStack>

			{actionData && "success" in actionData && actionData.success && (
				<Alert variant="success">{actionData.message}</Alert>
			)}
			{actionData && "success" in actionData && !actionData.success && (
				<Alert variant="error">{actionData.error}</Alert>
			)}

			<Tag variant={cfg.variant} size="small">
				{cfg.label}
			</Tag>

			<VStack gap="space-4">
				<HStack gap="space-12" wrap>
					<VStack gap="space-1">
						<Detail textColor="subtle">Ansvarlig</Detail>
						<BodyLong>{responsibleDisplay}</BodyLong>
					</VStack>
					<VStack gap="space-1">
						<Detail textColor="subtle">Frekvens</Detail>
						<BodyLong>{getFrequencyLabel(ruleset.frequency)}</BodyLong>
					</VStack>
					<VStack gap="space-1">
						<Detail textColor="subtle">Gyldig til</Detail>
						<BodyLong>
							{ruleset.lastApproval
								? new Date(ruleset.lastApproval.validUntil).toLocaleDateString("nb-NO")
								: "Ikke godkjent"}
						</BodyLong>
					</VStack>
				</HStack>

				{descriptionHtml && (
					<VStack gap="space-1">
						<Heading size="small" level="3">
							Beskrivelse
						</Heading>
						{/* biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized via DOMPurify in renderMarkdown */}
						<div className="markdown-content" dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
					</VStack>
				)}
			</VStack>

			{ruleset.controls.length > 0 && (
				<VStack gap="space-4">
					<Heading size="small" level="3">
						Tilknyttede kontrollkrav
					</Heading>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
					<section className="table-scroll" tabIndex={0} aria-label="Tilknyttede kontrollkrav">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Kontroll-ID</Table.HeaderCell>
									<Table.HeaderCell scope="col">Navn</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{ruleset.controls.map((c) => (
									<Table.Row key={c.id}>
										<Table.DataCell>
											<Link to={`/kontrollrammeverk/_/${c.controlId}`}>{c.controlId}</Link>
										</Table.DataCell>
										<Table.DataCell>{c.shortTitle ?? "–"}</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				</VStack>
			)}

			<VStack gap="space-4">
				<Heading size="small" level="3">
					Tilknyttede rutiner
				</Heading>
				{ruleset.linkedRoutines.length > 0 && (
					/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
					<section className="table-scroll" tabIndex={0} aria-label="Tilknyttede rutiner">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Rutine</Table.HeaderCell>
									<Table.HeaderCell scope="col">Lagt til av</Table.HeaderCell>
									<Table.HeaderCell scope="col">Dato</Table.HeaderCell>
									{canMutate && <Table.HeaderCell scope="col" />}
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{ruleset.linkedRoutines.map((r) => (
									<Table.Row key={r.linkId}>
										<Table.DataCell>
											<Link to={`/seksjoner/${section.slug}/rutiner/${r.routineId}`}>{r.routineName}</Link>
										</Table.DataCell>
										<Table.DataCell>{r.createdBy}</Table.DataCell>
										<Table.DataCell>{new Date(r.createdAt).toLocaleDateString("nb-NO")}</Table.DataCell>
										{canMutate && (
											<Table.DataCell>
												<Form method="post">
													<input type="hidden" name="intent" value="unlink-routine" />
													<input type="hidden" name="linkId" value={r.linkId} />
													<Button variant="tertiary-neutral" size="xsmall" type="submit">
														Fjern
													</Button>
												</Form>
											</Table.DataCell>
										)}
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				)}
				{ruleset.linkedRoutines.length === 0 && <BodyLong>Ingen rutiner er koblet til dette regelsettet.</BodyLong>}
				{canMutate && availableRoutines.length > 0 && (
					<Form method="post">
						<input type="hidden" name="intent" value="link-routine" />
						<HStack gap="space-4" align="end">
							<Select label="Legg til rutine" name="routineId" size="small">
								<option value="">Velg rutine…</option>
								{availableRoutines.map((r) => (
									<option key={r.id} value={r.id}>
										{r.name}
									</option>
								))}
							</Select>
							<Button variant="secondary" size="small" type="submit">
								Legg til
							</Button>
						</HStack>
					</Form>
				)}
			</VStack>

			{ruleset.approvals.length > 0 && (
				<VStack gap="space-4">
					<Heading size="small" level="3">
						Godkjenningshistorikk
					</Heading>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
					<section className="table-scroll" tabIndex={0} aria-label="Godkjenningshistorikk">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Godkjent av</Table.HeaderCell>
									<Table.HeaderCell scope="col">Gyldig fra</Table.HeaderCell>
									<Table.HeaderCell scope="col">Gyldig til</Table.HeaderCell>
									<Table.HeaderCell scope="col">Kommentar</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{ruleset.approvals.map((a) => (
									<Table.Row key={a.id}>
										<Table.DataCell>{a.approvedByName}</Table.DataCell>
										<Table.DataCell>{new Date(a.validFrom).toLocaleDateString("nb-NO")}</Table.DataCell>
										<Table.DataCell>{new Date(a.validUntil).toLocaleDateString("nb-NO")}</Table.DataCell>
										<Table.DataCell>{a.comment ?? "–"}</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				</VStack>
			)}

			{ruleset.attachments.length > 0 && (
				<VStack gap="space-4">
					<Heading size="small" level="3">
						Vedlegg
					</Heading>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
					<section className="table-scroll" tabIndex={0} aria-label="Vedlegg">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Filnavn</Table.HeaderCell>
									<Table.HeaderCell scope="col">Lastet opp av</Table.HeaderCell>
									<Table.HeaderCell scope="col">Dato</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{ruleset.attachments.map((a) => (
									<Table.Row key={a.id}>
										<Table.DataCell>{a.fileName}</Table.DataCell>
										<Table.DataCell>{a.uploadedBy}</Table.DataCell>
										<Table.DataCell>{new Date(a.uploadedAt).toLocaleDateString("nb-NO")}</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				</VStack>
			)}

			<Detail textColor="subtle">
				Opprettet {new Date(ruleset.createdAt).toLocaleDateString("nb-NO")} av {ruleset.createdBy}. Sist endret{" "}
				{new Date(ruleset.updatedAt).toLocaleDateString("nb-NO")} av {ruleset.updatedBy}.
			</Detail>

			<Modal open={approveOpen} onClose={() => setApproveOpen(false)} header={{ heading: "Godkjenn regelsett" }}>
				<Modal.Body>
					<Form method="post" onSubmit={() => setApproveOpen(false)}>
						<input type="hidden" name="intent" value="approve" />
						<VStack gap="space-4">
							<BodyLong>
								Godkjenn «{ruleset.name}». Godkjenningen vil være gyldig i{" "}
								{getFrequencyLabel(ruleset.frequency).toLowerCase()}.
							</BodyLong>
							<Textarea label="Kommentar (valgfri)" name="comment" />
							<HStack gap="space-4">
								<Button type="submit" variant="primary">
									Godkjenn
								</Button>
								<Button type="button" variant="tertiary" onClick={() => setApproveOpen(false)}>
									Avbryt
								</Button>
							</HStack>
						</VStack>
					</Form>
				</Modal.Body>
			</Modal>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
