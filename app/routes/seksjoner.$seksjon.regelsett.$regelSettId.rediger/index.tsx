import { Alert, BodyLong, Button, Heading, HStack, Select, Table, Textarea, TextField, VStack } from "@navikt/ds-react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, redirect, useActionData, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAllControlsForSelection } from "~/db/queries/framework.server"
import {
	archiveRuleset,
	createRuleset,
	getRulesetDetail,
	linkControlToRuleset,
	unlinkControlFromRuleset,
	updateRuleset,
} from "~/db/queries/rulesets.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"
import {
	frequencyLabels,
	isRoutineFrequency,
	ROUTINE_FREQUENCIES,
	type RoutineFrequency,
} from "~/lib/routine-frequencies"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const { seksjon, regelSettId } = params
	if (!seksjon) throw data({ message: "Mangler seksjonsparameter" }, { status: 400 })

	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const section = await getSectionBySlug(seksjon)
	if (!section) throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })

	const isNew = regelSettId === "ny"
	const ruleset = isNew || !regelSettId ? null : await getRulesetDetail(regelSettId)
	if (!isNew && (!ruleset || ruleset.sectionId !== section.id)) {
		throw data({ message: "Fant ikke regelsettet" }, { status: 404 })
	}

	const allControls = await getAllControlsForSelection()

	return data({
		section,
		ruleset,
		isNew,
		allControls,
		frequencies: ROUTINE_FREQUENCIES.map((f) => ({ value: f, label: frequencyLabels[f] })),
	})
}

type ActionResult = { success: true; message: string } | { success: false; error: string }

export async function action({ request, params }: ActionFunctionArgs) {
	const { seksjon, regelSettId } = params
	if (!seksjon) throw data({ message: "Mangler seksjonsparameter" }, { status: 400 })

	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const section = await getSectionBySlug(seksjon)
	if (!section) throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })

	const formData = await request.formData()
	const intent = formData.get("intent")

	switch (intent) {
		case "create": {
			const code = formData.get("code")
			const name = formData.get("name")
			const description = formData.get("description")
			const responsibleIdent = formData.get("responsibleIdent")
			const responsibleName = formData.get("responsibleName")
			const frequency = formData.get("frequency")

			if (typeof code !== "string" || !code.trim()) {
				return data<ActionResult>({ success: false, error: "Kode er påkrevd." })
			}
			if (typeof name !== "string" || !name.trim()) {
				return data<ActionResult>({ success: false, error: "Navn er påkrevd." })
			}
			if (!isRoutineFrequency(frequency)) {
				return data<ActionResult>({ success: false, error: "Ugyldig frekvens." })
			}

			const id = await createRuleset({
				sectionId: section.id,
				code: code.trim(),
				name: name.trim(),
				description: typeof description === "string" && description.trim() ? description.trim() : undefined,
				responsibleIdent:
					typeof responsibleIdent === "string" && responsibleIdent.trim()
						? responsibleIdent.trim().toUpperCase()
						: undefined,
				responsibleName:
					typeof responsibleName === "string" && responsibleName.trim() ? responsibleName.trim() : undefined,
				frequency: frequency as RoutineFrequency,
				createdBy: authedUser.navIdent,
			})

			return redirect(`/seksjoner/${seksjon}/regelsett/${id}`)
		}

		case "update": {
			if (!regelSettId || regelSettId === "ny") {
				return data<ActionResult>({ success: false, error: "Mangler regelsett-ID." })
			}

			const name = formData.get("name")
			const description = formData.get("description")
			const responsibleIdent = formData.get("responsibleIdent")
			const responsibleName = formData.get("responsibleName")
			const frequency = formData.get("frequency")

			if (typeof name !== "string" || !name.trim()) {
				return data<ActionResult>({ success: false, error: "Navn er påkrevd." })
			}

			await updateRuleset(regelSettId, {
				name: name.trim(),
				description: typeof description === "string" ? description.trim() || null : undefined,
				responsibleIdent:
					typeof responsibleIdent === "string" ? responsibleIdent.trim().toUpperCase() || null : undefined,
				responsibleName: typeof responsibleName === "string" ? responsibleName.trim() || null : undefined,
				frequency: isRoutineFrequency(frequency) ? (frequency as RoutineFrequency) : undefined,
				updatedBy: authedUser.navIdent,
			})

			return data<ActionResult>({ success: true, message: "Regelsett oppdatert." })
		}

		case "archive": {
			if (!regelSettId || regelSettId === "ny") {
				return data<ActionResult>({ success: false, error: "Mangler regelsett-ID." })
			}
			await archiveRuleset(regelSettId, authedUser.navIdent)
			return redirect(`/seksjoner/${seksjon}/regelsett`)
		}

		case "link-control": {
			if (!regelSettId || regelSettId === "ny") {
				return data<ActionResult>({ success: false, error: "Mangler regelsett-ID." })
			}
			const controlId = formData.get("controlId")
			if (typeof controlId !== "string" || !controlId.trim()) {
				return data<ActionResult>({ success: false, error: "Velg et kontrollkrav." })
			}
			await linkControlToRuleset(regelSettId, controlId)
			return data<ActionResult>({ success: true, message: "Kontrollkrav koblet." })
		}

		case "unlink-control": {
			const linkId = formData.get("linkId")
			if (typeof linkId !== "string") {
				return data<ActionResult>({ success: false, error: "Mangler kobling-ID." })
			}
			await unlinkControlFromRuleset(linkId)
			return data<ActionResult>({ success: true, message: "Kontrollkrav fjernet." })
		}

		default:
			return data<ActionResult>({ success: false, error: "Ugyldig handling." })
	}
}

export default function RegelsettRediger() {
	const { section, ruleset, isNew, allControls, frequencies } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()

	const linkedControlIds = new Set(ruleset?.controls.map((c) => c.id) ?? [])
	const availableControls = allControls.filter((c) => !linkedControlIds.has(c.id))

	return (
		<VStack gap="space-6">
			<VStack gap="space-2">
				<Heading size="large">
					{isNew ? "Opprett regelsett" : `Rediger: ${ruleset?.code}`} — {section.name}
				</Heading>
				{!isNew && <Link to={`/seksjoner/${section.slug}/regelsett/${ruleset?.id}`}>← Tilbake til regelsett</Link>}
			</VStack>

			{actionData && "success" in actionData && actionData.success && (
				<Alert variant="success">{actionData.message}</Alert>
			)}
			{actionData && "success" in actionData && !actionData.success && (
				<Alert variant="error">{actionData.error}</Alert>
			)}

			<Form method="post">
				<input type="hidden" name="intent" value={isNew ? "create" : "update"} />
				<VStack gap="space-4">
					{isNew && <TextField label="Kode" name="code" required placeholder="f.eks. RS-PEN.01" />}
					<TextField label="Navn" name="name" required defaultValue={ruleset?.name ?? ""} />
					<Textarea label="Beskrivelse" name="description" defaultValue={ruleset?.description ?? ""} />
					<HStack gap="space-4" wrap>
						<TextField
							label="Ansvarlig (NAV-ident)"
							name="responsibleIdent"
							defaultValue={ruleset?.responsibleIdent ?? ""}
							htmlSize={12}
						/>
						<TextField
							label="Ansvarlig (navn)"
							name="responsibleName"
							defaultValue={ruleset?.responsibleName ?? ""}
							htmlSize={30}
						/>
					</HStack>
					<Select label="Frekvens" name="frequency" required defaultValue={ruleset?.frequency ?? ""}>
						<option value="">Velg frekvens</option>
						{frequencies.map((f) => (
							<option key={f.value} value={f.value}>
								{f.label}
							</option>
						))}
					</Select>
					<div>
						<Button type="submit" variant="primary">
							{isNew ? "Opprett" : "Lagre endringer"}
						</Button>
					</div>
				</VStack>
			</Form>

			{!isNew && ruleset && (
				<>
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

					<VStack gap="space-4">
						<Heading size="small" level="3">
							Arkivering
						</Heading>
						<BodyLong size="small">Arkivering skjuler regelsettet fra oversikten.</BodyLong>
						<Form method="post">
							<input type="hidden" name="intent" value="archive" />
							<Button type="submit" variant="danger" size="small">
								Arkiver regelsett
							</Button>
						</Form>
					</VStack>
				</>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
