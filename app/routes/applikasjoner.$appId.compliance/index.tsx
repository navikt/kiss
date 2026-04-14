import { ExclamationmarkTriangleIcon, PlusIcon, TrashIcon } from "@navikt/aksel-icons"
import {
	Link as AkselLink,
	Alert,
	BodyLong,
	BodyShort,
	Box,
	Button,
	CopyButton,
	Detail,
	Heading,
	HStack,
	Label,
	Radio,
	RadioGroup,
	Search,
	Select,
	Table,
	Tag,
	Textarea,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { type ChangeEvent, useCallback, useRef, useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, useActionData, useFetcher, useLoaderData, useSearchParams } from "react-router"
import { ComplianceComment, ComplianceStatusBadge } from "~/components/ComplianceStatus"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAppAssessments, saveAssessment, saveAssessmentComment } from "~/db/queries/applications.server"
import { getAllRisks } from "~/db/queries/framework.server"
import {
	addManualGroup,
	addManualPersistence,
	deleteManualPersistence,
	getApplicationDetail,
	getAppPersistence,
	getGroupAssessmentsForApp,
	getManualGroupsForApp,
	removeManualGroup,
	updatePersistenceClassification,
	upsertGroupCriticality,
} from "~/db/queries/nais.server"
import { getRulesetsForSection } from "~/db/queries/rulesets.server"
import { getScreeningDataForApp, saveRoutineSelection, saveScreeningAnswer } from "~/db/queries/screening.server"
import {
	type DataClassification,
	dataClassificationLabels,
	type GroupCriticality,
	groupCriticalityEnum,
	groupCriticalityLabels,
	persistenceTypeEnum,
	persistenceTypeLabels,
} from "~/db/schema/applications"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { isComplianceStatus, statusLabels } from "~/lib/compliance-status"
import { resolveGroupNames } from "~/lib/graph.server"
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

	const [result, allRisks, screeningData] = await Promise.all([
		getAppAssessments(appId),
		getAllRisks(),
		getScreeningDataForApp(appId),
	])
	if (!result) throw new Response("Applikasjon ikke funnet", { status: 404 })

	// Load persistence data if any screening question uses the persistence answerType
	const hasPersistenceQuestion = screeningData.questions.some((q) => q.answerType === "persistence")
	const persistence = hasPersistenceQuestion ? await getAppPersistence(appId) : []

	// Load Entra ID groups data if any screening question uses the entra_id_groups answerType
	const hasEntraGroupsQuestion = screeningData.questions.some((q) => q.answerType === "entra_id_groups")
	let entraGroupsData: {
		naisGroupIds: string[]
		manualGroups: Array<{ id: string; groupId: string; groupName: string | null; createdBy: string; createdAt: string }>
		ghostGroupIds: string[]
		groupNames: Record<string, string>
		assessmentsByGroupId: Record<string, { criticality: string; updatedBy: string; updatedAt: string }>
	} = { naisGroupIds: [], manualGroups: [], ghostGroupIds: [], groupNames: {}, assessmentsByGroupId: {} }

	if (hasEntraGroupsQuestion) {
		const [appDetail, manualGroups, groupAssessments] = await Promise.all([
			getApplicationDetail(appId),
			getManualGroupsForApp(appId),
			getGroupAssessmentsForApp(appId),
		])
		const naisGroupIds: string[] = []
		if (appDetail) {
			for (const auth of appDetail.authIntegrations) {
				if (auth.groups) {
					const groups = JSON.parse(auth.groups) as string[]
					naisGroupIds.push(...groups)
				}
			}
		}
		const naisGroupIdSet = new Set(naisGroupIds)
		const manualGroupIdSet = new Set(manualGroups.map((g) => g.groupId))
		const ghostGroupIds = groupAssessments
			.filter((a) => !naisGroupIdSet.has(a.groupId) && !manualGroupIdSet.has(a.groupId))
			.map((a) => a.groupId)
		const allGroupIds = [...new Set([...naisGroupIds, ...manualGroups.map((g) => g.groupId), ...ghostGroupIds])]
		const groupNames = await resolveGroupNames(allGroupIds)
		const assessmentsByGroupId: Record<string, { criticality: string; updatedBy: string; updatedAt: string }> = {}
		for (const a of groupAssessments) {
			assessmentsByGroupId[a.groupId] = {
				criticality: a.criticality,
				updatedBy: a.updatedBy,
				updatedAt: a.updatedAt.toISOString(),
			}
		}
		entraGroupsData = {
			naisGroupIds,
			manualGroups: manualGroups.map((g) => ({ ...g, createdAt: g.createdAt.toISOString() })),
			ghostGroupIds,
			groupNames,
			assessmentsByGroupId,
		}
	}

	// Load rulesets if any screening question uses the ruleset answerType
	const hasRulesetQuestion = screeningData.questions.some((q) => q.answerType === "ruleset")
	const rulesetOptions: { id: string; name: string }[] = []
	if (hasRulesetQuestion && screeningData.sectionIds.length > 0) {
		const allRulesets = await Promise.all(screeningData.sectionIds.map((sid) => getRulesetsForSection(sid)))
		const seen = new Set<string>()
		for (const sectionRulesets of allRulesets) {
			for (const rs of sectionRulesets) {
				if (!seen.has(rs.id)) {
					seen.add(rs.id)
					rulesetOptions.push({ id: rs.id, name: rs.name })
				}
			}
		}
	}

	// Compute filter options from all assessments before filtering
	const responsibleOptions = uniqueSorted(result.assessments.map((a) => a.responsible))
	const technologyOptions = uniqueSorted(result.assessments.map((a) => a.technologyElementName))
	const frequencyOptions = uniqueSorted(result.assessments.map((a) => a.frequency))
	const domainOptions = uniqueSorted(result.assessments.map((a) => a.domainName))
	const statusOptions = Object.entries(statusLabels).map(([value, label]) => ({ value, label }))

	// Apply filters
	let filtered = result.assessments
	if (ansvarlig) filtered = filtered.filter((a) => a.responsible === ansvarlig)
	if (teknologielement) filtered = filtered.filter((a) => a.technologyElementName === teknologielement)
	if (frekvens) filtered = filtered.filter((a) => a.frequency === frekvens)
	if (status === "__not_assessed") filtered = filtered.filter((a) => a.status === null)
	else if (status) filtered = filtered.filter((a) => a.status === status)
	if (domene) filtered = filtered.filter((a) => a.domainName === domene)

	return data({
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
		screening: screeningData.questions.map((q) => ({
			...q,
			descriptionHtml: renderMarkdown(q.description),
		})),
		persistence: persistence.map((p) => ({
			id: p.id,
			type: p.type,
			name: p.name,
			dataClassification: p.dataClassification,
			manuallyAdded: p.manuallyAdded,
		})),
		rulesetOptions,
		entraGroupsData,
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

	if (intent === "selectRoutine") {
		const choiceEffectId = formData.get("choiceEffectId") as string
		const routineId = (formData.get("routineId") as string) || null
		if (!choiceEffectId) throw new Response("Mangler effekt-ID", { status: 400 })

		await saveRoutineSelection(appId, choiceEffectId, routineId, authedUser.navIdent)

		return data({ success: true, controlId: "screening", screening: true })
	}

	if (intent === "add-persistence") {
		const type = formData.get("persistenceType") as string
		const name = (formData.get("persistenceName") as string)?.trim()
		const classification = (formData.get("dataClassification") as string) || null

		if (!type || !name) {
			return data({ success: false, controlId: "screening", screening: true })
		}
		if (!persistenceTypeEnum.includes(type as (typeof persistenceTypeEnum)[number])) {
			return data({ success: false, controlId: "screening", screening: true })
		}
		const validClassification =
			classification && ["not_critical", "critical", "financial_regulation"].includes(classification)
				? (classification as DataClassification)
				: null

		await addManualPersistence(
			appId,
			type as (typeof persistenceTypeEnum)[number],
			name,
			validClassification,
			authedUser.navIdent,
		)
		return data({ success: true, controlId: "screening", screening: true })
	}

	if (intent === "update-persistence-classification") {
		const persistenceId = formData.get("persistenceId") as string
		const classification = (formData.get("dataClassification") as string) || null
		if (!persistenceId) throw new Response("Mangler persistens-ID", { status: 400 })

		const validClassification =
			classification && ["not_critical", "critical", "financial_regulation"].includes(classification)
				? (classification as DataClassification)
				: null

		await updatePersistenceClassification(persistenceId, validClassification, authedUser.navIdent)
		return data({ success: true, controlId: "screening", screening: true })
	}

	if (intent === "delete-persistence") {
		const persistenceId = formData.get("persistenceId") as string
		if (!persistenceId) throw new Response("Mangler persistens-ID", { status: 400 })
		await deleteManualPersistence(persistenceId, authedUser.navIdent)
		return data({ success: true, controlId: "screening", screening: true })
	}

	if (intent === "add-manual-group") {
		const groupId = (formData.get("groupId") as string)?.trim()
		const groupName = (formData.get("groupName") as string)?.trim() || null
		if (!groupId) return data({ success: false, controlId: "screening", screening: true })
		await addManualGroup(appId, groupId, groupName, authedUser.navIdent)
		return data({ success: true, controlId: "screening", screening: true })
	}

	if (intent === "remove-manual-group") {
		const manualGroupId = formData.get("manualGroupId") as string
		if (!manualGroupId) throw new Response("Mangler gruppe-ID", { status: 400 })
		await removeManualGroup(manualGroupId, appId, authedUser.navIdent)
		return data({ success: true, controlId: "screening", screening: true })
	}

	if (intent === "set-group-criticality") {
		const groupId = (formData.get("groupId") as string)?.trim()
		const criticality = formData.get("criticality") as string
		if (!groupId) return data({ success: false, controlId: "screening", screening: true })
		if (!groupCriticalityEnum.includes(criticality as GroupCriticality)) {
			return data({ success: false, controlId: "screening", screening: true })
		}
		await upsertGroupCriticality(appId, groupId, criticality as GroupCriticality, authedUser.navIdent)
		return data({ success: true, controlId: "screening", screening: true })
	}

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

export default function ComplianceAssessment() {
	const {
		appName,
		assessments,
		totalAssessments,
		isInherited,
		primaryName,
		primaryId,
		allRisks,
		screening,
		persistence,
		rulesetOptions,
		entraGroupsData,
		filters,
		options,
	} = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const [, setSearchParams] = useSearchParams()

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

	// Group risks by domain name (merge domains with same name)
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
											{q.answerType === "persistence" ? (
												<ScreeningPersistenceForm entries={persistence} />
											) : q.answerType === "entra_id_groups" ? (
												<ScreeningEntraGroupsForm entraGroupsData={entraGroupsData} />
											) : q.answerType === "ruleset" ? (
												<ScreeningRulesetForm question={q} rulesets={rulesetOptions} />
											) : (
												<ScreeningAnswerForm question={q} />
											)}
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
	const selectedChoice = q.choices.find((c) => c.label === selectedValue)
	const fetcher = useFetcher()

	// Determine which choice has active routine selections (the answered one)
	const answeredChoice = q.choices.find((c) => c.label === q.answer)
	const routineSelections = answeredChoice?.routineSelections ?? []

	if (q.answerType === "boolean" && q.choices.length === 2) {
		return (
			<VStack gap="space-4">
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
										<Radio key={c.label} value={c.label}>
											{c.label}
										</Radio>
									))}
								</HStack>
							</RadioGroup>
							<Button type="submit" size="small" variant="secondary-neutral">
								Lagre
							</Button>
							{q.answer !== null && (
								<HStack gap="space-2" align="center">
									<Tag variant="success" size="xsmall">
										Besvart: {q.answer}
									</Tag>
									{q.answeredBy && (
										<BodyShort size="small" textColor="subtle">
											av {q.answeredBy}
											{q.answeredAt && ` — ${new Date(q.answeredAt).toLocaleDateString("nb-NO")}`}
										</BodyShort>
									)}
								</HStack>
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
				{routineSelections.map((rs) => (
					<fetcher.Form method="post" key={rs.effectId}>
						<input type="hidden" name="intent" value="selectRoutine" />
						<input type="hidden" name="choiceEffectId" value={rs.effectId} />
						<HStack gap="space-4" align="end">
							<Select
								label={`Velg rutine for ${rs.controlTextId}`}
								name="routineId"
								size="small"
								defaultValue={rs.selectedRoutineId ?? ""}
							>
								<option value="">– Ikke valgt –</option>
								{rs.routines.map((r) => (
									<option key={r.id} value={r.id}>
										{r.name}
									</option>
								))}
							</Select>
							<Button type="submit" size="small" variant="secondary-neutral">
								Lagre
							</Button>
						</HStack>
					</fetcher.Form>
				))}
			</VStack>
		)
	}

	// single_choice with dropdown
	return (
		<VStack gap="space-4">
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
								<option key={c.label} value={c.label}>
									{c.label}
								</option>
							))}
						</Select>
						<Button type="submit" size="small" variant="secondary-neutral">
							Lagre
						</Button>
						{q.answer !== null && (
							<HStack gap="space-2" align="center">
								<Tag variant="success" size="xsmall">
									Besvart: {q.answer}
								</Tag>
								{q.answeredBy && (
									<BodyShort size="small" textColor="subtle">
										av {q.answeredBy}
										{q.answeredAt && ` — ${new Date(q.answeredAt).toLocaleDateString("nb-NO")}`}
									</BodyShort>
								)}
							</HStack>
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
			{routineSelections.map((rs) => (
				<fetcher.Form method="post" key={rs.effectId}>
					<input type="hidden" name="intent" value="selectRoutine" />
					<input type="hidden" name="choiceEffectId" value={rs.effectId} />
					<HStack gap="space-4" align="end">
						<Select
							label={`Velg rutine for ${rs.controlTextId}`}
							name="routineId"
							size="small"
							defaultValue={rs.selectedRoutineId ?? ""}
						>
							<option value="">– Ikke valgt –</option>
							{rs.routines.map((r) => (
								<option key={r.id} value={r.id}>
									{r.name}
								</option>
							))}
						</Select>
						<Button type="submit" size="small" variant="secondary-neutral">
							Lagre
						</Button>
					</HStack>
				</fetcher.Form>
			))}
		</VStack>
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

type RulesetOption = ReturnType<typeof useLoaderData<typeof loader>>["rulesetOptions"][number]

function ScreeningRulesetForm({ question: q, rulesets }: { question: ScreeningQuestion; rulesets: RulesetOption[] }) {
	const selectedRuleset = rulesets.find((rs) => rs.id === q.answer)

	return (
		<VStack gap="space-4">
			<Form method="post">
				<input type="hidden" name="intent" value="screening" />
				<input type="hidden" name="questionId" value={q.id} />
				<HStack gap="space-4" align="end">
					<Select label="Velg regelsett" name="answer" size="small" defaultValue={q.answer ?? ""}>
						<option value="">— Ikke valgt —</option>
						{rulesets.map((rs) => (
							<option key={rs.id} value={rs.id}>
								{rs.name}
							</option>
						))}
					</Select>
					<Button type="submit" size="small" variant="secondary-neutral">
						Lagre
					</Button>
					{q.answer !== null && (
						<HStack gap="space-2" align="center">
							<Tag variant="success" size="xsmall">
								Besvart: {selectedRuleset?.name ?? q.answer}
							</Tag>
							{q.answeredBy && (
								<BodyShort size="small" textColor="subtle">
									av {q.answeredBy}
									{q.answeredAt && ` — ${new Date(q.answeredAt).toLocaleDateString("nb-NO")}`}
								</BodyShort>
							)}
						</HStack>
					)}
				</HStack>
			</Form>
		</VStack>
	)
}

type PersistenceEntry = ReturnType<typeof useLoaderData<typeof loader>>["persistence"][number]

const persistenceVariants: Record<string, "info" | "warning" | "alt1" | "alt2" | "alt3" | "neutral"> = {
	cloud_sql_postgres: "info",
	nais_postgres: "info",
	on_prem_postgres: "warning",
	opensearch: "alt1",
	bucket: "alt2",
	valkey: "alt3",
	oracle: "warning",
	other: "neutral",
}

function ScreeningPersistenceForm({ entries }: { entries: PersistenceEntry[] }) {
	const fetcher = useFetcher()

	return (
		<VStack gap="space-6">
			{entries.length > 0 && (
				<section className="table-scroll" aria-label="Registrerte databaser">
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell>Type</Table.HeaderCell>
								<Table.HeaderCell>Navn</Table.HeaderCell>
								<Table.HeaderCell>Klassifisering</Table.HeaderCell>
								<Table.HeaderCell />
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{entries.map((p) => (
								<Table.Row key={p.id}>
									<Table.DataCell>
										<Tag variant={persistenceVariants[p.type] ?? "neutral"} size="xsmall">
											{persistenceTypeLabels[p.type as keyof typeof persistenceTypeLabels] ?? p.type}
										</Tag>
									</Table.DataCell>
									<Table.DataCell>{p.name}</Table.DataCell>
									<Table.DataCell>
										<fetcher.Form method="post">
											<input type="hidden" name="intent" value="update-persistence-classification" />
											<input type="hidden" name="persistenceId" value={p.id} />
											<Select
												label="Klassifisering"
												hideLabel
												name="dataClassification"
												size="small"
												defaultValue={p.dataClassification ?? ""}
												onChange={(e) => {
													const form = e.target.closest("form")
													if (form) fetcher.submit(form)
												}}
											>
												<option value="">Ikke satt</option>
												{(Object.entries(dataClassificationLabels) as [DataClassification, string][]).map(
													([value, label]) => (
														<option key={value} value={value}>
															{label}
														</option>
													),
												)}
											</Select>
										</fetcher.Form>
									</Table.DataCell>
									<Table.DataCell>
										{p.manuallyAdded && (
											<fetcher.Form method="post">
												<input type="hidden" name="intent" value="delete-persistence" />
												<input type="hidden" name="persistenceId" value={p.id} />
												<Button type="submit" size="xsmall" variant="tertiary-neutral" icon={<TrashIcon aria-hidden />}>
													Slett
												</Button>
											</fetcher.Form>
										)}
									</Table.DataCell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				</section>
			)}

			{entries.length === 0 && (
				<BodyShort size="small" textColor="subtle">
					Ingen databaser registrert ennå.
				</BodyShort>
			)}

			<fetcher.Form method="post">
				<input type="hidden" name="intent" value="add-persistence" />
				<HStack gap="space-4" align="end" wrap>
					<Select label="Type" name="persistenceType" size="small" style={{ minWidth: "12rem" }}>
						{persistenceTypeEnum.map((t) => (
							<option key={t} value={t}>
								{persistenceTypeLabels[t] ?? t}
							</option>
						))}
					</Select>
					<TextField label="Navn" name="persistenceName" size="small" style={{ minWidth: "14rem" }} />
					<Select label="Dataklassifisering" name="dataClassification" size="small">
						<option value="">Ikke satt</option>
						{(Object.entries(dataClassificationLabels) as [DataClassification, string][]).map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</Select>
					<Button
						type="submit"
						variant="secondary-neutral"
						size="small"
						icon={<PlusIcon aria-hidden />}
						loading={fetcher.state !== "idle"}
					>
						Legg til
					</Button>
				</HStack>
			</fetcher.Form>
		</VStack>
	)
}

// ─── Screening Entra ID Groups Form ─────────────────────────────────────

function ScreeningEntraGroupsForm({
	entraGroupsData,
}: {
	entraGroupsData: {
		naisGroupIds: string[]
		manualGroups: Array<{ id: string; groupId: string; groupName: string | null; createdBy: string; createdAt: string }>
		ghostGroupIds: string[]
		groupNames: Record<string, string>
		assessmentsByGroupId: Record<string, { criticality: string; updatedBy: string; updatedAt: string }>
	}
}) {
	const addFetcher = useFetcher()
	const removeFetcher = useFetcher()
	const criticalityFetcher = useFetcher()
	const searchFetcher = useFetcher<{ results: Array<{ id: string; displayName: string }> }>()
	const [searchQuery, setSearchQuery] = useState("")
	const [showResults, setShowResults] = useState(false)
	const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	const { naisGroupIds, manualGroups, ghostGroupIds, groupNames, assessmentsByGroupId } = entraGroupsData

	const searchResults = searchFetcher.data?.results ?? []
	const isSearching = searchFetcher.state === "loading"

	const handleSearch = useCallback(
		(value: string) => {
			setSearchQuery(value)
			if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
			if (value.trim().length < 2) {
				setShowResults(false)
				return
			}
			searchTimeoutRef.current = setTimeout(() => {
				searchFetcher.load(`/api/graph/groups?q=${encodeURIComponent(value.trim())}`)
				setShowResults(true)
			}, 300)
		},
		[searchFetcher],
	)

	const handleAddGroup = useCallback(
		(groupId: string, displayName: string) => {
			addFetcher.submit({ intent: "add-manual-group", groupId, groupName: displayName }, { method: "POST" })
			setSearchQuery("")
			setShowResults(false)
		},
		[addFetcher],
	)

	// Build unified group list
	const naisGroupIdSet = new Set(naisGroupIds)
	const allExistingGroupIds = new Set([...naisGroupIds, ...manualGroups.map((g) => g.groupId)])

	type UnifiedGroup = {
		groupId: string
		source: "nais" | "manual" | "removed"
		manualGroupDbId?: string
		createdBy?: string
	}

	const unifiedGroups: UnifiedGroup[] = []
	for (const gid of naisGroupIds) {
		unifiedGroups.push({ groupId: gid, source: "nais" })
	}
	for (const mg of manualGroups) {
		if (!naisGroupIdSet.has(mg.groupId)) {
			unifiedGroups.push({ groupId: mg.groupId, source: "manual", manualGroupDbId: mg.id, createdBy: mg.createdBy })
		}
	}
	for (const gid of ghostGroupIds) {
		unifiedGroups.push({ groupId: gid, source: "removed" })
	}

	return (
		<VStack gap="space-6">
			{/* Search to add group */}
			<Box
				padding="space-4"
				borderRadius="8"
				borderWidth="1"
				borderColor="neutral-subtle"
				style={{ position: "relative" }}
			>
				<VStack gap="space-2">
					<Search
						label="Legg til gruppe (søk på navn eller Object-ID)"
						size="small"
						value={searchQuery}
						onChange={handleSearch}
						onClear={() => {
							setSearchQuery("")
							setShowResults(false)
						}}
					/>

					{showResults && (
						<Box
							padding="space-2"
							borderRadius="8"
							borderWidth="1"
							borderColor="neutral-subtle"
							shadow="dialog"
							style={{
								position: "absolute",
								top: "100%",
								left: 0,
								right: 0,
								zIndex: 10,
								marginTop: "4px",
								backgroundColor: "var(--ax-bg-default)",
							}}
						>
							{isSearching ? (
								<BodyShort size="small" textColor="subtle" style={{ padding: "var(--ax-space-4)" }}>
									Søker…
								</BodyShort>
							) : searchResults.length > 0 ? (
								<VStack>
									{searchResults.map((result) => {
										const alreadyAdded = allExistingGroupIds.has(result.id)
										return (
											<Button
												key={result.id}
												variant="tertiary-neutral"
												size="small"
												style={{ justifyContent: "flex-start", width: "100%", textAlign: "left" }}
												onClick={() => handleAddGroup(result.id, result.displayName)}
												disabled={alreadyAdded}
											>
												<VStack>
													<BodyShort size="small" weight="semibold">
														{result.displayName}
														{alreadyAdded && " (allerede lagt til)"}
													</BodyShort>
													<Detail textColor="subtle">{result.id}</Detail>
												</VStack>
											</Button>
										)
									})}
								</VStack>
							) : (
								<BodyShort size="small" textColor="subtle" style={{ padding: "var(--ax-space-4)" }}>
									Ingen grupper funnet
								</BodyShort>
							)}
						</Box>
					)}
				</VStack>
			</Box>

			{/* Unified groups table */}
			{unifiedGroups.length > 0 ? (
				<Table size="small">
					<Table.Header>
						<Table.Row>
							<Table.HeaderCell scope="col">Navn</Table.HeaderCell>
							<Table.HeaderCell scope="col">Gruppe-ID</Table.HeaderCell>
							<Table.HeaderCell scope="col">Kilde</Table.HeaderCell>
							<Table.HeaderCell scope="col">Kritikalitet</Table.HeaderCell>
							<Table.HeaderCell scope="col" style={{ width: "1px" }}>
								<span className="navds-sr-only">Handlinger</span>
							</Table.HeaderCell>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{unifiedGroups.map((ug) => {
							const assessment = assessmentsByGroupId[ug.groupId]
							const displayName =
								groupNames[ug.groupId] ?? manualGroups.find((mg) => mg.groupId === ug.groupId)?.groupName ?? null

							return (
								<Table.Row key={`${ug.source}-${ug.groupId}`}>
									<Table.DataCell>
										{displayName ?? (
											<BodyShort size="small" textColor="subtle">
												Ukjent
											</BodyShort>
										)}
									</Table.DataCell>
									<Table.DataCell>
										<HStack gap="space-1" align="center">
											<code style={{ fontSize: "var(--ax-font-size-sm)" }}>{ug.groupId}</code>
											<CopyButton copyText={ug.groupId} size="xsmall" />
										</HStack>
									</Table.DataCell>
									<Table.DataCell>
										{ug.source === "nais" && (
											<Tag variant="info" size="xsmall">
												Nais
											</Tag>
										)}
										{ug.source === "manual" && (
											<Tag variant="neutral" size="xsmall">
												Manuell
											</Tag>
										)}
										{ug.source === "removed" && (
											<Tag variant="error" size="xsmall">
												<ExclamationmarkTriangleIcon aria-hidden fontSize="1rem" /> Borte fra manifest
											</Tag>
										)}
									</Table.DataCell>
									<Table.DataCell>
										<criticalityFetcher.Form method="post">
											<input type="hidden" name="intent" value="set-group-criticality" />
											<input type="hidden" name="groupId" value={ug.groupId} />
											<Select
												label="Kritikalitet"
												hideLabel
												size="small"
												value={assessment?.criticality ?? ""}
												onChange={(e: ChangeEvent<HTMLSelectElement>) => {
													criticalityFetcher.submit(
														{
															intent: "set-group-criticality",
															groupId: ug.groupId,
															criticality: e.target.value,
														},
														{ method: "POST" },
													)
												}}
												style={{ minWidth: "120px" }}
											>
												<option value="" disabled>
													Velg…
												</option>
												{groupCriticalityEnum.map((c) => (
													<option key={c} value={c}>
														{groupCriticalityLabels[c]}
													</option>
												))}
											</Select>
										</criticalityFetcher.Form>
									</Table.DataCell>
									<Table.DataCell>
										{ug.source === "manual" && ug.manualGroupDbId && (
											<removeFetcher.Form method="post">
												<input type="hidden" name="intent" value="remove-manual-group" />
												<input type="hidden" name="manualGroupId" value={ug.manualGroupDbId} />
												<Button
													type="submit"
													variant="tertiary-neutral"
													size="xsmall"
													icon={<TrashIcon aria-hidden />}
													loading={removeFetcher.state !== "idle"}
												>
													Fjern
												</Button>
											</removeFetcher.Form>
										)}
									</Table.DataCell>
								</Table.Row>
							)
						})}
					</Table.Body>
				</Table>
			) : (
				<BodyShort size="small" textColor="subtle">
					Ingen Entra ID-grupper registrert ennå.
				</BodyShort>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
