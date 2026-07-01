import { PencilIcon } from "@navikt/aksel-icons"
import { Button, Detail, Heading, HStack, Label, Table, Tag, VStack } from "@navikt/ds-react"
import { data, Link, useLoaderData } from "react-router"
import { FrequencyDisplay } from "~/components/FrequencyDisplay"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import {
	getControlDependencies,
	getControlDependents,
	getControlDetail,
	getControlLinkedRisks,
} from "~/db/queries/framework.server"
import { type ApprovalStatus, getRulesetsForControl } from "~/db/queries/rulesets.server"
import { approvalStatusConfig } from "~/lib/approval-status"
import { getAuthenticatedUser } from "~/lib/auth.server"
import { isAdmin } from "~/lib/authorization.server"
import { cronFrequencyLabels } from "~/lib/frequency-mapping"
import { renderMarkdown } from "~/lib/markdown.server"
import type { Route } from "./+types/index"

const fieldConfig = [
	{ key: "requirement", label: "Krav" },
	{ key: "responsible", label: "Ansvarlig" },
	{ key: "routine", label: "Rutine" },
	{ key: "documentationRequirement", label: "Dokumentasjonskrav" },
	{ key: "testProcedure", label: "Testprosedyre" },
	{ key: "references", label: "Referanser" },
	{ key: "commonPitfalls", label: "Vanlige fallgruver" },
] as const

const routineStatusConfig: Record<string, { label: string; variant: "success" | "warning" | "neutral" | "info" }> = {
	draft: { label: "Kladd", variant: "neutral" },
	ready: { label: "Ferdig", variant: "info" },
	approved: { label: "Godkjent", variant: "success" },
	archived: { label: "Arkivert", variant: "warning" },
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const seksjon = params.seksjon
	const domene = params.domene?.toUpperCase()
	const kontrollId = params.kontrollId?.toUpperCase()

	if (!seksjon || !domene || !kontrollId) {
		throw new Response("Mangler parametere", { status: 400 })
	}

	const control = await getControlDetail(kontrollId)
	if (!control) {
		throw new Response("Kontroll ikke funnet", { status: 404 })
	}

	const user = await getAuthenticatedUser(request)
	const canEdit = user ? isAdmin(user) : false

	const { getControlElements } = await import("~/db/queries/technology-elements.server")
	const { getControlDomains } = await import("~/db/queries/framework.server")
	const { getSectionBySlug } = await import("~/db/queries/sections.server")
	const [controlElements, controlDomains, dependencies, dependents, linkedRulesets, linkedRisks, section] =
		await Promise.all([
			getControlElements(control.uuid),
			getControlDomains(control.uuid),
			getControlDependencies(control.uuid),
			getControlDependents(control.uuid),
			getRulesetsForControl(control.uuid),
			getControlLinkedRisks(control.uuid),
			getSectionBySlug(seksjon),
		])

	if (!section) {
		throw new Response("Seksjon ikke funnet", { status: 404 })
	}

	const fieldHtml: Record<string, string> = {}
	const rawFields: Record<string, string> = {
		requirement: control.krav,
		responsible: control.ansvarlig,
		routine: control.rutine,
		documentationRequirement: control.dokumentasjonskrav,
		testProcedure: control.testprosedyre,
		references: control.referanser,
		commonPitfalls: control.vanligeFallgruver,
	}
	for (const [key, val] of Object.entries(rawFields)) {
		fieldHtml[key] = renderMarkdown(val)
	}

	// Fetch routines linked to this control for this section
	const { db } = await import("~/db/connection.server")
	const { routines, routineControls } = await import("~/db/schema/routines")
	const { eq, and, inArray, isNull } = await import("drizzle-orm")

	const sectionRoutines = await db
		.select({
			id: routines.id,
			name: routines.name,
			status: routines.status,
			frequency: routines.frequency,
			eventFrequency: routines.eventFrequency,
			responsibleRole: routines.responsibleRole,
		})
		.from(routines)
		.innerJoin(routineControls, eq(routineControls.routineId, routines.id))
		.where(
			and(
				eq(routines.sectionId, section.id),
				eq(routineControls.controlId, control.uuid),
				isNull(routineControls.archivedAt),
				inArray(routines.status, ["draft", "ready", "approved"]),
				isNull(routines.archivedAt),
			),
		)

	return data({
		seksjon,
		sectionName: section.name,
		domene,
		control,
		canEdit,
		fieldHtml,
		controlElements,
		controlDomains,
		dependencies,
		dependents,
		linkedRulesets,
		linkedRisks,
		sectionRoutines,
	})
}

function RulesetSection({
	rulesets,
}: {
	rulesets: { id: string; name: string; sectionSlug: string; sectionName: string; approvalStatus: ApprovalStatus }[]
}) {
	return (
		<VStack gap="space-4">
			<Label size="small">Tilknyttede regelsett</Label>
			{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
			<section className="table-scroll" tabIndex={0} aria-label="Tilknyttede regelsett">
				<Table size="small">
					<Table.Header>
						<Table.Row>
							<Table.HeaderCell scope="col">Navn</Table.HeaderCell>
							<Table.HeaderCell scope="col">Seksjon</Table.HeaderCell>
							<Table.HeaderCell scope="col">Status</Table.HeaderCell>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{rulesets.map((rs) => {
							const cfg = approvalStatusConfig[rs.approvalStatus]
							return (
								<Table.Row key={rs.id}>
									<Table.DataCell>
										<Link to={`/seksjoner/${rs.sectionSlug}/regelsett/${rs.id}`}>{rs.name}</Link>
									</Table.DataCell>
									<Table.DataCell>{rs.sectionName}</Table.DataCell>
									<Table.DataCell>
										<Tag variant={cfg.variant} size="xsmall">
											{cfg.label}
										</Tag>
									</Table.DataCell>
								</Table.Row>
							)
						})}
					</Table.Body>
				</Table>
			</section>
		</VStack>
	)
}

export default function SectionControlDetailPage() {
	const {
		seksjon,
		sectionName,
		domene,
		control,
		canEdit,
		fieldHtml,
		controlElements,
		controlDomains,
		dependencies,
		dependents,
		linkedRulesets,
		linkedRisks,
		sectionRoutines,
	} = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-12">
			<VStack gap="space-2">
				<Detail>
					<Link to={`/seksjoner/${seksjon}`}>{sectionName}</Link> /{" "}
					{controlDomains.length > 0 ? controlDomains.map((d) => d.domainName).join(", ") : domene} / Kontroll
				</Detail>
				<HStack gap="space-4" align="center">
					<Heading size="xlarge" level="2">
						{control.id}: {control.name}
					</Heading>
					{canEdit && (
						<Button
							as={Link}
							to={`/kontrollrammeverk/${domene}/${control.id}/rediger`}
							variant="tertiary-neutral"
							size="small"
							icon={<PencilIcon aria-hidden />}
							aria-label="Rediger kontroll"
						/>
					)}
				</HStack>
				{controlElements.length > 0 && (
					<HStack gap="space-2" wrap>
						{controlElements.map((el) => (
							<Tag key={el.id} variant="info" size="small">
								{el.name}
							</Tag>
						))}
					</HStack>
				)}
			</VStack>

			{(dependencies.length > 0 || dependents.length > 0) && (
				<VStack gap="space-6">
					{dependencies.length > 0 && (
						<VStack gap="space-2">
							<Label size="small">Avhenger av</Label>
							<HStack gap="space-2" wrap>
								{dependencies.map((dep) => (
									<Link
										key={dep.id}
										to={`/seksjoner/${seksjon}/kontrollrammeverk/${domene}/${dep.controlId}`}
										style={{ textDecoration: "none" }}
									>
										<Tag variant="alt1" size="small">
											{dep.controlId}: {dep.name}
										</Tag>
									</Link>
								))}
							</HStack>
						</VStack>
					)}
					{dependents.length > 0 && (
						<VStack gap="space-2">
							<Label size="small">Brukes av</Label>
							<HStack gap="space-2" wrap>
								{dependents.map((dep) => (
									<Link
										key={dep.id}
										to={`/seksjoner/${seksjon}/kontrollrammeverk/${domene}/${dep.controlId}`}
										style={{ textDecoration: "none" }}
									>
										<Tag variant="neutral" size="small">
											{dep.controlId}: {dep.name}
										</Tag>
									</Link>
								))}
							</HStack>
						</VStack>
					)}
				</VStack>
			)}

			{linkedRisks.length > 0 && (
				<VStack gap="space-2">
					<Label size="small">Tilknyttede risikoer</Label>
					<HStack gap="space-2" wrap>
						{linkedRisks.map((risk) => (
							<Link key={risk.id} to={`/kontrollrammeverk/risiko/${risk.riskId}`} style={{ textDecoration: "none" }}>
								<Tag variant="warning" size="small">
									{risk.riskId}: {risk.name}
								</Tag>
							</Link>
						))}
					</HStack>
				</VStack>
			)}

			{(control.kronologiskFrekvens || (control.frekvens && control.frekvens !== "Ikke definert")) && (
				<VStack gap="space-2">
					<Label size="small">Frekvens</Label>
					<HStack gap="space-4" wrap align="center">
						{control.kronologiskFrekvens && (
							<Tag variant="info" size="small">
								{cronFrequencyLabels[control.kronologiskFrekvens] ?? control.kronologiskFrekvens}
							</Tag>
						)}
						{control.frekvens && control.frekvens !== "Ikke definert" && (
							<Tag variant="neutral" size="small">
								{control.frekvens}
							</Tag>
						)}
					</HStack>
				</VStack>
			)}

			<VStack gap="space-6">
				{fieldConfig.map((field) => (
					<VStack key={field.key} gap="space-2">
						<Label size="small">{field.label}</Label>
						{/* biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized server-side */}
						<div className="markdown-content" dangerouslySetInnerHTML={{ __html: fieldHtml[field.key] }} />
					</VStack>
				))}
			</VStack>

			{linkedRulesets.length > 0 && <RulesetSection rulesets={linkedRulesets} />}

			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Rutiner for denne kontrollen i {sectionName}
				</Heading>
				{sectionRoutines.length === 0 ? (
					<Tag variant="neutral" size="small">
						Ingen rutiner er knyttet til denne kontrollen
					</Tag>
				) : (
					/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
					<section className="table-scroll" tabIndex={0} aria-label="Rutiner for kontrollen">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Rutine</Table.HeaderCell>
									<Table.HeaderCell scope="col">Frekvens</Table.HeaderCell>
									<Table.HeaderCell scope="col">Ansvarlig rolle</Table.HeaderCell>
									<Table.HeaderCell scope="col">Status</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{sectionRoutines.map((r) => {
									const statusCfg = routineStatusConfig[r.status] ?? {
										label: r.status,
										variant: "neutral" as const,
									}
									return (
										<Table.Row key={r.id}>
											<Table.DataCell>
												<Link to={`/seksjoner/${seksjon}/rutiner/${r.id}`}>{r.name}</Link>
											</Table.DataCell>
											<Table.DataCell>
												<FrequencyDisplay frequency={r.frequency} eventFrequency={r.eventFrequency} />
											</Table.DataCell>
											<Table.DataCell>{r.responsibleRole ?? "—"}</Table.DataCell>
											<Table.DataCell>
												<Tag variant={statusCfg.variant} size="xsmall">
													{statusCfg.label}
												</Tag>
											</Table.DataCell>
										</Table.Row>
									)
								})}
							</Table.Body>
						</Table>
					</section>
				)}
			</VStack>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
