import { Alert, BodyLong, Button, Detail, Heading, HStack, Label, Select, Textarea, VStack } from "@navikt/ds-react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, useActionData, useLoaderData } from "react-router"
import type { ComplianceStatusValue } from "~/components/ComplianceStatus"
import { ComplianceComment, ComplianceStatusBadge, statusLabels } from "~/components/ComplianceStatus"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAppAssessments, saveAssessment } from "~/db/queries/applications.server"
import { getAllRisks } from "~/db/queries/framework.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"

export async function loader({ params }: LoaderFunctionArgs) {
	const appId = params.appId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })

	const [result, allRisks] = await Promise.all([getAppAssessments(appId), getAllRisks()])
	if (!result) throw new Response("Applikasjon ikke funnet", { status: 404 })

	return data({
		appId,
		appName: result.app.name,
		assessments: result.assessments,
		isInherited: result.isInherited,
		primaryName: result.primaryName,
		primaryId: result.app.primaryApplicationId,
		allRisks,
	})
}

const validStatuses: ComplianceStatusValue[] = [
	"not_relevant",
	"not_implemented",
	"partially_implemented",
	"implemented",
]

export async function action({ request, params }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	const appId = params.appId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })

	const formData = await request.formData()
	const controlUuid = formData.get("controlUuid")
	const controlId = formData.get("controlId")
	const status = formData.get("status")
	const comment = formData.get("comment")

	if (typeof controlUuid !== "string" || !controlUuid) {
		throw new Response("Mangler kontroll-UUID", { status: 400 })
	}

	if (typeof status !== "string" || !validStatuses.includes(status as ComplianceStatusValue)) {
		throw new Response("Ugyldig status", { status: 400 })
	}

	await saveAssessment(appId, controlUuid, status, typeof comment === "string" ? comment : "", authedUser.navIdent)

	return data({
		success: true,
		controlId: typeof controlId === "string" ? controlId : controlUuid,
	})
}

export default function ComplianceAssessment() {
	const { appName, assessments, isInherited, primaryName, primaryId, allRisks } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()

	// Group assessments by domain
	const domainMap = new Map<string, { code: string; name: string; assessments: typeof assessments }>()
	for (const a of assessments) {
		const key = a.domainCode
		if (!domainMap.has(key)) {
			domainMap.set(key, { code: a.domainCode, name: a.domainName, assessments: [] })
		}
		domainMap.get(key)!.assessments.push(a)
	}
	const domains = [...domainMap.values()]

	// Group risks by domain
	const risksByDomain = new Map<string, typeof allRisks>()
	for (const r of allRisks) {
		const list = risksByDomain.get(r.domainCode) ?? []
		list.push(r)
		risksByDomain.set(r.domainCode, list)
	}

	return (
		<div className="compliance-layout">
			{/* Sidebar navigation */}
			<nav className="compliance-sidebar" aria-label="Innholdsnavigasjon">
				<a href="#top" className="compliance-sidebar-home">
					Hjem
				</a>

				<div className="compliance-sidebar-group">
					<Detail uppercase weight="semibold" className="compliance-sidebar-label">
						Risikoer
					</Detail>
					{allRisks.map((risk) => (
						<a key={risk.riskId} href={`#risk-${risk.riskId}`} className="compliance-sidebar-risk">
							<span className="compliance-sidebar-risk-id">{risk.riskId}</span>
							<span>{risk.name}</span>
						</a>
					))}
				</div>

				<div className="compliance-sidebar-group">
					<Detail uppercase weight="semibold" className="compliance-sidebar-label">
						Kontroller
					</Detail>
					{domains.map((domain) => (
						<a key={domain.code} href={`#domain-${domain.code}`} className="compliance-sidebar-domain">
							{domain.name} ({domain.code})
						</a>
					))}
				</div>
			</nav>

			{/* Main content */}
			<div className="compliance-content" id="top">
				<VStack gap="space-8">
					<Heading size="xlarge" level="2">
						Compliance-vurdering: {appName}
					</Heading>

					{isInherited && primaryId && (
						<Alert variant="info" size="small">
							Compliance-vurderingene for denne applikasjonen arves fra primærapplikasjonen{" "}
							<Link to={`/applikasjoner/${primaryId}/compliance`}>{primaryName}</Link>. Endringer må gjøres på
							primærapplikasjonen.
						</Alert>
					)}

					{actionData?.success && (
						<div className="compliance-success" role="status">
							Vurdering for {actionData.controlId} er lagret.
						</div>
					)}

					{domains.map((domain) => {
						const domainRisks = risksByDomain.get(domain.code) ?? []
						return (
							<VStack key={domain.code} gap="space-8" id={`domain-${domain.code}`}>
								<Heading size="large" level="3">
									{domain.name} ({domain.code})
								</Heading>

								{domainRisks.length > 0 && (
									<VStack gap="space-4">
										<Label size="small">Risikoer i dette domenet</Label>
										{domainRisks.map((risk) => (
											<div key={risk.riskId} id={`risk-${risk.riskId}`} className="compliance-risk-block">
												<HStack gap="space-4" align="start">
													<Detail weight="semibold" style={{ color: "var(--ax-text-accent)", whiteSpace: "nowrap" }}>
														{risk.riskId}
													</Detail>
													<BodyLong size="small">{risk.description}</BodyLong>
												</HStack>
											</div>
										))}
									</VStack>
								)}

								{domain.assessments.map((assessment) => (
									<div key={assessment.controlUuid} className="compliance-card" id={`control-${assessment.controlId}`}>
										<div className="compliance-card-header">
											<Heading size="small" level="4">
												{assessment.controlId}: {assessment.controlName}
											</Heading>
										</div>

										{assessment.requirement && (
											<VStack gap="space-2">
												<Label size="small">Krav</Label>
												<BodyLong size="small" style={{ whiteSpace: "pre-wrap" }}>
													{assessment.requirement}
												</BodyLong>
											</VStack>
										)}

										{assessment.risks.length > 0 && (
											<VStack gap="space-2">
												<Label size="small">Tilknyttede risikoer</Label>
												{assessment.risks.map((risk) => (
													<Detail key={risk.riskId}>
														<strong>{risk.riskId}</strong>: {risk.name}
													</Detail>
												))}
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
											<VStack gap="space-4" style={{ paddingTop: "var(--ax-space-8)" }}>
												<Label size="small">Hurtigvalg</Label>
												<HStack gap="space-4" wrap>
													{assessment.predefinedAnswers.map((pa) => (
														<Form method="post" key={pa.id}>
															<input type="hidden" name="controlUuid" value={assessment.controlUuid} />
															<input type="hidden" name="controlId" value={assessment.controlId} />
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
											<Button type="submit" size="small" variant="primary">
												Lagre vurdering
											</Button>
										</Form>
									</div>
								))}
							</VStack>
						)
					})}
				</VStack>
			</div>
		</div>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
