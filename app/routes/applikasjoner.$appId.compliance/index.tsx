import {
	Alert,
	BodyLong,
	BodyShort,
	Button,
	Heading,
	HStack,
	Label,
	Radio,
	RadioGroup,
	Select,
	Tag,
	Textarea,
	VStack,
} from "@navikt/ds-react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, useActionData, useLoaderData } from "react-router"
import type { ComplianceStatusValue } from "~/components/ComplianceStatus"
import { ComplianceComment, ComplianceStatusBadge, statusLabels } from "~/components/ComplianceStatus"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAppAssessments, saveAssessment } from "~/db/queries/applications.server"
import { getAllRisks } from "~/db/queries/framework.server"
import { getScreeningDataForApp, saveScreeningAnswer } from "~/db/queries/screening.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"

export async function loader({ params }: LoaderFunctionArgs) {
	const appId = params.appId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })

	const [result, allRisks, screeningData] = await Promise.all([
		getAppAssessments(appId),
		getAllRisks(),
		getScreeningDataForApp(appId),
	])
	if (!result) throw new Response("Applikasjon ikke funnet", { status: 404 })

	return data({
		appId,
		appName: result.app.name,
		assessments: result.assessments,
		isInherited: result.isInherited,
		primaryName: result.primaryName,
		primaryId: result.app.primaryApplicationId,
		allRisks,
		screening: screeningData.questions,
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
	const intent = formData.get("intent") as string

	if (intent === "screening") {
		const questionId = formData.get("questionId") as string
		const answerValue = formData.get("answer") as string
		if (!questionId) throw new Response("Mangler spørsmål-ID", { status: 400 })

		const answer = answerValue === "yes" ? true : answerValue === "no" ? false : null
		await saveScreeningAnswer(appId, questionId, answer, authedUser.navIdent)

		return data({ success: true, controlId: "screening", screening: true })
	}

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
	const { appId, appName, assessments, isInherited, primaryName, primaryId, allRisks, screening } =
		useLoaderData<typeof loader>()
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

	// Group risks by domain name (merge domains with same name, e.g. TI and DR both named "Drift")
	const domainMap = new Map<string, { name: string; risks: typeof allRisks }>()
	for (const r of allRisks) {
		if (!domainMap.has(r.domainName)) {
			domainMap.set(r.domainName, { name: r.domainName, risks: [] })
		}
		domainMap.get(r.domainName)?.risks.push(r)
	}
	const domains = [...domainMap.values()]

	return (
		<div className="compliance-layout">
			{/* Sidebar navigation */}
			<nav className="compliance-sidebar" aria-label="Innholdsnavigasjon">
				<a href="#top" className="compliance-sidebar-home">
					Hjem
				</a>

				{screening.length > 0 && (
					<div className="compliance-sidebar-group">
						<a href="#screening" className="compliance-sidebar-domain">
							Innledende spørsmål
						</a>
					</div>
				)}

				{domains.map((domain) => (
					<div key={domain.name} className="compliance-sidebar-group">
						<a href={`#domain-${domain.name}`} className="compliance-sidebar-domain">
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
							{actionData.controlId === "screening"
								? "Svar på innledende spørsmål er lagret."
								: `Vurdering for ${actionData.controlId} er lagret.`}
						</div>
					)}

					{screening.length > 0 && (
						<VStack gap="space-8" id="screening" className="compliance-domain-section">
							<Heading size="large" level="3">
								Innledende spørsmål
							</Heading>
							<BodyLong size="small">
								Svar på spørsmålene under for å automatisk klassifisere relevante kontrollpunkter.
							</BodyLong>
							<VStack gap="space-6">
								{screening.map((q) => (
									<div key={q.id} className="compliance-card">
										<VStack gap="space-4">
											<Heading size="small" level="4">
												{q.questionText}
											</Heading>
											{q.effects.length > 0 && (
												<HStack gap="space-2" wrap>
													<BodyShort size="small" textColor="subtle">
														Påvirker:
													</BodyShort>
													{q.effects.map((e) => (
														<Tag key={e.controlTextId} variant="neutral" size="xsmall">
															{e.controlTextId}
														</Tag>
													))}
												</HStack>
											)}
											<Form method="post">
												<input type="hidden" name="intent" value="screening" />
												<input type="hidden" name="questionId" value={q.id} />
												<HStack gap="space-4" align="end">
													<RadioGroup
														legend="Svar"
														name="answer"
														size="small"
														defaultValue={q.answer === true ? "yes" : q.answer === false ? "no" : ""}
														hideLegend
													>
														<HStack gap="space-4">
															<Radio value="yes">Ja</Radio>
															<Radio value="no">Nei</Radio>
														</HStack>
													</RadioGroup>
													<Button type="submit" size="small" variant="secondary-neutral">
														Lagre
													</Button>
													{q.answer !== null && (
														<Tag variant={q.answer ? "success" : "warning"} size="xsmall">
															Besvart: {q.answer ? "Ja" : "Nei"}
														</Tag>
													)}
												</HStack>
											</Form>
										</VStack>
									</div>
								))}
							</VStack>
						</VStack>
					)}

					{domains.map((domain) => (
						<VStack key={domain.name} gap="space-12" id={`domain-${domain.name}`} className="compliance-domain-section">
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
