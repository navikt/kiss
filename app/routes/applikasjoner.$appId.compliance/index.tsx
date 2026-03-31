import { Alert, BodyLong, Button, Heading, HStack, Label, Select, Textarea, VStack } from "@navikt/ds-react"
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

	// Build control lookup by controlUuid for quick access
	const controlByUuid = new Map<string, (typeof assessments)[number]>()
	for (const a of assessments) {
		controlByUuid.set(a.controlUuid, a)
	}

	// Build risk → controls mapping (from the assessment risks arrays)
	const controlsByRisk = new Map<string, (typeof assessments)[number][]>()
	for (const a of assessments) {
		for (const r of a.risks) {
			const list = controlsByRisk.get(r.riskId) ?? []
			list.push(a)
			controlsByRisk.set(r.riskId, list)
		}
	}

	// Group risks by domain
	const domainMap = new Map<string, { code: string; name: string; risks: typeof allRisks }>()
	for (const r of allRisks) {
		if (!domainMap.has(r.domainCode)) {
			domainMap.set(r.domainCode, { code: r.domainCode, name: r.domainName, risks: [] })
		}
		domainMap.get(r.domainCode)?.risks.push(r)
	}
	const domains = [...domainMap.values()]

	return (
		<div className="compliance-layout">
			{/* Sidebar navigation */}
			<nav className="compliance-sidebar" aria-label="Innholdsnavigasjon">
				<a href="#top" className="compliance-sidebar-home">
					Hjem
				</a>

				{domains.map((domain) => (
					<div key={domain.code} className="compliance-sidebar-group">
						<a href={`#domain-${domain.code}`} className="compliance-sidebar-domain">
							{domain.name}
						</a>
						{domain.risks.map((risk) => (
							<a key={risk.riskId} href={`#risk-${risk.riskId}`} className="compliance-sidebar-risk">
								<span className="compliance-sidebar-risk-id">{risk.riskId}</span>
								<span>{risk.name}</span>
							</a>
						))}
					</div>
				))}
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

					{domains.map((domain) => (
						<VStack key={domain.code} gap="space-12" id={`domain-${domain.code}`} className="compliance-domain-section">
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
											<BodyLong size="small">{risk.description}</BodyLong>
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
		</div>
	)
}

function AssessmentCard({
	assessment,
}: {
	assessment: ReturnType<typeof useLoaderData<typeof loader>>["assessments"][number]
}) {
	return (
		<div className="compliance-card" id={`control-${assessment.controlId}`}>
			<div className="compliance-card-header">
				<Heading size="small" level="5">
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
	)
}

export { RouteErrorBoundary as ErrorBoundary }
