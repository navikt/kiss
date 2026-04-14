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
	Radio,
	RadioGroup,
	Search,
	Select,
	Table,
	Tag,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { type ChangeEvent, useCallback, useRef, useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, useActionData, useFetcher, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
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

export async function loader({ params }: LoaderFunctionArgs) {
	const appId = params.appId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })

	const [screeningData, appDetail] = await Promise.all([getScreeningDataForApp(appId), getApplicationDetail(appId)])
	if (!appDetail) throw new Response("Applikasjon ikke funnet", { status: 404 })

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
		const [manualGroups, groupAssessments] = await Promise.all([
			getManualGroupsForApp(appId),
			getGroupAssessmentsForApp(appId),
		])
		const naisGroupIds: string[] = []
		for (const auth of appDetail.authIntegrations) {
			if (auth.groups) {
				const groups = JSON.parse(auth.groups) as string[]
				naisGroupIds.push(...groups)
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

	return data({
		appId,
		appName: appDetail.app.name,
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

	throw new Response("Ukjent handling", { status: 400 })
}

export default function ComplianceAssessment() {
	const { appId, appName, screening, persistence, rulesetOptions, entraGroupsData } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()

	const answeredCount = screening.filter((q) => q.answer !== null).length

	return (
		<section className="compliance-layout" aria-label="Compliance-vurdering">
			{/* Sidebar navigation */}
			<nav className="compliance-sidebar" aria-label="Innholdsnavigasjon">
				<AkselLink href="#top" className="compliance-sidebar-home">
					Hjem
				</AkselLink>

				{screening.map((q) => (
					<div key={q.id} className="compliance-sidebar-group">
						<AkselLink href={`#q-${slugify(q.questionText)}`} className="compliance-sidebar-question">
							<span className="compliance-sidebar-question-icon">{q.answer !== null ? "✓" : "○"}</span>
							<span className="compliance-sidebar-question-text">{q.questionText}</span>
						</AkselLink>
					</div>
				))}

				<div className="compliance-sidebar-group">
					<AkselLink
						href={`/applikasjoner/${appId}/compliance-krav`}
						className="compliance-sidebar-domain"
						style={{ fontWeight: "bold" }}
					>
						Kravgjennomgang →
					</AkselLink>
				</div>
			</nav>

			{/* Main content */}
			<div className="compliance-content" id="top">
				<VStack gap="space-8">
					<Heading size="xlarge" level="2">
						Compliance-vurdering: {appName}
					</Heading>

					{actionData?.success && (
						<div className="compliance-success" role="status" aria-live="polite">
							Svar på innledende spørsmål er lagret.
						</div>
					)}

					<HStack gap="space-6" align="center">
						<BodyShort size="small" textColor="subtle">
							{answeredCount} av {screening.length} spørsmål besvart
						</BodyShort>
						<Link to={`/applikasjoner/${appId}/compliance-krav`}>
							<Button as="span" size="small" variant="secondary">
								Gå til kravgjennomgang →
							</Button>
						</Link>
					</HStack>

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
									<div key={q.id} id={`q-${slugify(q.questionText)}`} className="compliance-card">
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

					{screening.length === 0 && (
						<Alert variant="info" size="small">
							Ingen innledende spørsmål er konfigurert for denne applikasjonen.{" "}
							<Link to={`/applikasjoner/${appId}/compliance-krav`}>Gå direkte til kravgjennomgang</Link>.
						</Alert>
					)}
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
