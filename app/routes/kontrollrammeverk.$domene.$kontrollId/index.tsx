import { PencilIcon } from "@navikt/aksel-icons"
import { Button, Detail, Heading, HStack, Label, Table, Tag, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getControlDependencies, getControlDependents, getControlDetail } from "~/db/queries/framework.server"
import { type ApprovalStatus, getRulesetsForControl } from "~/db/queries/rulesets.server"
import { getAuthenticatedUser } from "~/lib/auth.server"
import { isAdmin } from "~/lib/authorization.server"
import { cronFrequencyLabels } from "~/lib/frequency-mapping"
import { renderMarkdown } from "~/lib/markdown.server"

const fieldConfig = [
	{ key: "requirement", label: "Krav" },
	{ key: "responsible", label: "Ansvarlig" },
	{ key: "routine", label: "Rutine" },
	{ key: "documentationRequirement", label: "Dokumentasjonskrav" },
	{ key: "testProcedure", label: "Testprosedyre" },
	{ key: "references", label: "Referanser" },
	{ key: "commonPitfalls", label: "Vanlige fallgruver" },
] as const

export async function loader({ request, params }: LoaderFunctionArgs) {
	const domene = params.domene?.toUpperCase()
	const kontrollId = params.kontrollId?.toUpperCase()

	if (!domene || !kontrollId) {
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
	const [controlElements, controlDomains, dependencies, dependents, linkedRulesets] = await Promise.all([
		getControlElements(control.uuid),
		getControlDomains(control.uuid),
		getControlDependencies(control.uuid),
		getControlDependents(control.uuid),
		getRulesetsForControl(control.uuid),
	])

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

	return data({
		domene,
		control,
		canEdit,
		fieldHtml,
		controlElements,
		controlDomains,
		dependencies,
		dependents,
		linkedRulesets,
	})
}

const approvalStatusConfig: Record<
	ApprovalStatus,
	{ label: string; variant: "success" | "warning" | "error" | "neutral" }
> = {
	draft: { label: "Utkast", variant: "neutral" },
	valid: { label: "Gyldig", variant: "success" },
	expiring_soon: { label: "Utløper snart", variant: "warning" },
	expired: { label: "Utløpt", variant: "error" },
}

function RulesetSection({
	rulesets,
}: {
	rulesets: { id: string; name: string; sectionName: string; approvalStatus: ApprovalStatus }[]
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
									<Table.DataCell>{rs.name}</Table.DataCell>
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

export default function ControlDetailPage() {
	const {
		domene,
		control,
		canEdit,
		fieldHtml,
		controlElements,
		controlDomains,
		dependencies,
		dependents,
		linkedRulesets,
	} = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-12">
			<VStack gap="space-2">
				<Detail>
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
										to={`/kontrollrammeverk/${domene}/${dep.controlId}`}
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
										to={`/kontrollrammeverk/${domene}/${dep.controlId}`}
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
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
