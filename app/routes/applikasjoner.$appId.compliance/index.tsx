import {
	Link as AkselLink,
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
	TextField,
	VStack,
} from "@navikt/ds-react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, useActionData, useLoaderData } from "react-router"
import { ComplianceComment, ComplianceStatusBadge } from "~/components/ComplianceStatus"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAppAssessments, saveAssessment } from "~/db/queries/applications.server"
import { getAllRisks } from "~/db/queries/framework.server"
import { getScreeningDataForApp, saveScreeningAnswer } from "~/db/queries/screening.server"
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
		assessments: result.assessments.map((a) => ({
			...a,
			requirementHtml: renderMarkdown(a.requirement),
		})),
		isInherited: result.isInherited,
		primaryName: result.primaryName,
		primaryId: result.app.primaryApplicationId,
		allRisks: allRisks.map((r) => ({
			...r,
			descriptionHtml: renderMarkdown(r.description),
		})),
		screening: screeningData.questions.map((q) => ({
			...q,
			descriptionHtml: renderMarkdown(q.description),
		})),
	})
}

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
		const answerComment = formData.get("answerComment") as string | null
		const answerLink = formData.get("answerLink") as string | null
		if (!questionId) throw new Response("Mangler spørsmål-ID", { status: 400 })

		const answer = answerValue || null
		await saveScreeningAnswer(appId, questionId, answer, authedUser.navIdent, answerComment, answerLink)

		return data({ success: true, controlId: "screening", screening: true })
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

export default function ComplianceAssessment() {
	const { appName, assessments, isInherited, primaryName, primaryId, allRisks, screening } =
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
		<section className="compliance-layout" aria-label="Compliance-vurdering">
			{/* Sidebar navigation */}
			<nav className="compliance-sidebar" aria-label="Innholdsnavigasjon">
				<AkselLink href="#top" className="compliance-sidebar-home">
					Hjem
				</AkselLink>

				{screening.length > 0 && (
					<div className="compliance-sidebar-group">
						<AkselLink href="#screening" className="compliance-sidebar-domain">
							Innledende spørsmål
						</AkselLink>
					</div>
				)}

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
						<div className="compliance-success" role="status" aria-live="polite">
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
											{q.descriptionHtml && (
												// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized with DOMPurify
												<div className="markdown-content" dangerouslySetInnerHTML={{ __html: q.descriptionHtml }} />
											)}
											{q.affectedControls.length > 0 && (
												<HStack gap="space-2" wrap>
													<BodyShort size="small" textColor="subtle">
														Påvirker:
													</BodyShort>
													{q.affectedControls.map((controlId) => (
														<Tag key={controlId} variant="neutral" size="xsmall">
															{controlId}
														</Tag>
													))}
												</HStack>
											)}
											<ScreeningAnswerForm question={q} />
										</VStack>
									</div>
								))}
							</VStack>
						</VStack>
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

type ScreeningQuestion = ReturnType<typeof useLoaderData<typeof loader>>["screening"][number]

function ScreeningAnswerForm({ question: q }: { question: ScreeningQuestion }) {
	const [selectedValue, setSelectedValue] = useState<string>(q.answer ?? "")
	const selectedChoice = q.choices.find((c) => c.value === selectedValue)

	if (q.answerType === "boolean" && q.choices.length === 2) {
		return (
			<Form method="post">
				<input type="hidden" name="intent" value="screening" />
				<input type="hidden" name="questionId" value={q.id} />
				<VStack gap="space-4">
					<HStack gap="space-4" align="end">
						<RadioGroup
							legend="Svar"
							name="answer"
							size="small"
							defaultValue={q.answer ?? ""}
							hideLegend
							onChange={(val) => setSelectedValue(val)}
						>
							<HStack gap="space-4">
								{q.choices.map((c) => (
									<Radio key={c.value} value={c.value}>
										{c.label}
									</Radio>
								))}
							</HStack>
						</RadioGroup>
						<Button type="submit" size="small" variant="secondary-neutral">
							Lagre
						</Button>
						{q.answer !== null && (
							<Tag variant="success" size="xsmall">
								Besvart: {q.choices.find((c) => c.value === q.answer)?.label ?? q.answer}
							</Tag>
						)}
					</HStack>
					{selectedChoice?.requiresComment && (
						<TextField label="Kommentar" name="answerComment" size="small" defaultValue={q.answerComment ?? ""} />
					)}
					{selectedChoice?.requiresLink && (
						<TextField label="Lenke" name="answerLink" size="small" defaultValue={q.answerLink ?? ""} />
					)}
				</VStack>
			</Form>
		)
	}

	// single_choice with dropdown
	return (
		<Form method="post">
			<input type="hidden" name="intent" value="screening" />
			<input type="hidden" name="questionId" value={q.id} />
			<VStack gap="space-4">
				<HStack gap="space-4" align="end">
					<Select
						label="Svar"
						name="answer"
						size="small"
						defaultValue={q.answer ?? ""}
						onChange={(e) => setSelectedValue(e.target.value)}
					>
						<option value="" disabled>
							Velg svar
						</option>
						{q.choices.map((c) => (
							<option key={c.value} value={c.value}>
								{c.label}
							</option>
						))}
					</Select>
					<Button type="submit" size="small" variant="secondary-neutral">
						Lagre
					</Button>
					{q.answer !== null && (
						<Tag variant="success" size="xsmall">
							Besvart: {q.choices.find((c) => c.value === q.answer)?.label ?? q.answer}
						</Tag>
					)}
				</HStack>
				{selectedChoice?.requiresComment && (
					<TextField label="Kommentar" name="answerComment" size="small" defaultValue={q.answerComment ?? ""} />
				)}
				{selectedChoice?.requiresLink && (
					<TextField label="Lenke" name="answerLink" size="small" defaultValue={q.answerLink ?? ""} />
				)}
			</VStack>
		</Form>
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
						{assessment.controlId}: {assessment.controlName}
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
				<Button type="submit" size="small" variant="primary">
					Lagre vurdering
				</Button>
			</Form>
		</div>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
