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
import { Fragment, useState } from "react"
import { data, Form, Link, redirect, useActionData, useLoaderData, useNavigation } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { UserDisplayName } from "~/components/UserDisplayName"
import { getAuditLogForEntity } from "~/db/queries/audit.server"
import { getRoutinesForSection } from "~/db/queries/routines.server"
import {
	approveRuleset,
	copyRuleset,
	copyRulesetToSection,
	getRulesetDetail,
	getRulesetMeta,
	getRulesetNamesByIds,
	linkRoutineToRuleset,
	replaceRuleset,
	unlinkRoutineFromRuleset,
} from "~/db/queries/rulesets.server"
import { getSectionBySlug, getSections } from "~/db/queries/sections.server"
import { getUserNamesByNavIdents } from "~/db/queries/users.server"
import { type UserRole, userRoleLabels } from "~/db/schema/organization"
import { approvalStatusConfig } from "~/lib/approval-status"
import { getAuthenticatedUser, requireAuthenticatedUser } from "~/lib/auth.server"
import {
	hasAnySectionRole,
	hasExactRoleForSection,
	isAdmin,
	requireAdmin,
	requireAnySectionRole,
} from "~/lib/authorization.server"
import { renderMarkdown } from "~/lib/markdown.server"
import { getFrequencyLabel } from "~/lib/routine-frequencies"
import type { Route } from "./+types/index"

const auditActionLabels: Record<string, string> = {
	ruleset_created: "Regelsett opprettet",
	ruleset_updated: "Regelsett oppdatert",
	ruleset_archived: "Regelsett arkivert",
	ruleset_unarchived: "Regelsett gjenåpnet",
	ruleset_approved: "Regelsett godkjent",
	ruleset_copied: "Kopiert for redigering",
	ruleset_copied_cross_section: "Kopiert til/fra annen seksjon",
	ruleset_replaced: "Erstattet gammelt regelsett",
	ruleset_routine_added: "Rutine koblet til",
	ruleset_routine_removed: "Rutine frakoblet",
	ruleset_control_added: "Kontroll koblet til",
	ruleset_control_removed: "Kontroll frakoblet",
}

function formatDateTime(date: string | Date | null): string {
	if (!date) return "—"
	return new Date(date).toLocaleDateString("nb-NO", {
		day: "numeric",
		month: "numeric",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	})
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const { seksjon, regelSettId } = params
	if (!seksjon || !regelSettId) throw data({ message: "Mangler parametere" }, { status: 400 })

	const user = await getAuthenticatedUser(request)
	const section = await getSectionBySlug(seksjon)
	if (!section) throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })

	const ruleset = await getRulesetDetail(regelSettId)
	if (!ruleset || ruleset.sectionId !== section.id) {
		throw data({ message: "Fant ikke regelsettet" }, { status: 404 })
	}

	// Godkjenning (både første gangs og erstatning av et opprinnelig
	// regelsett via `sourceRulesetId`) er kun meningsfullt når regelsettet
	// fortsatt er `draft` — et allerede aktivt regelsett skal ikke kunne
	// "godkjennes" på nytt (se replaceRuleset()/approveRuleset(), som begge
	// krever `status === 'draft'`).
	const canApprove =
		user !== null &&
		ruleset.status === "draft" &&
		((ruleset.responsibleIdent !== null && user.navIdent === ruleset.responsibleIdent) ||
			(ruleset.responsibleRole !== null &&
				hasExactRoleForSection(user, ruleset.responsibleRole as UserRole, section.id)))
	// Innhold kan kun redigeres direkte når regelsettet er `draft` (aldri
	// godkjent). Et godkjent regelsett må kopieres (se `canCopy`) og
	// gjennom en ny godkjenningsrunde for å erstattes.
	const canEditDraft = user !== null && ruleset.status === "draft" && hasAnySectionRole(user, section.id)
	const canCopy = user !== null && ruleset.status === "active" && hasAnySectionRole(user, section.id)
	const userIsAdmin = user ? isAdmin(user) : false
	// Kobling til rutiner endrer hva regelsettet reelt sett dekker, og skal
	// derfor kun kunne gjøres på `draft` — samme prinsipp som for innhold.
	const canMutate = userIsAdmin && ruleset.status === "draft"

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

	// ruleset_routine_added/removed og ruleset_control_added/removed skrives med
	// entityType "ruleset_routine"/"ruleset_control" og regelsettets ID (se
	// copyRulesetToSection/linkRoutineToRuleset/linkControlToRuleset), ikke "ruleset" —
	// alle tre må derfor hentes og slås sammen for å vise en komplett endringslogg.
	const [rulesetAuditLog, rulesetRoutineAuditLog, rulesetControlAuditLog] = await Promise.all([
		getAuditLogForEntity("ruleset", regelSettId),
		getAuditLogForEntity("ruleset_routine", regelSettId),
		getAuditLogForEntity("ruleset_control", regelSettId),
	])
	const auditLog = [...rulesetAuditLog, ...rulesetRoutineAuditLog, ...rulesetControlAuditLog].sort(
		(a, b) => new Date(b.performedAt).getTime() - new Date(a.performedAt).getTime(),
	)

	const userNames = await getUserNamesByNavIdents([
		ruleset.createdBy,
		ruleset.updatedBy,
		...ruleset.linkedRoutines.map((r) => r.createdBy),
		...ruleset.attachments.map((a) => a.uploadedBy),
		...auditLog.map((entry) => entry.performedBy),
	])
	const nameFor = (navIdent: string) => userNames.get(navIdent.trim().toUpperCase()) ?? null

	// Hent navn for forgjenger (source) og erstatter (replaced-by) til lineage-visning
	const lineageIds = [ruleset.sourceRulesetId, ruleset.replacedByRulesetId].filter(
		(id): id is string => id !== null && id !== undefined,
	)
	const lineageNames = await getRulesetNamesByIds(lineageIds)
	const predecessorInfo = ruleset.sourceRulesetId ? (lineageNames.get(ruleset.sourceRulesetId) ?? null) : null
	const successorInfo = ruleset.replacedByRulesetId ? (lineageNames.get(ruleset.replacedByRulesetId) ?? null) : null

	// Seksjoner brukeren kan kopiere DETTE regelsettet inn i (utenom seksjonen det allerede
	// ligger i, som har sin egen "kopier for redigering"-knapp via `copyRuleset()`).
	const copyTargetSections = user
		? (await getSections()).filter((s) => s.id !== section.id && hasAnySectionRole(user, s.id))
		: []

	return data({
		section,
		ruleset: {
			...ruleset,
			createdByName: nameFor(ruleset.createdBy),
			updatedByName: nameFor(ruleset.updatedBy),
			linkedRoutines: ruleset.linkedRoutines.map((r) => ({
				...r,
				createdByName: nameFor(r.createdBy),
			})),
			attachments: ruleset.attachments.map((a) => ({
				...a,
				uploadedByName: nameFor(a.uploadedBy),
			})),
		},
		predecessorInfo,
		successorInfo,
		canApprove,
		canCopy,
		canEditDraft,
		canMutate,
		responsibleDisplay,
		descriptionHtml: renderMarkdown(ruleset.description),
		availableRoutines: availableRoutines.map((r) => ({ id: r.id, name: r.name })),
		copyTargetSections,
		auditLog: auditLog.map((entry) => ({
			...entry,
			performedByName: nameFor(entry.performedBy),
		})),
	})
}

type ActionResult = { success: true; message: string } | { success: false; error: string }

export async function action({ request, params }: Route.ActionArgs) {
	const { seksjon, regelSettId } = params
	if (!seksjon || !regelSettId) throw data({ message: "Mangler parametere" }, { status: 400 })

	const authedUser = await requireAuthenticatedUser(request)

	const section = await getSectionBySlug(seksjon)
	if (!section) throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })

	const formData = await request.formData()
	const intent = formData.get("intent")

	switch (intent) {
		case "copy": {
			if (!hasAnySectionRole(authedUser, section.id)) {
				throw data({ message: "Du har ikke rettigheter til å kopiere regelsett i denne seksjonen" }, { status: 403 })
			}
			const meta = await getRulesetMeta(regelSettId)
			if (!meta || meta.sectionId !== section.id) {
				throw data({ message: "Fant ikke regelsettet" }, { status: 404 })
			}
			if (meta.archivedAt) {
				return data<ActionResult>({
					success: false,
					error: "Arkiverte regelsett kan ikke kopieres. Reaktiver regelsettet først.",
				})
			}
			if (meta.status !== "active") {
				return data<ActionResult>({
					success: false,
					error: "Kun godkjente regelsett kan kopieres for redigering.",
				})
			}
			const copy = await copyRuleset(regelSettId, authedUser.navIdent)
			if (!copy) {
				return data<ActionResult>({ success: false, error: "Kunne ikke kopiere regelsettet." })
			}
			return redirect(`/seksjoner/${seksjon}/regelsett/${copy.id}/rediger`)
		}

		case "copy-to-section": {
			const targetSectionId = formData.get("targetSectionId")
			if (typeof targetSectionId !== "string" || !targetSectionId.trim()) {
				return data<ActionResult>({ success: false, error: "Velg en seksjon å kopiere til." })
			}
			// Retten sjekkes mot MÅLseksjonen (der regelsettet skal opprettes), ikke
			// seksjonen regelsettet kopieres fra.
			requireAnySectionRole(authedUser, targetSectionId.trim())
			const meta = await getRulesetMeta(regelSettId)
			if (!meta || meta.sectionId !== section.id) {
				throw data({ message: "Fant ikke regelsettet" }, { status: 404 })
			}
			if (meta.archivedAt) {
				return data<ActionResult>({
					success: false,
					error: "Arkiverte regelsett kan ikke kopieres. Reaktiver regelsettet først.",
				})
			}
			// Målseksjonen valideres FØR kopieringen for å unngå at kopien opprettes
			// mot en arkivert seksjon. Selve slug-en til redirect-URL-en hentes derimot
			// PÅ NYTT etter kopieringen (ikke gjenbrukt fra denne pre-sjekken), siden
			// en seksjon kan bli omdøpt (ny slug) i vinduet mellom validering og kopi.
			const targetSectionExists = (await getSections()).some((s) => s.id === targetSectionId.trim())
			if (!targetSectionExists) {
				return data<ActionResult>({ success: false, error: "Fant ikke målseksjonen." })
			}
			const copy = await copyRulesetToSection(regelSettId, targetSectionId.trim(), authedUser.navIdent)
			if (!copy) {
				return data<ActionResult>({ success: false, error: "Kunne ikke kopiere regelsettet." })
			}
			const targetSection = (await getSections({ includeArchived: true })).find((s) => s.id === targetSectionId.trim())
			if (!targetSection) {
				// Uventet siden kopieringen selv nettopp validerte seksjonen, men uten
				// en gyldig slug kan vi ikke bygge redirect-URL-en.
				return data<ActionResult>({ success: false, error: "Fant ikke målseksjonen etter kopiering." })
			}
			return redirect(`/seksjoner/${targetSection.slug}/regelsett/${copy.id}/rediger`)
		}

		case "approve": {
			const ruleset = await getRulesetDetail(regelSettId)
			if (!ruleset || ruleset.sectionId !== section.id) {
				throw data({ message: "Fant ikke regelsettet" }, { status: 404 })
			}

			if (ruleset.status === "archived") {
				return data<ActionResult>({ success: false, error: "Kan ikke godkjenne et arkivert regelsett." })
			}
			// Godkjenning (og en eventuell erstatning via `sourceRulesetId`) skal
			// kun kunne skje mens regelsettet er `draft`. Uten denne sjekken vil
			// et regelsett som allerede er erstattet én gang (og fortsatt har
			// `sourceRulesetId` for lineage) forsøke å erstatte på nytt ved et
			// senere «Godkjenn»-klikk, noe som feiler i replaceRuleset().
			if (ruleset.status !== "draft") {
				return data<ActionResult>({ success: false, error: "Regelsettet er allerede godkjent." })
			}

			const canApprove =
				(ruleset.responsibleIdent !== null && authedUser.navIdent === ruleset.responsibleIdent) ||
				(ruleset.responsibleRole !== null &&
					hasExactRoleForSection(authedUser, ruleset.responsibleRole as UserRole, ruleset.sectionId))
			if (!canApprove) throw new Response("Ikke autorisert", { status: 403 })

			const comment = formData.get("comment")

			// Hvis regelsettet er en redigert kopi (opprettet via copyRuleset), skal
			// godkjenning erstatte det opprinnelige regelsettet i stedet for en
			// vanlig fornyelse — se replaceRuleset(). Funksjonen returnerer aldri
			// null; feil kastes som Response og håndteres av rutens feilgrense.
			if (ruleset.sourceRulesetId) {
				await replaceRuleset({
					newRulesetId: regelSettId,
					oldRulesetId: ruleset.sourceRulesetId,
					approvedBy: authedUser.navIdent,
					approvedByName: authedUser.name,
					comment: typeof comment === "string" && comment.trim() ? comment.trim() : undefined,
				})
				return data<ActionResult>({ success: true, message: "Regelsett godkjent og opprinnelig versjon erstattet." })
			}

			const approvalId = await approveRuleset({
				rulesetId: regelSettId,
				approvedBy: authedUser.navIdent,
				approvedByName: authedUser.name,
				comment: typeof comment === "string" && comment.trim() ? comment.trim() : undefined,
			})
			if (!approvalId) {
				return data<ActionResult>({
					success: false,
					error: "Regelsettet ble arkivert eller allerede godkjent før godkjenningen kunne lagres.",
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
			if (meta.status !== "draft") {
				return data<ActionResult>({
					success: false,
					error: "Regelsettet er godkjent og kan ikke redigeres direkte. Kopier det for å redigere.",
				})
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
			if (meta.status !== "draft") {
				return data<ActionResult>({
					success: false,
					error: "Regelsettet er godkjent og kan ikke redigeres direkte. Kopier det for å redigere.",
				})
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
		predecessorInfo,
		successorInfo,
		canApprove,
		canCopy,
		canEditDraft,
		canMutate,
		responsibleDisplay,
		descriptionHtml,
		availableRoutines,
		copyTargetSections,
		auditLog,
	} = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const navigation = useNavigation()
	const [approveOpen, setApproveOpen] = useState(false)
	const [copyTargetSectionId, setCopyTargetSectionId] = useState("")

	const cfg = approvalStatusConfig[ruleset.approvalStatus]

	return (
		<VStack gap="space-6">
			<HStack justify="space-between" align="center">
				<Heading size="large">{ruleset.name}</Heading>
				<HStack gap="space-2" align="end" wrap>
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
					{canCopy && (
						<Form method="post">
							<input type="hidden" name="intent" value="copy" />
							<Button type="submit" variant="secondary" size="small">
								Kopier for redigering
							</Button>
						</Form>
					)}
					{ruleset.status !== "archived" && copyTargetSections.length > 0 && (
						<Form method="post">
							<input type="hidden" name="intent" value="copy-to-section" />
							<HStack gap="space-4" align="end">
								<Select
									label="Kopier til seksjon"
									size="small"
									name="targetSectionId"
									value={copyTargetSectionId}
									onChange={(e) => setCopyTargetSectionId(e.target.value)}
								>
									<option value="">Velg seksjon</option>
									{copyTargetSections.map((s) => (
										<option key={s.id} value={s.id}>
											{s.name}
										</option>
									))}
								</Select>
								<Button
									type="submit"
									variant="secondary"
									size="small"
									disabled={!copyTargetSectionId}
									loading={navigation.state !== "idle" && navigation.formData?.get("intent") === "copy-to-section"}
								>
									Kopier til min seksjon
								</Button>
							</HStack>
						</Form>
					)}
				</HStack>
			</HStack>

			{(predecessorInfo ||
				successorInfo ||
				(ruleset.status !== "active" && ruleset.status !== "archived" && copyTargetSections.length > 0)) && (
				<HStack gap="space-4" wrap>
					{predecessorInfo && (
						<Alert variant="info" size="small">
							{ruleset.status === "draft" ? (
								<>Dette er en kopi som vil erstatte «{predecessorInfo.name}» ved godkjenning. </>
							) : (
								<>Dette regelsettet erstattet «{predecessorInfo.name}». </>
							)}
							<Link to={`/seksjoner/${section.slug}/regelsett/${ruleset.sourceRulesetId}`}>Se forrige versjon</Link>
						</Alert>
					)}
					{successorInfo && (
						<Alert variant="warning" size="small">
							Dette regelsettet er erstattet av «{successorInfo.name}».{" "}
							<Link to={`/seksjoner/${section.slug}/regelsett/${ruleset.replacedByRulesetId}`}>Se ny versjon</Link>
						</Alert>
					)}
					{ruleset.status !== "active" && ruleset.status !== "archived" && copyTargetSections.length > 0 && (
						<Alert variant="warning" size="small">
							Regelsettet har status «{ruleset.status}» og er ikke ferdig kvalitetssikret. Vurder om innholdet er ferdig
							og godt nok før det kopieres til en annen seksjon.
						</Alert>
					)}
				</HStack>
			)}

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
									<Fragment key={c.id}>
										<Table.Row>
											<Table.DataCell>
												<Link to={`/kontrollrammeverk/_/${c.controlId}`}>{c.controlId}</Link>
											</Table.DataCell>
											<Table.DataCell>{c.shortTitle ?? "–"}</Table.DataCell>
										</Table.Row>
										<Table.Row>
											<Table.DataCell colSpan={2}>
												<Detail textColor="subtle">Krav</Detail>
												<BodyLong size="small">{c.requirement ?? "–"}</BodyLong>
											</Table.DataCell>
										</Table.Row>
									</Fragment>
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
										<Table.DataCell>
											<UserDisplayName navIdent={r.createdBy} name={r.createdByName} />
										</Table.DataCell>
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
										<Table.DataCell>
											<UserDisplayName navIdent={a.uploadedBy} name={a.uploadedByName} />
										</Table.DataCell>
										<Table.DataCell>{new Date(a.uploadedAt).toLocaleDateString("nb-NO")}</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				</VStack>
			)}

			{auditLog.length > 0 && (
				<VStack gap="space-4">
					<Heading size="medium" level="3">
						Endringslogg
					</Heading>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
					<section className="table-scroll" tabIndex={0} aria-label="Endringslogg for regelsettet">
						<Table size="small">
							<caption className="navds-sr-only">Endringslogg for regelsettet</caption>
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Tidspunkt</Table.HeaderCell>
									<Table.HeaderCell scope="col">Handling</Table.HeaderCell>
									<Table.HeaderCell scope="col">Detaljer</Table.HeaderCell>
									<Table.HeaderCell scope="col">Utført av</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{auditLog.map((entry) => (
									<Table.Row key={entry.id}>
										<Table.DataCell>{formatDateTime(entry.performedAt)}</Table.DataCell>
										<Table.DataCell>
											<Tag variant={entry.action === "ruleset_archived" ? "warning" : "info"} size="xsmall">
												{auditActionLabels[entry.action] ?? entry.action}
											</Tag>
										</Table.DataCell>
										<Table.DataCell>
											{entry.previousValue != null && entry.newValue != null
												? `«${entry.previousValue}» → «${entry.newValue}»`
												: entry.newValue != null
													? `«${entry.newValue}»`
													: entry.previousValue != null
														? `«${entry.previousValue}»`
														: "–"}
										</Table.DataCell>
										<Table.DataCell>
											<UserDisplayName navIdent={entry.performedBy} name={entry.performedByName} />
										</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				</VStack>
			)}

			<Detail textColor="subtle">
				Opprettet {new Date(ruleset.createdAt).toLocaleDateString("nb-NO")} av{" "}
				<UserDisplayName navIdent={ruleset.createdBy} name={ruleset.createdByName} />. Sist endret{" "}
				{new Date(ruleset.updatedAt).toLocaleDateString("nb-NO")} av{" "}
				<UserDisplayName navIdent={ruleset.updatedBy} name={ruleset.updatedByName} />.
			</Detail>

			<Modal
				open={approveOpen}
				onClose={() => setApproveOpen(false)}
				header={{ heading: ruleset.sourceRulesetId ? "Godkjenn og erstatt regelsett" : "Godkjenn regelsett" }}
			>
				<Modal.Body>
					<Form method="post" onSubmit={() => setApproveOpen(false)}>
						<input type="hidden" name="intent" value="approve" />
						<VStack gap="space-4">
							<BodyLong>
								{ruleset.sourceRulesetId
									? `Godkjenn «${ruleset.name}». Dette erstatter forrige versjon${predecessorInfo ? ` («${predecessorInfo.name}»)` : ""}, som arkiveres. Godkjenningen vil være gyldig i ${getFrequencyLabel(ruleset.frequency).toLowerCase()}.`
									: `Godkjenn «${ruleset.name}». Godkjenningen vil være gyldig i ${getFrequencyLabel(ruleset.frequency).toLowerCase()}.`}
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
