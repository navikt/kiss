import {
	Alert,
	BodyLong,
	Button,
	Heading,
	HStack,
	Radio,
	RadioGroup,
	Select,
	Table,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, redirect, useActionData, useLoaderData } from "react-router"
import { MarkdownEditor } from "~/components/MarkdownEditor"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAllControlsForSelection } from "~/db/queries/framework.server"
import {
	archiveRuleset,
	getRulesetDetail,
	getRulesetMeta,
	linkControlToRuleset,
	unarchiveRuleset,
	unlinkControlFromRuleset,
	updateRuleset,
} from "~/db/queries/rulesets.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { type UserRole, userRoleLabels } from "~/db/schema/organization"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"
import {
	frequencyLabels,
	isRoutineFrequency,
	ROUTINE_FREQUENCIES,
	type RoutineFrequency,
} from "~/lib/routine-frequencies"

const assignableRoles: UserRole[] = [
	"section_manager",
	"tech_manager",
	"delivery_manager",
	"product_owner",
	"tech_lead",
	"system_owner",
]

export async function loader({ request, params }: LoaderFunctionArgs) {
	const { seksjon, regelSettId } = params
	if (!seksjon || !regelSettId) throw data({ message: "Mangler parametere" }, { status: 400 })

	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const section = await getSectionBySlug(seksjon)
	if (!section) throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })

	const ruleset = await getRulesetDetail(regelSettId)
	if (!ruleset || ruleset.sectionId !== section.id) {
		throw data({ message: "Fant ikke regelsettet" }, { status: 404 })
	}

	const allControls = await getAllControlsForSelection()

	return data({
		section,
		ruleset,
		allControls,
		frequencies: ROUTINE_FREQUENCIES.map((f) => ({ value: f, label: frequencyLabels[f] })),
	})
}

type ActionResult = { success: true; message: string } | { success: false; error: string }

export async function action({ request, params }: ActionFunctionArgs) {
	const { seksjon, regelSettId } = params
	if (!seksjon || !regelSettId) throw data({ message: "Mangler parametere" }, { status: 400 })

	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const section = await getSectionBySlug(seksjon)
	if (!section) throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })

	const formData = await request.formData()
	const intent = formData.get("intent")

	// Mutasjoner som krever at regelsettet er aktivt (ikke arkivert) — pluss
	// `archive`/`unarchive` som er statusoverganger og som må valideres mot
	// `seksjon`. Bruker lett `getRulesetMeta` for ren guard (arkiv-status og
	// section-binding) — DB-laget har egne TOCTOU-guards, enten som guarded
	// UPDATE eller via transaksjon + FOR SHARE, avhengig av mutasjonen.
	if (intent === "update" || intent === "link-control" || intent === "unlink-control") {
		const current = await getRulesetMeta(regelSettId)
		if (!current || current.sectionId !== section.id) {
			throw data({ message: "Fant ikke regelsettet" }, { status: 404 })
		}
		if (current.archivedAt) {
			return data<ActionResult>({
				success: false,
				error: "Regelsettet er arkivert. Reaktiver det før du gjør endringer.",
			})
		}
	}
	if (intent === "archive" || intent === "unarchive") {
		const current = await getRulesetMeta(regelSettId)
		if (!current || current.sectionId !== section.id) {
			throw data({ message: "Fant ikke regelsettet" }, { status: 404 })
		}
	}

	switch (intent) {
		case "update": {
			const name = formData.get("name")
			const description = formData.get("description")
			const responsibleType = formData.get("responsibleType")
			const responsibleIdent = formData.get("responsibleIdent")
			const responsibleName = formData.get("responsibleName")
			const responsibleRole = formData.get("responsibleRole")
			const frequency = formData.get("frequency")

			if (typeof name !== "string" || !name.trim()) {
				return data<ActionResult>({ success: false, error: "Navn er påkrevd." })
			}

			const isRoleBased = responsibleType === "role"

			const updated = await updateRuleset(regelSettId, {
				name: name.trim(),
				description: typeof description === "string" ? description.trim() || null : undefined,
				responsibleIdent: isRoleBased
					? null
					: typeof responsibleIdent === "string"
						? responsibleIdent.trim().toUpperCase() || null
						: undefined,
				responsibleName: isRoleBased
					? null
					: typeof responsibleName === "string"
						? responsibleName.trim() || null
						: undefined,
				responsibleRole: isRoleBased
					? typeof responsibleRole === "string" && responsibleRole.trim()
						? responsibleRole.trim()
						: null
					: null,
				frequency: isRoutineFrequency(frequency) ? (frequency as RoutineFrequency) : undefined,
				updatedBy: authedUser.navIdent,
			})

			if (!updated) {
				return data<ActionResult>({
					success: false,
					error: "Regelsettet er arkivert eller finnes ikke.",
				})
			}
			return data<ActionResult>({ success: true, message: "Regelsett oppdatert." })
		}

		case "archive": {
			const archived = await archiveRuleset(regelSettId, authedUser.navIdent)
			if (!archived) {
				return data<ActionResult>({ success: false, error: "Fant ikke regelsettet." })
			}
			return redirect(`/seksjoner/${seksjon}/regelsett`)
		}

		case "unarchive": {
			const unarchived = await unarchiveRuleset(regelSettId, authedUser.navIdent)
			if (!unarchived) {
				return data<ActionResult>({ success: false, error: "Fant ikke regelsettet." })
			}
			return data<ActionResult>({ success: true, message: "Regelsettet ble reaktivert." })
		}

		case "link-control": {
			const controlId = formData.get("controlId")
			if (typeof controlId !== "string" || !controlId.trim()) {
				return data<ActionResult>({ success: false, error: "Velg et kontrollkrav." })
			}
			const linked = await linkControlToRuleset(regelSettId, controlId.trim())
			if (!linked) {
				return data<ActionResult>({
					success: false,
					error: "Regelsettet er arkivert eller finnes ikke.",
				})
			}
			return data<ActionResult>({ success: true, message: "Kontrollkrav koblet." })
		}

		case "unlink-control": {
			const linkId = formData.get("linkId")
			if (typeof linkId !== "string" || !linkId.trim()) {
				return data<ActionResult>({ success: false, error: "Mangler kobling-ID." })
			}
			const unlinked = await unlinkControlFromRuleset(regelSettId, linkId.trim())
			if (!unlinked) {
				return data<ActionResult>({
					success: false,
					error: "Regelsettet er arkivert eller finnes ikke.",
				})
			}
			return data<ActionResult>({ success: true, message: "Kontrollkrav fjernet." })
		}

		default:
			return data<ActionResult>({ success: false, error: "Ugyldig handling." })
	}
}

export default function RegelsettRediger() {
	const { section, ruleset, allControls, frequencies } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const initialType = ruleset.responsibleRole ? "role" : "person"
	const [responsibleType, setResponsibleType] = useState<"person" | "role">(initialType)

	const linkedControlIds = new Set(ruleset.controls.map((c) => c.id))
	const availableControls = allControls.filter((c) => !linkedControlIds.has(c.id))

	return (
		<VStack gap="space-6">
			<Heading size="large">
				Rediger: {ruleset.name} — {section.name}
			</Heading>

			{actionData && "success" in actionData && actionData.success && (
				<Alert variant="success">{actionData.message}</Alert>
			)}
			{actionData && "success" in actionData && !actionData.success && (
				<Alert variant="error">{actionData.error}</Alert>
			)}

			{ruleset.status === "archived" && (
				<Alert variant="info">Regelsettet er arkivert. Reaktiver det nederst på siden for å gjøre endringer.</Alert>
			)}

			{ruleset.status !== "archived" && (
				<Form method="post">
					<input type="hidden" name="intent" value="update" />
					<VStack gap="space-4">
						<TextField label="Navn" name="name" defaultValue={ruleset.name} />
						<MarkdownEditor label="Beskrivelse" name="description" defaultValue={ruleset.description ?? ""} />

						<RadioGroup
							legend="Ansvarlig"
							value={responsibleType}
							onChange={(val) => setResponsibleType(val as "person" | "role")}
							name="responsibleType"
						>
							<Radio value="person">Navngitt person</Radio>
							<Radio value="role">Rolle i seksjonen</Radio>
						</RadioGroup>

						{responsibleType === "person" ? (
							<HStack gap="space-4" wrap>
								<TextField
									label="NAV-ident"
									name="responsibleIdent"
									defaultValue={ruleset.responsibleIdent ?? ""}
									htmlSize={12}
								/>
								<TextField
									label="Navn"
									name="responsibleName"
									defaultValue={ruleset.responsibleName ?? ""}
									htmlSize={30}
								/>
							</HStack>
						) : (
							<Select label="Velg rolle" name="responsibleRole" defaultValue={ruleset.responsibleRole ?? ""}>
								<option value="">Velg rolle</option>
								{assignableRoles.map((role) => (
									<option key={role} value={role}>
										{userRoleLabels[role]}
									</option>
								))}
							</Select>
						)}

						<Select label="Frekvens" name="frequency" defaultValue={ruleset.frequency}>
							<option value="">Velg frekvens</option>
							{frequencies.map((f) => (
								<option key={f.value} value={f.value}>
									{f.label}
								</option>
							))}
						</Select>
						<div>
							<Button type="submit" variant="primary">
								Lagre endringer
							</Button>
						</div>
					</VStack>
				</Form>
			)}

			{ruleset.status !== "archived" && (
				<VStack gap="space-4">
					<Heading size="small" level="3">
						Tilknyttede kontrollkrav
					</Heading>
					{ruleset.controls.length > 0 && (
						/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
						<section className="table-scroll" tabIndex={0} aria-label="Tilknyttede kontrollkrav">
							<Table size="small">
								<Table.Header>
									<Table.Row>
										<Table.HeaderCell scope="col">Kontroll-ID</Table.HeaderCell>
										<Table.HeaderCell scope="col">Navn</Table.HeaderCell>
										<Table.HeaderCell scope="col" />
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{ruleset.controls.map((c) => (
										<Table.Row key={c.linkId}>
											<Table.DataCell>{c.controlId}</Table.DataCell>
											<Table.DataCell>{c.shortTitle ?? "–"}</Table.DataCell>
											<Table.DataCell>
												<Form method="post">
													<input type="hidden" name="intent" value="unlink-control" />
													<input type="hidden" name="linkId" value={c.linkId} />
													<Button type="submit" variant="tertiary-neutral" size="xsmall">
														Fjern
													</Button>
												</Form>
											</Table.DataCell>
										</Table.Row>
									))}
								</Table.Body>
							</Table>
						</section>
					)}
					<Form method="post">
						<input type="hidden" name="intent" value="link-control" />
						<HStack gap="space-4" align="end">
							<Select label="Legg til kontrollkrav" name="controlId">
								<option value="">Velg kontrollkrav</option>
								{availableControls.map((c) => (
									<option key={c.id} value={c.id}>
										{c.controlId} — {c.name}
									</option>
								))}
							</Select>
							<Button type="submit" variant="secondary" size="small">
								Legg til
							</Button>
						</HStack>
					</Form>
				</VStack>
			)}

			<VStack gap="space-4">
				<Heading size="small" level="3">
					Arkivering
				</Heading>
				{ruleset.status === "archived" ? (
					<>
						<BodyLong size="small">
							Regelsettet er arkivert og vises ikke i oversikten. Reaktiver for å gjøre det synlig igjen.
						</BodyLong>
						<Form method="post">
							<input type="hidden" name="intent" value="unarchive" />
							<Button type="submit" variant="secondary" size="small">
								Reaktiver regelsett
							</Button>
						</Form>
					</>
				) : (
					<>
						<BodyLong size="small">Arkivering skjuler regelsettet fra oversikten.</BodyLong>
						<Form method="post">
							<input type="hidden" name="intent" value="archive" />
							<Button type="submit" variant="danger" size="small">
								Arkiver regelsett
							</Button>
						</Form>
					</>
				)}
			</VStack>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
