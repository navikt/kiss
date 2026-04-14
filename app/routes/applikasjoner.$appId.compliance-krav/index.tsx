import {
	Link as AkselLink,
	Alert,
	BodyShort,
	Button,
	Heading,
	HStack,
	Label,
	Select,
	Tag,
	Textarea,
	VStack,
} from "@navikt/ds-react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, useActionData, useLoaderData, useSearchParams } from "react-router"
import { ComplianceComment, ComplianceStatusBadge } from "~/components/ComplianceStatus"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAppAssessments, saveAssessment, saveAssessmentComment } from "~/db/queries/applications.server"
import { getAllRisks } from "~/db/queries/framework.server"
import { useAppBasePath } from "~/hooks/useAppBasePath"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { isComplianceStatus, statusLabels } from "~/lib/compliance-status"
import { renderMarkdown } from "~/lib/markdown.server"

function slugify(text: string) {
	return text
		.toLowerCase()
		.replace(/[æ]/g, "ae")
		.replace(/[ø]/g, "oe")
		.replace(/[å]/g, "aa")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "")
}

function uniqueSorted(values: (string | null)[]) {
	const unique = new Set(values.filter(Boolean) as string[])
	return [...unique].sort((a, b) => a.localeCompare(b, "nb"))
}

export async function loader({ params, request }: LoaderFunctionArgs) {
	const appId = params.appId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })

	const url = new URL(request.url)
	const ansvarlig = url.searchParams.get("ansvarlig") ?? ""
	const teknologielement = url.searchParams.get("teknologielement") ?? ""
	const frekvens = url.searchParams.get("frekvens") ?? ""
	const status = url.searchParams.get("status") ?? ""
	const domene = url.searchParams.get("domene") ?? ""

	// Breadcrumb context for team-context routes
	const breadcrumbCtx =
		params.seksjon && params.team
			? await (async () => {
					const { getTeamBreadcrumbContext } = await import("~/lib/breadcrumb-context.server")
					return getTeamBreadcrumbContext(params.seksjon!, params.team!)
				})()
			: {}

	const [result, allRisks] = await Promise.all([getAppAssessments(appId), getAllRisks()])
	if (!result) throw new Response("Applikasjon ikke funnet", { status: 404 })

	const responsibleOptions = uniqueSorted(result.assessments.map((a) => a.responsible))
	const technologyOptions = uniqueSorted(result.assessments.map((a) => a.technologyElementName))
	const frequencyOptions = uniqueSorted(result.assessments.map((a) => a.frequency))
	const domainOptions = uniqueSorted(result.assessments.map((a) => a.domainName))
	const statusOptions = Object.entries(statusLabels).map(([value, label]) => ({ value, label }))

	let filtered = result.assessments
	if (ansvarlig) filtered = filtered.filter((a) => a.responsible === ansvarlig)
	if (teknologielement) filtered = filtered.filter((a) => a.technologyElementName === teknologielement)
	if (frekvens) filtered = filtered.filter((a) => a.frequency === frekvens)
	if (status === "__not_assessed") filtered = filtered.filter((a) => a.status === null)
	else if (status) filtered = filtered.filter((a) => a.status === status)
	if (domene) filtered = filtered.filter((a) => a.domainName === domene)

	return data({
		...breadcrumbCtx,
		appId,
		appName: result.app.name,
		assessments: filtered.map((a) => ({
			...a,
			requirementHtml: renderMarkdown(a.requirement),
		})),
		totalAssessments: result.assessments.length,
		isInherited: result.isInherited,
		primaryName: result.primaryName,
		primaryId: result.app.primaryApplicationId,
		allRisks: allRisks.map((r) => ({
			...r,
			descriptionHtml: renderMarkdown(r.description),
		})),
		filters: { ansvarlig, teknologielement, frekvens, status, domene },
		options: { responsibleOptions, technologyOptions, frequencyOptions, domainOptions, statusOptions },
	})
}

export async function action({ request, params }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	const appId = params.appId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })

	const formData = await request.formData()
	const intent = formData.get("intent") as string

	if (intent === "saveComment") {
		const controlUuid = formData.get("controlUuid") as string
		const controlId = formData.get("controlId") as string
		const comment = formData.get("comment") as string
		const techElementId = (formData.get("technologyElementId") as string) || null
		if (!controlUuid) throw new Response("Mangler kontroll-UUID", { status: 400 })

		await saveAssessmentComment(appId, controlUuid, comment ?? "", authedUser.navIdent, techElementId)

		return data({
			success: true,
			controlId: typeof controlId === "string" ? controlId : controlUuid,
		})
	}

	const controlUuid = formData.get("controlUuid")
	const controlId = formData.get("controlId")
	const status = formData.get("status")
	const comment = formData.get("comment")
	const techElementId = formData.get("technologyElementId")

	if (typeof controlUuid !== "string" || !controlUuid) {
		throw new Response("Mangler kontroll-UUID", { status: 400 })
	}

	if (typeof status !== "string" || !isComplianceStatus(status)) {
		throw new Response("Ugyldig status", { status: 400 })
	}

	const elementId = typeof techElementId === "string" && techElementId ? techElementId : null
	await saveAssessment(
		appId,
		controlUuid,
		status,
		typeof comment === "string" ? comment : "",
		authedUser.navIdent,
		elementId,
	)

	return data({
		success: true,
		controlId: typeof controlId === "string" ? controlId : controlUuid,
	})
}

export default function ComplianceKrav() {
	const {
		appId,
		appName,
		assessments,
		totalAssessments,
		isInherited,
		primaryName,
		primaryId,
		allRisks,
		filters,
		options,
	} = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const [, setSearchParams] = useSearchParams()
	const _appBase = useAppBasePath()

	const hasActiveFilters = !!(
		filters.ansvarlig ||
		filters.teknologielement ||
		filters.frekvens ||
		filters.status ||
		filters.domene
	)

	function setFilter(key: string, value: string) {
		setSearchParams(
			(prev) => {
				if (value) {
					prev.set(key, value)
				} else {
					prev.delete(key)
				}
				return prev
			},
			{ replace: true },
		)
	}

	const controlByUuid = new Map<string, (typeof assessments)[number]>()
	for (const a of assessments) {
		controlByUuid.set(a.controlUuid, a)
	}

	const controlsByRisk = new Map<string, (typeof assessments)[number][]>()
	for (const a of assessments) {
		for (const r of a.risks) {
			const list = controlsByRisk.get(r.riskId) ?? []
			list.push(a)
			controlsByRisk.set(r.riskId, list)
		}
	}

	const domainMap = new Map<string, { name: string; risks: typeof allRisks }>()
	for (const r of allRisks) {
		if (!domainMap.has(r.domainName)) {
			domainMap.set(r.domainName, { name: r.domainName, risks: [] })
		}
		domainMap.get(r.domainName)?.risks.push(r)
	}
	const domains = [...domainMap.values()]

	return (
		<section className="compliance-layout" aria-label="Kravgjennomgang">
			{/* Sidebar navigation */}
			<nav className="compliance-sidebar" aria-label="Innholdsnavigasjon">
				<AkselLink href="#top" className="compliance-sidebar-home">
					Hjem
				</AkselLink>

				<div className="compliance-sidebar-group">
					<AkselLink href={`/applikasjoner/${appId}/compliance`} className="compliance-sidebar-domain">
						← Spørsmål
					</AkselLink>
				</div>

				{domains.map((domain) => (
					<div key={domain.name} className="compliance-sidebar-group">
						<AkselLink href={`#domain-${slugify(domain.name)}`} className="compliance-sidebar-domain">
							{domain.name}
						</AkselLink>
						{domain.risks.map((risk) => (
							<AkselLink key={risk.riskId} href={`#risk-${risk.riskId}`} className="compliance-sidebar-risk">
								<span className="compliance-sidebar-risk-id">{risk.riskId}</span>
								<span>{risk.name}</span>
							</AkselLink>
						))}
					</div>
				))}
			</nav>

			{/* Main content */}
			<div className="compliance-content" id="top">
				<VStack gap="space-8">
					<Heading size="xlarge" level="2">
						Kravgjennomgang: {appName}
					</Heading>

					{isInherited && primaryId && (
						<Alert variant="info" size="small">
							Compliance-vurderingene for denne applikasjonen arves fra primærapplikasjonen{" "}
							<Link to={`/applikasjoner/${primaryId}/compliance-krav`}>{primaryName}</Link>. Endringer må gjøres på
							primærapplikasjonen.
						</Alert>
					)}

					{actionData?.success && (
						<div className="compliance-success" role="status" aria-live="polite">
							Vurdering for {actionData.controlId} er lagret.
						</div>
					)}

					{/* Summary table */}
					<BackToQuestionsLink />

					<HStack gap="space-6" wrap>
						{options.domainOptions.length > 0 && (
							<Select
								label="Domene"
								size="small"
								value={filters.domene}
								onChange={(e) => setFilter("domene", e.target.value)}
								style={{ minWidth: "12rem" }}
							>
								<option value="">Alle domener</option>
								{options.domainOptions.map((d) => (
									<option key={d} value={d}>
										{d}
									</option>
								))}
							</Select>
						)}
						{options.responsibleOptions.length > 0 && (
							<Select
								label="Ansvarlig"
								size="small"
								value={filters.ansvarlig}
								onChange={(e) => setFilter("ansvarlig", e.target.value)}
								style={{ minWidth: "12rem" }}
							>
								<option value="">Alle ansvarlige</option>
								{options.responsibleOptions.map((r) => (
									<option key={r} value={r}>
										{r}
									</option>
								))}
							</Select>
						)}
						{options.technologyOptions.length > 0 && (
							<Select
								label="Teknologielement"
								size="small"
								value={filters.teknologielement}
								onChange={(e) => setFilter("teknologielement", e.target.value)}
								style={{ minWidth: "12rem" }}
							>
								<option value="">Alle teknologier</option>
								{options.technologyOptions.map((t) => (
									<option key={t} value={t}>
										{t}
									</option>
								))}
							</Select>
						)}
						{options.frequencyOptions.length > 0 && (
							<Select
								label="Frekvens"
								size="small"
								value={filters.frekvens}
								onChange={(e) => setFilter("frekvens", e.target.value)}
								style={{ minWidth: "12rem" }}
							>
								<option value="">Alle frekvenser</option>
								{options.frequencyOptions.map((f) => (
									<option key={f} value={f}>
										{f}
									</option>
								))}
							</Select>
						)}
						<Select
							label="Status"
							size="small"
							value={filters.status}
							onChange={(e) => setFilter("status", e.target.value)}
							style={{ minWidth: "12rem" }}
						>
							<option value="">Alle statuser</option>
							<option value="__not_assessed">Ikke vurdert</option>
							{options.statusOptions.map((s) => (
								<option key={s.value} value={s.value}>
									{s.label}
								</option>
							))}
						</Select>
					</HStack>

					{hasActiveFilters && (
						<HStack gap="space-4" align="center">
							<BodyShort size="small" textColor="subtle">
								Viser {assessments.length} av {totalAssessments} kontrollpunkter
							</BodyShort>
							<Button
								size="xsmall"
								variant="tertiary"
								onClick={() =>
									setSearchParams(
										(prev) => {
											prev.delete("ansvarlig")
											prev.delete("teknologielement")
											prev.delete("frekvens")
											prev.delete("status")
											prev.delete("domene")
											return prev
										},
										{ replace: true },
									)
								}
							>
								Nullstill filtre
							</Button>
						</HStack>
					)}

					{domains.map((domain) => (
						<VStack
							key={domain.name}
							gap="space-12"
							id={`domain-${slugify(domain.name)}`}
							className="compliance-domain-section"
						>
							<Heading size="large" level="3">
								{domain.name}
							</Heading>

							{domain.risks.map((risk) => {
								const riskControls = controlsByRisk.get(risk.riskId) ?? []
								return (
									<VStack
										key={risk.riskId}
										gap="space-8"
										id={`risk-${risk.riskId}`}
										className="compliance-risk-section"
									>
										<div className="compliance-risk-header">
											<Heading size="medium" level="4">
												{risk.riskId}: {risk.name}
											</Heading>
											{/* biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized server-side */}
											<div className="markdown-content" dangerouslySetInnerHTML={{ __html: risk.descriptionHtml }} />
										</div>

										{riskControls.length > 0 && (
											<VStack gap="space-6">
												{riskControls.map((assessment) => (
													<AssessmentCard key={assessment.controlUuid} assessment={assessment} />
												))}
											</VStack>
										)}
									</VStack>
								)
							})}
						</VStack>
					))}
				</VStack>
			</div>
		</section>
	)
}

function BackToQuestionsLink() {
	const appBase = useAppBasePath()
	return (
		<HStack gap="space-4">
			<Link to={`${appBase}/compliance`} className="compliance-nav-link">
				← Tilbake til spørsmål
			</Link>
		</HStack>
	)
}

function AssessmentCard({
	assessment,
}: {
	assessment: ReturnType<typeof useLoaderData<typeof loader>>["assessments"][number]
}) {
	return (
		<div
			className="compliance-card"
			id={`control-${assessment.controlId}${assessment.technologyElementId ? `-${assessment.technologyElementId}` : ""}`}
		>
			<div className="compliance-card-header">
				<HStack gap="space-4" align="center">
					<Heading size="small" level="5">
						<Link
							to={`/kontrollrammeverk/${assessment.domainCode}/${assessment.controlId}`}
							className="compliance-control-link"
						>
							{assessment.controlId}
						</Link>
						: {assessment.controlName}
					</Heading>
					{assessment.technologyElementName && (
						<Tag variant="info" size="xsmall">
							{assessment.technologyElementName}
						</Tag>
					)}
				</HStack>
			</div>

			{assessment.requirementHtml && (
				<VStack gap="space-2">
					<Label size="small">Krav</Label>
					{/* biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized server-side */}
					<div className="markdown-content" dangerouslySetInnerHTML={{ __html: assessment.requirementHtml }} />
				</VStack>
			)}

			{assessment.status && (
				<div className="compliance-current">
					<ComplianceStatusBadge status={assessment.status} />
					{assessment.assessedBy && (
						<span className="compliance-meta">
							Vurdert av {assessment.assessedBy}{" "}
							{assessment.assessedAt && new Date(assessment.assessedAt).toLocaleDateString("nb-NO")}
						</span>
					)}
				</div>
			)}

			{assessment.comment && <ComplianceComment comment={assessment.comment} />}

			{assessment.predefinedAnswers.length > 0 && (
				<VStack gap="space-4" paddingBlock="space-8 space-0">
					<Label size="small">Hurtigvalg</Label>
					<HStack gap="space-4" wrap>
						{assessment.predefinedAnswers.map((pa) => (
							<Form method="post" key={pa.id}>
								<input type="hidden" name="controlUuid" value={assessment.controlUuid} />
								<input type="hidden" name="controlId" value={assessment.controlId} />
								<input type="hidden" name="technologyElementId" value={assessment.technologyElementId ?? ""} />
								<input type="hidden" name="status" value={pa.status} />
								<input type="hidden" name="comment" value={pa.comment ?? ""} />
								<Button type="submit" size="small" variant="secondary-neutral">
									{pa.label}
								</Button>
							</Form>
						))}
					</HStack>
				</VStack>
			)}

			<Form method="post" className="compliance-form">
				<input type="hidden" name="controlUuid" value={assessment.controlUuid} />
				<input type="hidden" name="controlId" value={assessment.controlId} />
				<input type="hidden" name="technologyElementId" value={assessment.technologyElementId ?? ""} />
				<Select label="Status" name="status" defaultValue={assessment.status ?? ""} size="small">
					<option value="" disabled>
						Velg status
					</option>
					{Object.entries(statusLabels).map(([value, label]) => (
						<option key={value} value={value}>
							{label}
						</option>
					))}
				</Select>
				<Textarea
					label="Kommentar"
					name="comment"
					defaultValue={assessment.comment ?? ""}
					size="small"
					description="Lenker i kommentaren vil vises som klikkbare lenker."
				/>
				<HStack gap="space-4">
					<Button type="submit" size="small" variant="primary">
						Lagre vurdering
					</Button>
					{assessment.status && (
						<Button type="submit" name="intent" value="saveComment" size="small" variant="secondary">
							Lagre kun kommentar
						</Button>
					)}
				</HStack>
			</Form>
		</div>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
