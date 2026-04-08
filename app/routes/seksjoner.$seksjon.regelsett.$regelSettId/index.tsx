import { Alert, BodyLong, Button, Detail, Heading, HStack, Modal, Table, Tag, Textarea, VStack } from "@navikt/ds-react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, useActionData, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { type ApprovalStatus, approveRuleset, getRulesetDetail } from "~/db/queries/rulesets.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { isAdmin } from "~/lib/authorization.server"
import { getFrequencyLabel } from "~/lib/routine-frequencies"

const statusConfig: Record<ApprovalStatus, { label: string; variant: "success" | "warning" | "error" | "neutral" }> = {
	draft: { label: "Utkast", variant: "neutral" },
	valid: { label: "Gyldig", variant: "success" },
	expiring_soon: { label: "Utløper snart", variant: "warning" },
	expired: { label: "Utløpt", variant: "error" },
}

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
		(isAdmin(user) || (ruleset.responsibleIdent !== null && user.navIdent === ruleset.responsibleIdent))
	const userIsAdmin = user ? isAdmin(user) : false

	return data({ section, ruleset, canApprove, canAdmin: userIsAdmin })
}

type ActionResult = { success: true; message: string } | { success: false; error: string }

export async function action({ request, params }: ActionFunctionArgs) {
	const { regelSettId } = params
	if (!regelSettId) throw data({ message: "Mangler regelsett-ID" }, { status: 400 })

	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)

	const formData = await request.formData()
	const intent = formData.get("intent")

	switch (intent) {
		case "approve": {
			const ruleset = await getRulesetDetail(regelSettId)
			if (!ruleset) throw data({ message: "Fant ikke regelsettet" }, { status: 404 })

			const canApprove =
				isAdmin(authedUser) || (ruleset.responsibleIdent !== null && authedUser.navIdent === ruleset.responsibleIdent)
			if (!canApprove) throw new Response("Ikke autorisert", { status: 403 })

			const comment = formData.get("comment")
			await approveRuleset({
				rulesetId: regelSettId,
				approvedBy: authedUser.navIdent,
				approvedByName: authedUser.name,
				comment: typeof comment === "string" && comment.trim() ? comment.trim() : undefined,
				frequency: ruleset.frequency,
			})

			return data<ActionResult>({ success: true, message: "Regelsett godkjent." })
		}

		default:
			return data<ActionResult>({ success: false, error: "Ugyldig handling." })
	}
}

export default function RegelsettDetalj() {
	const { section, ruleset, canApprove, canAdmin } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const [approveOpen, setApproveOpen] = useState(false)

	const cfg = statusConfig[ruleset.approvalStatus]

	return (
		<VStack gap="space-6">
			<HStack justify="space-between" align="center">
				<VStack gap="space-2">
					<Detail>
						<Link to={`/seksjoner/${section.slug}/regelsett`}>← Regelsett</Link>
					</Detail>
					<Heading size="large">
						{ruleset.code} — {ruleset.name}
					</Heading>
				</VStack>
				<HStack gap="space-2">
					{canApprove && (
						<Button variant="primary" size="small" onClick={() => setApproveOpen(true)}>
							Godkjenn
						</Button>
					)}
					{canAdmin && (
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
						<BodyLong>{ruleset.responsibleName ?? "Ikke angitt"}</BodyLong>
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

				{ruleset.description && (
					<VStack gap="space-1">
						<Heading size="small" level="3">
							Beskrivelse
						</Heading>
						<BodyLong style={{ whiteSpace: "pre-wrap" }}>{ruleset.description}</BodyLong>
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
