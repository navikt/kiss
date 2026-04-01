import { PencilIcon } from "@navikt/aksel-icons"
import { Button, Detail, Heading, HStack, Label, Tag, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getControlDependencies, getControlDependents, getControlDetail } from "~/db/queries/framework.server"
import { getAuthenticatedUser } from "~/lib/auth.server"
import { isAdmin } from "~/lib/authorization.server"
import { renderMarkdown } from "~/lib/markdown.server"

const fieldConfig = [
	{ key: "technologyElement", label: "Teknologielement" },
	{ key: "requirement", label: "Krav" },
	{ key: "responsible", label: "Ansvarlig" },
	{ key: "routine", label: "Rutine" },
	{ key: "frequency", label: "Frekvens" },
	{ key: "documentationRequirement", label: "Dokumentasjonskrav" },
	{ key: "testProcedure", label: "Testprosedyre" },
	{ key: "dependencies", label: "Avhengigheter" },
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
	const [controlElements, controlDomains, dependencies, dependents] = await Promise.all([
		getControlElements(control.uuid),
		getControlDomains(control.uuid),
		getControlDependencies(control.uuid),
		getControlDependents(control.uuid),
	])

	const fieldHtml: Record<string, string> = {}
	const rawFields: Record<string, string> = {
		technologyElement: control.teknologielement,
		requirement: control.krav,
		responsible: control.ansvarlig,
		routine: control.rutine,
		frequency: control.frekvens,
		documentationRequirement: control.dokumentasjonskrav,
		testProcedure: control.testprosedyre,
		dependencies: control.avhengigheter,
		references: control.referanser,
		commonPitfalls: control.vanligeFallgruver,
	}
	for (const [key, val] of Object.entries(rawFields)) {
		fieldHtml[key] = renderMarkdown(val)
	}

	return data({ domene, control, canEdit, fieldHtml, controlElements, controlDomains, dependencies, dependents })
}

export default function ControlDetailPage() {
	const { domene, control, canEdit, fieldHtml, controlElements, controlDomains, dependencies, dependents } =
		useLoaderData<typeof loader>()

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
											{dep.controlId}: {dep.shortTitle ?? dep.controlId}
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
											{dep.controlId}: {dep.shortTitle ?? dep.controlId}
										</Tag>
									</Link>
								))}
							</HStack>
						</VStack>
					)}
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
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
