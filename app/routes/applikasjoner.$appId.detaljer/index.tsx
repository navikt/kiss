import {
	DownloadIcon,
	ExclamationmarkTriangleIcon,
	ExternalLinkIcon,
	EyeIcon,
	PlusIcon,
	TrashIcon,
	UploadIcon,
	XMarkOctagonIcon,
} from "@navikt/aksel-icons"
import {
	Link as AkselLink,
	Alert,
	BodyLong,
	BodyShort,
	Box,
	Button,
	Checkbox,
	CheckboxGroup,
	CopyButton,
	Detail,
	Heading,
	HGrid,
	HStack,
	Label,
	Modal,
	ReadMore,
	Search,
	Select,
	Table,
	Tabs,
	Tag,
	Textarea,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { type ChangeEvent, useCallback, useRef, useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import {
	data,
	Link,
	redirect,
	useActionData,
	useFetcher,
	useLoaderData,
	useNavigation,
	useSearchParams,
	useSubmit,
} from "react-router"
import { ComplianceStatusBadge } from "~/components/ComplianceStatus"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAppAssessments } from "~/db/queries/applications.server"
import { getOracleInstancesForApp, getSnapshotHistory } from "~/db/queries/audit-evidence.server"
import { getOracleAuditSummariesForApp } from "~/db/queries/audit-logging.server"
import { getScreeningEffectsByControlForApp } from "~/db/queries/compliance-auto.server"
import {
	acknowledgeUnknownApp,
	addManualGroup,
	addManualPersistence,
	deleteManualPersistence,
	getActiveAcknowledgments,
	getApplicationDetail,
	getGroupAssessmentsForApp,
	getManualGroupsForApp,
	removeManualGroup,
	resolveAppNames,
	revokeAcknowledgment,
	updatePersistenceClassification,
	upsertGroupCriticality,
} from "~/db/queries/nais.server"
import { generateAppComplianceReport, getReportsForApp } from "~/db/queries/reports.server"
import {
	createReview,
	getReviewsForApp,
	getRoutineDeadlinesForApp,
	getRoutineDeadlinesForAppByPersistence,
	getRoutineDeadlinesForAppByRuleset,
	getRoutineDeadlinesForAppByScreeningSelection,
	getRoutineDeadlinesForAppBySection,
} from "~/db/queries/routines.server"
import { getSections } from "~/db/queries/sections.server"
import {
	type DataClassification,
	dataClassificationLabels,
	type GroupCriticality,
	groupCriticalityEnum,
	groupCriticalityLabels,
	persistenceTypeEnum,
	persistenceTypeLabels,
} from "~/db/schema/applications"
import { useAppBasePath } from "~/hooks/useAppBasePath"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { isAdmin } from "~/lib/authorization.server"
import { computeAutoCompliance } from "~/lib/auto-compliance"
import type { ComplianceStatus } from "~/lib/compliance-status"
import {
	complianceLabels,
	complianceVariants,
	establishmentLabels,
	establishmentVariants,
	type RoutineCompliance,
	type RoutineEstablishment,
} from "~/lib/compliance-status"
import { resolveGroupNames } from "~/lib/graph.server"
import { filterInstancesByAccess } from "~/lib/oracle-access.server"
import { getOracleInstances } from "~/lib/oracle-revisjon.server"
import { getFrequencyLabel } from "~/lib/routine-frequencies"
import { compliancePercent } from "~/lib/utils"

const persistenceLabels = persistenceTypeLabels as Record<string, string>

const persistenceVariants: Record<
	string,
	"info" | "success" | "warning" | "error" | "neutral" | "alt1" | "alt2" | "alt3"
> = {
	cloud_sql_postgres: "info",
	nais_postgres: "info",
	on_prem_postgres: "warning",
	opensearch: "alt1",
	bucket: "alt2",
	valkey: "alt3",
	oracle: "warning",
	other: "neutral",
}

const authLabels: Record<string, string> = {
	entra_id: "Entra ID",
	token_x: "TokenX",
	id_porten: "ID-porten",
	maskinporten: "Maskinporten",
}

const conclusionConfig: Record<string, { label: string; variant: "success" | "warning" | "error" | "neutral" }> = {
	FULLSTENDIG: { label: "Fullstendig", variant: "success" },
	MANGELFULL: { label: "Mangelfull", variant: "warning" },
	AV: { label: "Av", variant: "error" },
	UKJENT: { label: "Ukjent", variant: "neutral" },
}

const findingSeverityVariant: Record<string, "error" | "warning" | "info"> = {
	KRITISK: "error",
	ADVARSEL: "warning",
	INFO: "info",
}

export async function loader({ request, params }: LoaderFunctionArgs) {
	const appId = params.appId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })

	const user = await getAuthenticatedUser(request)

	// Breadcrumb context for team-context routes
	const breadcrumbCtx =
		params.seksjon && params.team
			? await (async () => {
					const { getTeamBreadcrumbContext } = await import("~/lib/breadcrumb-context.server")
					return getTeamBreadcrumbContext(params.seksjon!, params.team!)
				})()
			: {}

	const [detail, assessmentsResult] = await Promise.all([getApplicationDetail(appId), getAppAssessments(appId)])

	if (!detail) throw new Response("Applikasjon ikke funnet", { status: 404 })

	const { getApplicationElements } = await import("~/db/queries/technology-elements.server")
	const [appElements, screeningRoutines, completedReviews, allSections, appReports] = await Promise.all([
		getApplicationElements(appId),
		getRoutineDeadlinesForApp(appId),
		getReviewsForApp(appId),
		getSections(),
		getReportsForApp(appId),
	])

	// Find routines matching via persistence type/classification, excluding already-matched ones
	const screeningRoutineIds = new Set(screeningRoutines.map((d) => d.routine?.id).filter(Boolean) as string[])
	const persistenceRoutines = await getRoutineDeadlinesForAppByPersistence(appId, screeningRoutineIds)

	// Find routines explicitly selected via screening questions
	const alreadyMatchedIds = new Set([
		...screeningRoutineIds,
		...(persistenceRoutines.map((d) => d.routine?.id).filter(Boolean) as string[]),
	])
	const screeningSelectionRoutines = await getRoutineDeadlinesForAppByScreeningSelection(appId, alreadyMatchedIds)

	// Find routines that apply to all apps in sections this app belongs to
	const allMatchedIds = new Set([
		...alreadyMatchedIds,
		...(screeningSelectionRoutines.map((d) => d.routine?.id).filter(Boolean) as string[]),
	])
	const sectionWideRoutines = await getRoutineDeadlinesForAppBySection(appId, allMatchedIds)

	// Find routines linked to rulesets in the app's sections
	const allMatchedBeforeRuleset = new Set([
		...allMatchedIds,
		...(sectionWideRoutines.map((d) => d.routine?.id).filter(Boolean) as string[]),
	])
	const rulesetRoutines = await getRoutineDeadlinesForAppByRuleset(appId, allMatchedBeforeRuleset)

	// Tag each deadline with its match source
	const routineDeadlines = [
		...screeningRoutines.map((d) => ({ ...d, matchSource: "screening" as const })),
		...persistenceRoutines.map((d) => ({ ...d, matchSource: "persistence" as const })),
		...screeningSelectionRoutines.map((d) => ({ ...d, matchSource: "screening_selection" as const })),
		...sectionWideRoutines.map((d) => ({ ...d, matchSource: "section" as const })),
		...rulesetRoutines.map((d) => ({ ...d, matchSource: "ruleset" as const })),
	]

	// Batch-load routine → control mappings for auto-compliance computation
	const allRoutineIds = [...new Set(routineDeadlines.map((d) => d.routine?.id).filter(Boolean) as string[])]
	const routineControlsMap = new Map<string, Array<{ id: string }>>()
	if (allRoutineIds.length > 0) {
		const { routineControls: routineControlsTable } = await import("~/db/schema/routines")
		const { db } = await import("~/db/connection.server")
		const { inArray } = await import("drizzle-orm")
		const controlRows = await db
			.select({ routineId: routineControlsTable.routineId, controlId: routineControlsTable.controlId })
			.from(routineControlsTable)
			.where(inArray(routineControlsTable.routineId, allRoutineIds))
		for (const row of controlRows) {
			const list = routineControlsMap.get(row.routineId) ?? []
			list.push({ id: row.controlId })
			routineControlsMap.set(row.routineId, list)
		}
	}

	// Build routine deadlines enriched with controls for auto-compliance
	const deadlinesWithControls = routineDeadlines.map((d) => ({
		...d,
		routine: d.routine ? { ...d.routine, controls: routineControlsMap.get(d.routine.id) ?? [] } : d.routine,
	}))

	// Compute auto-compliance status (sole source of compliance status)
	const screeningEffectsByControl = await getScreeningEffectsByControlForApp(appId)
	const autoComplianceMap = computeAutoCompliance(
		(assessmentsResult?.assessments ?? []).map((a) => ({
			controlUuid: a.controlUuid,
			technologyElementId: a.technologyElementId,
			status: null,
		})),
		deadlinesWithControls,
		screeningEffectsByControl,
	)

	// Build section ID → slug lookup for routine links
	const sectionSlugMap = Object.fromEntries(allSections.map((s) => [s.id, s.slug]))

	const assessments = (assessmentsResult?.assessments ?? []).map((a) => {
		const key = `${a.controlUuid}:${a.technologyElementId ?? "null"}`
		const auto = autoComplianceMap.get(key)
		return {
			...a,
			autoStatus: auto?.autoStatus ?? null,
			autoReason: auto?.reason ?? null,
			effectiveStatus: auto?.autoStatus ?? null,
			establishment: auto?.establishment ?? "not_established",
			routineCompliance: auto?.compliance ?? "not_applicable",
			routinesEstablished: auto?.routinesEstablished ?? 0,
			routinesCompleted: auto?.routinesCompleted ?? 0,
			routinesOverdue: auto?.routinesOverdue ?? 0,
		}
	})
	const totalControls = assessments.length
	const implemented = assessments.filter((a) => a.effectiveStatus === "implemented").length
	const partial = assessments.filter((a) => a.effectiveStatus === "partially_implemented").length
	const notImplemented = assessments.filter((a) => a.effectiveStatus === "not_implemented").length
	const notRelevant = assessments.filter((a) => a.effectiveStatus === "not_relevant").length
	const notAssessed = assessments.filter((a) => !a.effectiveStatus).length

	// Two-dimensional summary
	const withRoutine = assessments.filter((a) => a.establishment === "established").length
	const withoutRoutine = assessments.filter((a) => a.establishment === "not_established").length
	const routineNotRelevant = assessments.filter((a) => a.establishment === "not_relevant").length
	const routineCompleted = assessments.filter((a) => a.routineCompliance === "completed").length
	const routineOverdue = assessments.filter((a) => a.routineCompliance === "overdue").length
	const routineNeverReviewed = assessments.filter((a) => a.routineCompliance === "never_reviewed").length

	// Collect all referenced app names from auth inbound rules and access policy rules
	const referencedAppNames = new Set<string>()
	for (const auth of detail.authIntegrations) {
		if (auth.inboundRules) {
			const rules = JSON.parse(auth.inboundRules) as Array<{ application: string }>
			for (const r of rules) referencedAppNames.add(r.application)
		}
	}
	for (const rule of detail.accessPolicyRules) {
		referencedAppNames.add(rule.ruleApplication)
	}
	const knownApps = await resolveAppNames([...referencedAppNames])

	const acknowledgmentsRaw = await getActiveAcknowledgments(appId)
	const acknowledgments: Record<string, { comment: string; acknowledgedBy: string; acknowledgedAt: string }> = {}
	for (const ack of acknowledgmentsRaw) {
		acknowledgments[ack.ruleApplication] = {
			comment: ack.comment,
			acknowledgedBy: ack.acknowledgedBy,
			acknowledgedAt: ack.acknowledgedAt.toISOString(),
		}
	}

	const allOracleInstances = await getOracleInstances()
	const oracleInstances = await getOracleInstancesForApp(appId)

	// Filter Oracle instances by user's Azure AD group membership
	const accessibleInstanceIds = new Set(
		filterInstancesByAccess(allOracleInstances, user?.groups ?? []).map((i) => i.id),
	)
	const filteredOracleInstances = oracleInstances.filter((i) => accessibleInstanceIds.has(i.instanceId))
	const totalOracleInstanceCount = oracleInstances.length

	// Ensure persistence entries exist for configured Oracle instances
	const oraclePersistenceInstanceIds = new Set(
		detail.persistence.filter((p) => p.type === "oracle").map((p) => p.oracleInstanceId ?? p.name),
	)
	const orphanInstances = filteredOracleInstances.filter((inst) => !oraclePersistenceInstanceIds.has(inst.instanceId))

	if (orphanInstances.length > 0) {
		const { ensureOraclePersistenceEntries } = await import("~/db/queries/audit-logging.server")
		const newEntries = await ensureOraclePersistenceEntries(
			appId,
			orphanInstances.map((i) => i.instanceId),
		)
		detail.persistence.push(...newEntries)
	}

	// Fetch full snapshot history for accessible instances only
	const snapshotHistoryPromises = filteredOracleInstances.map(async (inst) => {
		const history = await getSnapshotHistory(appId, inst.instanceId)
		return { instanceId: inst.instanceId, history }
	})
	const instanceSnapshotHistories = await Promise.all(snapshotHistoryPromises)

	// Get Oracle audit summaries — reads from DB cache, fetches on-demand if missing
	const oracleAuditSummaries = await getOracleAuditSummariesForApp(detail.persistence)

	// Get deployment verification data (cached, on-demand fetch if missing)
	const { getDeploymentVerificationForAppWithFetch } = await import("~/db/queries/deployment-audit.server")
	const deploymentVerifications = await getDeploymentVerificationForAppWithFetch(appId)

	// Resolve Azure AD group names from auth integrations and manual groups
	const manualGroups = await getManualGroupsForApp(appId)
	const groupAssessments = await getGroupAssessmentsForApp(appId)
	const naisGroupIds: string[] = []
	for (const auth of detail.authIntegrations) {
		if (auth.groups) {
			const groups = JSON.parse(auth.groups) as string[]
			naisGroupIds.push(...groups)
		}
	}
	const naisGroupIdSet = new Set(naisGroupIds)
	const manualGroupIdSet = new Set(manualGroups.map((g) => g.groupId))

	// Detect "ghost" groups: have assessments but are no longer in Nais or manual
	const ghostGroupIds = groupAssessments
		.filter((a) => !naisGroupIdSet.has(a.groupId) && !manualGroupIdSet.has(a.groupId))
		.map((a) => a.groupId)

	const allGroupIds = [...new Set([...naisGroupIds, ...manualGroups.map((g) => g.groupId), ...ghostGroupIds])]
	const groupNames = await resolveGroupNames(allGroupIds)

	// Build assessment lookup
	const assessmentsByGroupId: Record<string, { criticality: GroupCriticality; updatedBy: string; updatedAt: string }> =
		{}
	for (const a of groupAssessments) {
		assessmentsByGroupId[a.groupId] = {
			criticality: a.criticality as GroupCriticality,
			updatedBy: a.updatedBy,
			updatedAt: a.updatedAt.toISOString(),
		}
	}

	return data({
		...breadcrumbCtx,
		app: detail.app,
		environments: detail.environments,
		persistence: detail.persistence,
		oracleAuditSummaries,
		deploymentVerifications: deploymentVerifications.map((v) => ({
			...v,
			periodFrom: v.periodFrom.toISOString(),
			periodTo: v.periodTo.toISOString(),
			lastDeploymentAt: v.lastDeploymentAt?.toISOString() ?? null,
			fetchedAt: v.fetchedAt.toISOString(),
			lastSyncAttemptedAt: v.lastSyncAttemptedAt?.toISOString() ?? null,
			createdAt: v.createdAt.toISOString(),
			updatedAt: v.updatedAt.toISOString(),
		})),
		authIntegrations: detail.authIntegrations,
		manualGroups: manualGroups.map((g) => ({ ...g, createdAt: g.createdAt.toISOString() })),
		groupNames,
		assessmentsByGroupId,
		naisGroupIds: [...naisGroupIdSet],
		ghostGroupIds,
		accessPolicyRules: detail.accessPolicyRules,
		teams: detail.teams,
		primaryApp: detail.primaryApp,
		linkedApps: detail.linkedApps,
		appElements,
		routineDeadlines,
		completedReviews,
		sectionSlugMap,
		canAdmin: user ? isAdmin(user) : false,
		knownApps,
		acknowledgments,
		compliance: {
			totalControls,
			implemented,
			partial,
			notImplemented,
			notRelevant,
			notAssessed,
			percent: compliancePercent(implemented, partial, totalControls),
			hasScreeningAnswers: assessmentsResult?.hasScreeningAnswers ?? false,
			withRoutine,
			withoutRoutine,
			routineNotRelevant,
			routineCompleted,
			routineOverdue,
			routineNeverReviewed,
		},
		assessments,
		appReports: appReports.map((r) => ({
			id: r.id,
			name: r.name,
			createdAt: r.createdAt.toISOString(),
			createdBy: r.createdBy,
			reportBucketPath: r.reportBucketPath,
		})),
		oracleInstances: filteredOracleInstances.map((inst) => ({
			...inst,
			configuredAt: inst.configuredAt.toISOString(),
			latestSnapshot: inst.latestSnapshot
				? {
						...inst.latestSnapshot,
						fetchedAt: inst.latestSnapshot.fetchedAt.toISOString(),
					}
				: null,
		})),
		totalOracleInstanceCount,
		instanceSnapshotHistories: instanceSnapshotHistories.map(({ instanceId, history }) => ({
			instanceId,
			snapshots: history.map((s) => ({
				id: s.id,
				overallStatus: s.overallStatus,
				collectedAt: s.collectedAt.toISOString(),
				fetchedAt: s.fetchedAt.toISOString(),
				fetchedBy: s.fetchedBy,
			})),
		})),
	})
}

export async function action({ request, params }: ActionFunctionArgs) {
	const appId = params.appId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })

	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)

	const formData = await request.formData()
	const intent = formData.get("intent")

	if (intent === "create-draft") {
		const routineId = formData.get("routineId") as string
		const sectionSlug = formData.get("sectionSlug") as string
		if (!routineId || !sectionSlug) {
			return data({ success: false, message: null, error: "Mangler rutine-ID" })
		}
		const { getRoutine } = await import("~/db/queries/routines.server")
		const routine = await getRoutine(routineId)
		if (!routine) {
			return data({ success: false, message: null, error: "Fant ikke rutine" })
		}
		const now = new Date()
		const title = `${routine.name} — ${now.toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" })}`
		const review = await createReview({
			routineId,
			applicationId: appId,
			title,
			summary: null,
			routineSnapshotPath: null,
			reviewedAt: now,
			createdBy: authedUser.navIdent,
			participants: [],
		})
		return redirect(`/seksjoner/${sectionSlug}/rutiner/${routineId}/gjennomgang/${review.id}`)
	}

	if (intent === "generate-report") {
		const includeReviews = formData.get("includeReviews") === "true"
		const includeAttachments = formData.get("includeAttachments") === "true"
		const includeRoutineDescription = formData.get("includeRoutineDescription") === "true"
		const reviewIdsRaw = formData.get("reviewIds")
		const reviewIds = reviewIdsRaw != null ? String(reviewIdsRaw).split(",").filter(Boolean) : undefined
		try {
			await generateAppComplianceReport({
				applicationId: appId,
				createdBy: authedUser.navIdent,
				includeReviews,
				includeAttachments,
				includeRoutineDescription,
				reviewIds: includeReviews ? reviewIds : undefined,
			})
			return data({ success: true, message: "Rapport generert.", error: null })
		} catch (err) {
			return data({
				success: false,
				message: null,
				error: err instanceof Error ? err.message : "Feil ved generering av rapport.",
			})
		}
	}

	if (intent === "acknowledge-app") {
		const ruleApplication = formData.get("ruleApplication") as string
		const comment = (formData.get("comment") as string)?.trim()
		if (!ruleApplication) throw new Response("Mangler applikasjonsnavn", { status: 400 })
		if (!comment) return data({ success: false, message: null, error: "Kommentar er obligatorisk" })
		await acknowledgeUnknownApp(appId, ruleApplication, comment, authedUser.navIdent)
		return data({ success: true, message: `${ruleApplication} er kvittert ut.`, error: null })
	}

	if (intent === "revoke-acknowledgment") {
		const ruleApplication = formData.get("ruleApplication") as string
		if (!ruleApplication) throw new Response("Mangler applikasjonsnavn", { status: 400 })
		await revokeAcknowledgment(appId, ruleApplication, authedUser.navIdent)
		return data({ success: true, message: `Kvittering for ${ruleApplication} er trukket tilbake.`, error: null })
	}

	if (intent === "add-persistence") {
		const type = formData.get("persistenceType") as string
		const name = (formData.get("persistenceName") as string)?.trim()
		const classification = (formData.get("dataClassification") as string) || null

		if (!type || !name) {
			return data({ success: false, message: null, error: "Type og navn er påkrevd" })
		}
		if (!persistenceTypeEnum.includes(type as (typeof persistenceTypeEnum)[number])) {
			return data({ success: false, message: null, error: "Ugyldig type" })
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
		return data({ success: true, message: `Database "${name}" lagt til.`, error: null })
	}

	if (intent === "update-classification") {
		const persistenceId = formData.get("persistenceId") as string
		const classification = (formData.get("dataClassification") as string) || null
		if (!persistenceId) throw new Response("Mangler persistens-ID", { status: 400 })

		const validClassification =
			classification && ["not_critical", "critical", "financial_regulation"].includes(classification)
				? (classification as DataClassification)
				: null

		await updatePersistenceClassification(persistenceId, validClassification, authedUser.navIdent)
		return data({ success: true, message: "Klassifisering oppdatert.", error: null })
	}

	if (intent === "delete-persistence") {
		const persistenceId = formData.get("persistenceId") as string
		if (!persistenceId) throw new Response("Mangler persistens-ID", { status: 400 })
		await deleteManualPersistence(persistenceId, authedUser.navIdent)
		return data({ success: true, message: "Database slettet.", error: null })
	}

	if (intent === "add-manual-group") {
		const groupId = (formData.get("groupId") as string)?.trim()
		const groupName = (formData.get("groupName") as string)?.trim() || null
		if (!groupId) return data({ success: false, message: null, error: "Mangler gruppe-ID" })
		const result = await addManualGroup(appId, groupId, groupName, authedUser.navIdent)
		if (!result) return data({ success: false, message: null, error: "Gruppen finnes allerede" })
		return data({ success: true, message: `Gruppe "${groupName || groupId}" lagt til.`, error: null })
	}

	if (intent === "remove-manual-group") {
		const manualGroupId = formData.get("manualGroupId") as string
		if (!manualGroupId) throw new Response("Mangler gruppe-ID", { status: 400 })
		await removeManualGroup(manualGroupId, appId, authedUser.navIdent)
		return data({ success: true, message: "Gruppe fjernet.", error: null })
	}

	if (intent === "set-group-criticality") {
		const groupId = (formData.get("groupId") as string)?.trim()
		const criticality = formData.get("criticality") as string
		if (!groupId) return data({ success: false, message: null, error: "Mangler gruppe-ID" })
		if (!groupCriticalityEnum.includes(criticality as GroupCriticality)) {
			return data({ success: false, message: null, error: "Ugyldig kritikalitet" })
		}
		await upsertGroupCriticality(appId, groupId, criticality as GroupCriticality, authedUser.navIdent)
		return data({ success: true, message: "Kritikalitet oppdatert.", error: null })
	}

	return data({ success: false, message: null, error: "Ukjent handling" })
}

export default function ApplikasjonDetalj() {
	const {
		app,
		environments,
		persistence,
		oracleAuditSummaries,
		deploymentVerifications,
		authIntegrations,
		manualGroups,
		groupNames,
		assessmentsByGroupId,
		naisGroupIds,
		ghostGroupIds,
		accessPolicyRules,
		teams,
		primaryApp,
		linkedApps,
		appElements,
		routineDeadlines,
		completedReviews,
		sectionSlugMap,
		canAdmin,
		knownApps,
		acknowledgments,
		compliance,
		assessments,
		appReports,
		oracleInstances,
		totalOracleInstanceCount,
		instanceSnapshotHistories,
	} = useLoaderData<typeof loader>()

	const [searchParams, setSearchParams] = useSearchParams()
	const activeTab = searchParams.get("fane") ?? "kontroller"
	const submit = useSubmit()
	const appBase = useAppBasePath()

	const [ackTarget, setAckTarget] = useState<string | null>(null)
	const [ackComment, setAckComment] = useState("")
	const ackModalRef = useRef<HTMLDialogElement>(null)

	// Controls tab state
	const [controlSort, setControlSort] = useState<{ orderBy: string; direction: "ascending" | "descending" }>({
		orderBy: "controlId",
		direction: "ascending",
	})
	const [controlStatusFilter, setControlStatusFilter] = useState<string[]>([])
	const [controlSearch, setControlSearch] = useState("")
	const [controlGroupBy, setControlGroupBy] = useState<string>("none")

	const statusLabel = (s: string | null): string => {
		if (!s) return "Ikke vurdert"
		const labels: Record<string, string> = {
			implemented: "Implementert",
			partially_implemented: "Delvis implementert",
			not_implemented: "Ikke implementert",
			not_relevant: "Ikke relevant",
		}
		return labels[s] ?? s
	}

	const filteredAssessments = assessments.filter((a) => {
		if (controlStatusFilter.length > 0) {
			const effectiveLabel = a.effectiveStatus ?? "not_assessed"
			if (!controlStatusFilter.includes(effectiveLabel)) return false
		}
		if (controlSearch) {
			const q = controlSearch.toLowerCase()
			if (
				!a.controlId.toLowerCase().includes(q) &&
				!a.controlName.toLowerCase().includes(q) &&
				!(a.domainName ?? "").toLowerCase().includes(q) &&
				!(a.technologyElementName ?? "").toLowerCase().includes(q)
			)
				return false
		}
		return true
	})

	const sortedAssessments = [...filteredAssessments].sort((a, b) => {
		const dir = controlSort.direction === "ascending" ? 1 : -1
		const orderBy = controlSort.orderBy
		let aVal: string
		let bVal: string
		if (orderBy === "domainName") {
			aVal = a.domainName ?? ""
			bVal = b.domainName ?? ""
		} else if (orderBy === "controlId") {
			aVal = a.controlId
			bVal = b.controlId
		} else if (orderBy === "controlName") {
			aVal = a.controlName
			bVal = b.controlName
		} else if (orderBy === "technologyElementName") {
			aVal = a.technologyElementName ?? ""
			bVal = b.technologyElementName ?? ""
		} else if (orderBy === "status") {
			aVal = statusLabel(a.effectiveStatus)
			bVal = statusLabel(b.effectiveStatus)
		} else if (orderBy === "establishment") {
			aVal = a.establishment
			bVal = b.establishment
		} else if (orderBy === "routineCompliance") {
			aVal = a.routineCompliance
			bVal = b.routineCompliance
		} else {
			return 0
		}
		return aVal.localeCompare(bVal, "nb") * dir
	})

	const groupedAssessments: Array<{ groupLabel: string; items: typeof sortedAssessments }> = (() => {
		if (controlGroupBy === "none") return [{ groupLabel: "", items: sortedAssessments }]
		const groups = new Map<string, typeof sortedAssessments>()
		for (const a of sortedAssessments) {
			let key: string
			if (controlGroupBy === "domainName") key = a.domainName || "Uten domene"
			else if (controlGroupBy === "controlId") key = a.controlId
			else if (controlGroupBy === "controlName") key = a.controlName
			else if (controlGroupBy === "technologyElementName") key = a.technologyElementName || "Ingen"
			else if (controlGroupBy === "status") key = statusLabel(a.effectiveStatus)
			else if (controlGroupBy === "establishment")
				key = establishmentLabels[a.establishment as RoutineEstablishment] ?? a.establishment
			else if (controlGroupBy === "routineCompliance")
				key = complianceLabels[a.routineCompliance as RoutineCompliance] ?? a.routineCompliance
			else key = ""
			const list = groups.get(key) ?? []
			list.push(a)
			groups.set(key, list)
		}
		return [...groups.entries()]
			.sort(([a], [b]) => a.localeCompare(b, "nb"))
			.map(([groupLabel, items]) => ({ groupLabel, items }))
	})()

	const handleControlSort = (sortKey: string) => {
		setControlSort((prev) =>
			prev.orderBy === sortKey
				? { orderBy: sortKey, direction: prev.direction === "ascending" ? "descending" : "ascending" }
				: { orderBy: sortKey, direction: "ascending" },
		)
	}

	const isOnPrem = environments.some((e) => e.cluster?.includes("-fss"))

	const gitHubUrl = environments.find((e) => e.gitRepository)?.gitRepository ?? `https://github.com/navikt/${app.name}`

	return (
		<VStack gap="space-24">
			<div>
				<HStack justify="space-between" align="center">
					<Heading size="xlarge" level="2">
						{app.name}
					</Heading>
					{canAdmin && (
						<Button as={Link} to={`${appBase}/rediger`} variant="tertiary" size="small">
							Administrer
						</Button>
					)}
				</HStack>
				{app.description && <BodyLong>{app.description}</BodyLong>}
				<HStack gap="space-4" align="center" style={{ marginTop: "var(--ax-space-2)" }}>
					<AkselLink href={gitHubUrl} target="_blank" rel="noopener noreferrer">
						GitHub <ExternalLinkIcon aria-hidden />
					</AkselLink>
				</HStack>
			</div>

			{/* Primary app notice */}
			{primaryApp && (
				<Alert variant="info" size="small">
					Denne applikasjonen er lenket til primærapplikasjonen{" "}
					<Link to={`/applikasjoner/${primaryApp.id}/detaljer`}>{primaryApp.name}</Link>. Compliance-vurderinger arves
					fra primærapplikasjonen.
				</Alert>
			)}

			{/* Compliance summary */}
			<Box padding="space-16" borderRadius="8" background="sunken">
				<VStack gap="space-12">
					<HStack gap="space-16" wrap justify="space-between" align="center">
						<HStack gap="space-16" wrap align="center">
							<Tag
								variant={compliance.percent >= 80 ? "success" : compliance.percent >= 50 ? "warning" : "error"}
								size="medium"
							>
								{compliance.percent} % compliance
							</Tag>
							<HStack gap="space-12" wrap>
								<VStack align="center">
									<BodyShort size="small" weight="semibold">
										{compliance.implemented}
									</BodyShort>
									<Detail textColor="subtle">Implementert</Detail>
								</VStack>
								<VStack align="center">
									<BodyShort size="small" weight="semibold">
										{compliance.partial}
									</BodyShort>
									<Detail textColor="subtle">Delvis</Detail>
								</VStack>
								<VStack align="center">
									<BodyShort size="small" weight="semibold">
										{compliance.notImplemented}
									</BodyShort>
									<Detail textColor="subtle">Ikke impl.</Detail>
								</VStack>
								<VStack align="center">
									<BodyShort size="small" weight="semibold">
										{compliance.notRelevant}
									</BodyShort>
									<Detail textColor="subtle">Ikke relevant</Detail>
								</VStack>
								<VStack align="center">
									<BodyShort size="small" weight="semibold">
										{compliance.notAssessed}
									</BodyShort>
									<Detail textColor="subtle">Ikke vurdert</Detail>
								</VStack>
							</HStack>
						</HStack>
						<Link to={`${appBase}/compliance`}>Gå til compliance-vurdering</Link>
					</HStack>

					{/* Two-dimensional breakdown */}
					<HStack gap="space-24" wrap>
						<VStack gap="space-4">
							<Detail weight="semibold" textColor="subtle">
								Rutineetablering
							</Detail>
							<HStack gap="space-8" wrap>
								<Tag variant="success" size="xsmall">
									{compliance.withRoutine} etablert
								</Tag>
								<Tag variant="error" size="xsmall">
									{compliance.withoutRoutine} mangler
								</Tag>
								{compliance.routineNotRelevant > 0 && (
									<Tag variant="neutral" size="xsmall">
										{compliance.routineNotRelevant} ikke relevant
									</Tag>
								)}
							</HStack>
						</VStack>
						{compliance.withRoutine > 0 && (
							<VStack gap="space-4">
								<Detail weight="semibold" textColor="subtle">
									Rutineetterlevelse
								</Detail>
								<HStack gap="space-8" wrap>
									<Tag variant="success" size="xsmall">
										{compliance.routineCompleted} gjennomført
									</Tag>
									{compliance.routineOverdue > 0 && (
										<Tag variant="warning" size="xsmall">
											{compliance.routineOverdue} forfalt
										</Tag>
									)}
									{compliance.routineNeverReviewed > 0 && (
										<Tag variant="error" size="xsmall">
											{compliance.routineNeverReviewed} ikke gjennomført
										</Tag>
									)}
								</HStack>
							</VStack>
						)}
					</HStack>
				</VStack>
			</Box>

			{/* Teams and tech elements */}
			<HStack gap="space-16" wrap>
				{teams.length > 0 && (
					<HStack gap="space-4" wrap align="center">
						<Detail textColor="subtle">Team:</Detail>
						{teams.map((t) => (
							<Tag key={t.teamId} variant="info" size="xsmall">
								{t.teamName}
							</Tag>
						))}
					</HStack>
				)}
				{appElements.length > 0 && (
					<HStack gap="space-4" wrap align="center">
						<Detail textColor="subtle">Teknologi:</Detail>
						{appElements.map((el) => (
							<Tag
								key={el.id}
								variant={
									el.rejectedAt ? "neutral" : el.confirmedAt ? "success" : el.source === "auto" ? "warning" : "alt1"
								}
								size="xsmall"
							>
								{el.name}
							</Tag>
						))}
					</HStack>
				)}
			</HStack>

			<Tabs value={activeTab} onChange={(tab) => setSearchParams({ fane: tab }, { replace: true })}>
				<Tabs.List>
					<Tabs.Tab value="kontroller" label="Kontroller" />
					<Tabs.Tab value="autentisering" label="Autentisering" />
					<Tabs.Tab value="autoriserte-applikasjoner" label="Autoriserte applikasjoner" />
					<Tabs.Tab value="miljoer" label="Miljøer" />
					{environments.length > 0 && <Tabs.Tab value="deployments" label="Deployments" />}
					<Tabs.Tab value="persistering" label="Persistering" />
					{oracleInstances.length > 0 && <Tabs.Tab value="revisjonsbevis" label="Revisjonsbevis" />}
					<Tabs.Tab value="rutiner" label="Rutiner" />
					{linkedApps.length > 0 && <Tabs.Tab value="lenkede-applikasjoner" label="Lenkede applikasjoner" />}
					<Tabs.Tab value="rapporter" label="Rapporter" />
				</Tabs.List>

				{/* Kontroller */}
				<Tabs.Panel value="kontroller" style={{ paddingTop: "var(--ax-space-6)" }}>
					<VStack gap="space-6">
						<HStack gap="space-4" wrap align="end">
							<div style={{ flex: "1 1 200px", maxWidth: "300px" }}>
								<Search
									label="Søk i kontroller"
									size="small"
									value={controlSearch}
									onChange={setControlSearch}
									onClear={() => setControlSearch("")}
								/>
							</div>
							<div style={{ minWidth: "180px" }}>
								<Select
									label="Grupper etter"
									size="small"
									value={controlGroupBy}
									onChange={(e) => setControlGroupBy(e.target.value)}
								>
									<option value="none">Ingen gruppering</option>
									<option value="domainName">Domene</option>
									<option value="controlId">Kontroll-ID</option>
									<option value="controlName">Navn</option>
									<option value="technologyElementName">Teknologielement</option>
									<option value="status">Status</option>
									<option value="establishment">Rutineetablering</option>
									<option value="routineCompliance">Etterlevelse</option>
								</Select>
							</div>
						</HStack>

						<CheckboxGroup
							legend="Filtrer på status"
							size="small"
							value={controlStatusFilter}
							onChange={setControlStatusFilter}
							hideLegend
						>
							<HStack gap="space-4" wrap>
								<Checkbox value="implemented">Implementert</Checkbox>
								<Checkbox value="partially_implemented">Delvis</Checkbox>
								<Checkbox value="not_implemented">Ikke impl.</Checkbox>
								<Checkbox value="not_relevant">Ikke relevant</Checkbox>
								<Checkbox value="not_assessed">Ikke vurdert</Checkbox>
							</HStack>
						</CheckboxGroup>

						<BodyShort size="small" textColor="subtle">
							Viser {filteredAssessments.length} av {assessments.length} kontroller
							{compliance.hasScreeningAnswers
								? " (basert på screening-svar)"
								: " (alle kontroller — ingen screening-svar)"}
						</BodyShort>

						{groupedAssessments.map((group) => (
							<VStack key={group.groupLabel || "__all"} gap="space-4">
								{group.groupLabel && (
									<Heading size="small" level="4">
										{group.groupLabel} ({group.items.length})
									</Heading>
								)}
								{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
								<section className="table-scroll" tabIndex={0} aria-label="Kontrollstatus">
									<Table
										size="small"
										sort={controlSort}
										onSortChange={(sortKey) => handleControlSort(sortKey ?? "controlId")}
									>
										<Table.Header>
											<Table.Row>
												<Table.ColumnHeader scope="col" sortKey="domainName" sortable>
													Domene
												</Table.ColumnHeader>
												<Table.ColumnHeader scope="col" sortKey="controlId" sortable>
													Kontroll-ID
												</Table.ColumnHeader>
												<Table.ColumnHeader scope="col" sortKey="controlName" sortable>
													Navn
												</Table.ColumnHeader>
												<Table.ColumnHeader scope="col" sortKey="technologyElementName" sortable>
													Teknologielement
												</Table.ColumnHeader>
												<Table.ColumnHeader scope="col" sortKey="status" sortable>
													Status
												</Table.ColumnHeader>
												<Table.ColumnHeader scope="col" sortKey="establishment" sortable>
													Rutine
												</Table.ColumnHeader>
												<Table.ColumnHeader scope="col" sortKey="routineCompliance" sortable>
													Etterlevelse
												</Table.ColumnHeader>
											</Table.Row>
										</Table.Header>
										<Table.Body>
											{group.items.map((a) => (
												<Table.Row key={`${a.controlUuid}:${a.technologyElementId ?? "null"}`}>
													<Table.DataCell>{a.domainName}</Table.DataCell>
													<Table.DataCell>{a.controlId}</Table.DataCell>
													<Table.DataCell>{a.controlName}</Table.DataCell>
													<Table.DataCell>
														{a.technologyElementName ? (
															<Tag variant="info" size="xsmall">
																{a.technologyElementName}
															</Tag>
														) : null}
													</Table.DataCell>
													<Table.DataCell>
														{a.effectiveStatus ? (
															<HStack gap="space-2" align="center">
																<ComplianceStatusBadge status={a.effectiveStatus as ComplianceStatus} />
																{!a.status && a.autoStatus && (
																	<Tag variant="alt1" size="xsmall">
																		Beregnet
																	</Tag>
																)}
															</HStack>
														) : (
															<Tag variant="neutral" size="xsmall">
																Ikke vurdert
															</Tag>
														)}
													</Table.DataCell>
													<Table.DataCell>
														<Tag
															variant={establishmentVariants[a.establishment as RoutineEstablishment] ?? "neutral"}
															size="xsmall"
														>
															{establishmentLabels[a.establishment as RoutineEstablishment] ?? a.establishment}
														</Tag>
													</Table.DataCell>
													<Table.DataCell>
														{a.routineCompliance !== "not_applicable" ? (
															<Tag
																variant={complianceVariants[a.routineCompliance as RoutineCompliance] ?? "neutral"}
																size="xsmall"
															>
																{complianceLabels[a.routineCompliance as RoutineCompliance] ?? a.routineCompliance}
															</Tag>
														) : null}
													</Table.DataCell>
												</Table.Row>
											))}
										</Table.Body>
									</Table>
								</section>
							</VStack>
						))}
					</VStack>
				</Tabs.Panel>

				{/* Autentisering */}
				<Tabs.Panel value="autentisering" style={{ paddingTop: "var(--ax-space-6)" }}>
					{authIntegrations.length > 0 ? (
						<VStack gap="space-4">
							<Table size="small">
								<Table.Header>
									<Table.Row>
										<Table.HeaderCell scope="col">Integrasjon</Table.HeaderCell>
										<Table.HeaderCell scope="col">Login proxy</Table.HeaderCell>
										<Table.HeaderCell scope="col">Brukertilgang</Table.HeaderCell>
										<Table.HeaderCell scope="col">Applikasjonstilgang</Table.HeaderCell>
										<Table.HeaderCell scope="col">Claims</Table.HeaderCell>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{authIntegrations.map((auth) => {
										const claimsExtra = auth.claimsExtra ? (JSON.parse(auth.claimsExtra) as string[]) : null
										const inboundRules = auth.inboundRules
											? (JSON.parse(auth.inboundRules) as Array<{
													application: string
													namespace?: string
													cluster?: string
												}>)
											: null
										const supportsProxy = auth.type === "entra_id" || auth.type === "id_porten"
										return (
											<Table.Row key={auth.id}>
												<Table.DataCell>{authLabels[auth.type] ?? auth.type}</Table.DataCell>
												<Table.DataCell>
													{supportsProxy ? (
														isOnPrem ? (
															<Tag variant="neutral" size="xsmall">
																Ikke tilgjengelig (on-prem)
															</Tag>
														) : auth.sidecarEnabled ? (
															<Tag variant="success" size="xsmall">
																Aktivert
															</Tag>
														) : auth.sidecarEnabled === false ? (
															<Tag variant="neutral" size="xsmall">
																Ikke aktivert
															</Tag>
														) : (
															<BodyShort size="small" textColor="subtle">
																Ukjent
															</BodyShort>
														)
													) : (
														<BodyShort size="small" textColor="subtle">
															—
														</BodyShort>
													)}
												</Table.DataCell>
												<Table.DataCell>
													{auth.type === "entra_id" ? (
														auth.allowAllUsers ? (
															<Tag variant="warning" size="xsmall">
																Alle brukere
															</Tag>
														) : auth.groups ? (
															<Tag variant="info" size="xsmall">
																Gruppebasert
															</Tag>
														) : (
															<Tag variant="neutral" size="xsmall">
																Ikke konfigurert
															</Tag>
														)
													) : auth.type === "id_porten" ? (
														<Tag variant="info" size="xsmall">
															Borgere (ID-porten)
														</Tag>
													) : auth.type === "token_x" ? (
														<Tag variant="info" size="xsmall">
															Via TokenX
														</Tag>
													) : (
														<BodyShort size="small" textColor="subtle">
															—
														</BodyShort>
													)}
												</Table.DataCell>
												<Table.DataCell>
													{auth.type === "entra_id" || auth.type === "maskinporten" ? (
														inboundRules && inboundRules.length > 0 ? (
															<Tag variant="info" size="xsmall">
																{inboundRules.length} {inboundRules.length === 1 ? "applikasjon" : "applikasjoner"}
															</Tag>
														) : (
															<Tag variant="neutral" size="xsmall">
																Ikke konfigurert
															</Tag>
														)
													) : (
														<BodyShort size="small" textColor="subtle">
															—
														</BodyShort>
													)}
												</Table.DataCell>
												<Table.DataCell>
													{claimsExtra && claimsExtra.length > 0 ? (
														<HStack gap="space-1" wrap>
															{claimsExtra.map((claim) => (
																<Tag key={claim} variant="neutral" size="xsmall">
																	{claim}
																</Tag>
															))}
														</HStack>
													) : (
														<BodyShort size="small" textColor="subtle">
															—
														</BodyShort>
													)}
												</Table.DataCell>
											</Table.Row>
										)
									})}
								</Table.Body>
							</Table>

							{/* Entra ID groups – unified view with criticality */}
							<GroupsSection
								naisGroupIds={naisGroupIds}
								manualGroups={manualGroups}
								ghostGroupIds={ghostGroupIds}
								groupNames={groupNames}
								assessmentsByGroupId={assessmentsByGroupId}
								authIntegrations={authIntegrations}
								canAdmin={canAdmin}
							/>
						</VStack>
					) : (
						<VStack gap="space-4">
							<BodyLong>Ingen autentiseringsintegrasjoner funnet.</BodyLong>
							<GroupsSection
								naisGroupIds={naisGroupIds}
								manualGroups={manualGroups}
								ghostGroupIds={ghostGroupIds}
								groupNames={groupNames}
								assessmentsByGroupId={assessmentsByGroupId}
								authIntegrations={authIntegrations}
								canAdmin={canAdmin}
							/>
						</VStack>
					)}
				</Tabs.Panel>

				{/* Autoriserte applikasjoner */}
				<Tabs.Panel value="autoriserte-applikasjoner" style={{ paddingTop: "var(--ax-space-6)" }}>
					<AuthorizedAppsPanel
						accessPolicyRules={accessPolicyRules}
						knownApps={knownApps}
						acknowledgments={acknowledgments}
						submit={submit}
						setAckTarget={setAckTarget}
						setAckComment={setAckComment}
						ackModalRef={ackModalRef}
					/>

					<Modal ref={ackModalRef} header={{ heading: `Kvitter ut ${ackTarget}` }} onClose={() => setAckTarget(null)}>
						<Modal.Body>
							<Textarea
								label="Kommentar (obligatorisk)"
								description="Beskriv hvorfor denne applikasjonen er reell selv om den er ukjent i KISS"
								value={ackComment}
								onChange={(e) => setAckComment(e.target.value)}
								minRows={3}
							/>
						</Modal.Body>
						<Modal.Footer>
							<Button
								onClick={() => {
									if (!ackTarget || !ackComment.trim()) return
									submit(
										{ intent: "acknowledge-app", ruleApplication: ackTarget, comment: ackComment },
										{ method: "POST" },
									)
									ackModalRef.current?.close()
									setAckTarget(null)
									setAckComment("")
								}}
								disabled={!ackComment.trim()}
							>
								Bekreft
							</Button>
							<Button
								variant="secondary"
								onClick={() => {
									ackModalRef.current?.close()
									setAckTarget(null)
									setAckComment("")
								}}
							>
								Avbryt
							</Button>
						</Modal.Footer>
					</Modal>
				</Tabs.Panel>

				{/* Miljøer */}
				<Tabs.Panel value="miljoer" style={{ paddingTop: "var(--ax-space-6)" }}>
					{environments.length > 0 ? (
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Klynge</Table.HeaderCell>
									<Table.HeaderCell scope="col">Namespace</Table.HeaderCell>
									<Table.HeaderCell scope="col">Nais-team</Table.HeaderCell>
									<Table.HeaderCell scope="col">Image</Table.HeaderCell>
									<Table.HeaderCell scope="col">Oppdaget</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{environments.map((env) => (
									<Table.Row key={env.id}>
										<Table.DataCell>
											<Tag variant="neutral" size="xsmall">
												{env.cluster}
											</Tag>
										</Table.DataCell>
										<Table.DataCell>{env.namespace}</Table.DataCell>
										<Table.DataCell>{env.naisTeamSlug ?? "–"}</Table.DataCell>
										<Table.DataCell
											style={{
												wordBreak: "break-all",
												maxWidth: "300px",
												fontSize: "var(--ax-font-size-small)",
											}}
										>
											{env.imageName ?? "–"}
										</Table.DataCell>
										<Table.DataCell>{new Date(env.discoveredAt).toLocaleDateString("nb-NO")}</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					) : (
						<BodyLong>Ingen kjente miljøer.</BodyLong>
					)}
				</Tabs.Panel>

				{/* Deployments */}
				{environments.length > 0 && (
					<Tabs.Panel value="deployments" style={{ paddingTop: "var(--ax-space-6)" }}>
						<DeploymentVerificationPanel verifications={deploymentVerifications} />
					</Tabs.Panel>
				)}

				{/* Persistering */}
				<Tabs.Panel value="persistering" style={{ paddingTop: "var(--ax-space-6)" }}>
					<VStack gap="space-8">
						<AddPersistenceForm />

						{persistence.length > 0 ? (
							// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1
							<section className="table-scroll" tabIndex={0} aria-label="Databaser og lagring">
								<Table size="small">
									<Table.Header>
										<Table.Row>
											<Table.HeaderCell scope="col">Type</Table.HeaderCell>
											<Table.HeaderCell scope="col">Navn</Table.HeaderCell>
											<Table.HeaderCell scope="col">Klassifisering</Table.HeaderCell>
											<Table.HeaderCell scope="col">Versjon</Table.HeaderCell>
											<Table.HeaderCell scope="col">Tier</Table.HeaderCell>
											<Table.HeaderCell scope="col">HA</Table.HeaderCell>
											<Table.HeaderCell scope="col">Audit logging</Table.HeaderCell>
											<Table.HeaderCell scope="col" />
										</Table.Row>
									</Table.Header>
									<Table.Body>
										{persistence.map((p) => (
											<PersistenceRow key={p.id} p={p} oracleAuditSummaries={oracleAuditSummaries} />
										))}
									</Table.Body>
								</Table>
							</section>
						) : (
							<BodyLong>Ingen kjent persistens. Legg til en database manuelt ovenfor.</BodyLong>
						)}
					</VStack>
				</Tabs.Panel>

				{/* Revisjonsbevis */}
				{oracleInstances.length > 0 && (
					<Tabs.Panel value="revisjonsbevis" style={{ paddingTop: "var(--ax-space-6)" }}>
						<VStack gap="space-12">
							{totalOracleInstanceCount > oracleInstances.length && (
								<Alert variant="info" size="small">
									Viser {oracleInstances.length} av {totalOracleInstanceCount} databaseinstanser. Du har ikke tilgang
									til alle instanser.
								</Alert>
							)}
							{instanceSnapshotHistories.map(({ instanceId, snapshots }) => (
								<Box key={instanceId} borderWidth="1" borderColor="neutral-subtle" padding="space-8" borderRadius="8">
									<VStack gap="space-6">
										<Heading size="small" level="3">
											{instanceId.toUpperCase()}
										</Heading>
										{snapshots.length > 0 ? (
											// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1
											<section className="table-scroll" tabIndex={0} aria-label={`Revisjonsbevis for ${instanceId}`}>
												<Table size="small">
													<Table.Header>
														<Table.Row>
															<Table.HeaderCell scope="col">Status</Table.HeaderCell>
															<Table.HeaderCell scope="col">Innsamlet</Table.HeaderCell>
															<Table.HeaderCell scope="col">Hentet</Table.HeaderCell>
															<Table.HeaderCell scope="col">Hentet av</Table.HeaderCell>
															<Table.HeaderCell scope="col" />
														</Table.Row>
													</Table.Header>
													<Table.Body>
														{snapshots.map((s) => (
															<Table.Row key={s.id}>
																<Table.DataCell>
																	<Tag
																		variant={
																			s.overallStatus === "OK"
																				? "success"
																				: s.overallStatus === "PARTIAL"
																					? "warning"
																					: "error"
																		}
																		size="xsmall"
																	>
																		{s.overallStatus}
																	</Tag>
																</Table.DataCell>
																<Table.DataCell>{new Date(s.collectedAt).toLocaleString("nb-NO")}</Table.DataCell>
																<Table.DataCell>{new Date(s.fetchedAt).toLocaleString("nb-NO")}</Table.DataCell>
																<Table.DataCell>{s.fetchedBy}</Table.DataCell>
																<Table.DataCell>
																	<a href={`/api/revisjonsbevis/${s.id}/excel`}>
																		<Button
																			variant="tertiary"
																			size="xsmall"
																			as="span"
																			icon={<DownloadIcon aria-hidden />}
																		>
																			Excel
																		</Button>
																	</a>
																</Table.DataCell>
															</Table.Row>
														))}
													</Table.Body>
												</Table>
											</section>
										) : (
											<BodyShort>Ingen revisjonsbevis er hentet ennå.</BodyShort>
										)}
									</VStack>
								</Box>
							))}
						</VStack>
					</Tabs.Panel>
				)}

				{/* Rutiner */}
				<Tabs.Panel value="rutiner" style={{ paddingTop: "var(--ax-space-6)" }}>
					<VStack gap="space-8">
						{/* Manglende rutiner */}
						<Heading size="medium" level="3">
							Rutinestatus
						</Heading>
						{routineDeadlines.length === 0 ? (
							<BodyShort>Ingen rutiner er knyttet til denne applikasjonen.</BodyShort>
						) : (
							<section className="table-scroll" aria-label="Rutinestatus">
								<Table size="small">
									<Table.Header>
										<Table.Row>
											<Table.HeaderCell>Rutine</Table.HeaderCell>
											<Table.HeaderCell>Kobling</Table.HeaderCell>
											<Table.HeaderCell>Teknologielement</Table.HeaderCell>
											<Table.HeaderCell>Frekvens</Table.HeaderCell>
											<Table.HeaderCell>Siste gjennomgang</Table.HeaderCell>
											<Table.HeaderCell>Frist</Table.HeaderCell>
											<Table.HeaderCell>Status</Table.HeaderCell>
											<Table.HeaderCell />
										</Table.Row>
									</Table.Header>
									<Table.Body>
										{routineDeadlines.map((dl) => (
											<Table.Row key={dl.routine?.id ?? "unknown"}>
												<Table.DataCell>
													{dl.routine?.sectionId && sectionSlugMap[dl.routine.sectionId] ? (
														<Link to={`/seksjoner/${sectionSlugMap[dl.routine.sectionId]}/rutiner/${dl.routine.id}`}>
															{dl.routine?.name ?? "—"}
														</Link>
													) : (
														(dl.routine?.name ?? "—")
													)}
												</Table.DataCell>
												<Table.DataCell>
													{dl.matchSource === "persistence" ? (
														<HStack gap="space-4" wrap>
															{(dl.matchedPersistenceLinks ?? []).map((pl) => (
																<HStack key={`${pl.persistenceType}-${pl.dataClassification}`} gap="space-2" wrap>
																	{pl.persistenceType && (
																		<Tag variant="info" size="xsmall">
																			{persistenceLabels[pl.persistenceType] ?? pl.persistenceType}
																		</Tag>
																	)}
																	{pl.dataClassification && (
																		<Tag variant="warning" size="xsmall">
																			{dataClassificationLabels[pl.dataClassification as DataClassification] ??
																				pl.dataClassification}
																		</Tag>
																	)}
																</HStack>
															))}
														</HStack>
													) : dl.matchSource === "screening_selection" ? (
														<Tag variant="alt1" size="xsmall">
															Valgt via spørsmål
														</Tag>
													) : dl.matchSource === "section" ? (
														<Tag variant="alt3" size="xsmall">
															Gjelder alle i seksjonen
														</Tag>
													) : dl.matchSource === "ruleset" ? (
														<Tag variant="alt2" size="xsmall">
															Regelsett
														</Tag>
													) : (
														<Tag variant="neutral" size="xsmall">
															Screening
														</Tag>
													)}
												</Table.DataCell>
												<Table.DataCell>
													{dl.routine?.technologyElements && dl.routine.technologyElements.length > 0 && (
														<HStack gap="space-2" wrap>
															{dl.routine.technologyElements.map((te) => (
																<Tag key={te.id} variant="info" size="xsmall">
																	{te.name}
																</Tag>
															))}
														</HStack>
													)}
												</Table.DataCell>
												<Table.DataCell>{getFrequencyLabel(dl.routine?.frequency)}</Table.DataCell>
												<Table.DataCell>
													{dl.lastReviewDate ? new Date(dl.lastReviewDate).toLocaleDateString("nb-NO") : "Aldri"}
												</Table.DataCell>
												<Table.DataCell>{new Date(dl.deadline).toLocaleDateString("nb-NO")}</Table.DataCell>
												<Table.DataCell>
													{dl.overdue ? (
														<Tag variant="error" size="small">
															Over frist
														</Tag>
													) : dl.lastReviewDate ? (
														<Tag variant="success" size="small">
															OK
														</Tag>
													) : (
														<Tag variant="warning" size="small">
															Ikke gjennomført
														</Tag>
													)}
												</Table.DataCell>
												<Table.DataCell>
													{dl.routine?.sectionId && sectionSlugMap[dl.routine.sectionId] && (
														<form method="post" style={{ display: "inline" }}>
															<input type="hidden" name="intent" value="create-draft" />
															<input type="hidden" name="routineId" value={dl.routine.id} />
															<input type="hidden" name="sectionSlug" value={sectionSlugMap[dl.routine.sectionId]} />
															<Button type="submit" variant="tertiary" size="xsmall">
																Ny gjennomgang
															</Button>
														</form>
													)}
												</Table.DataCell>
											</Table.Row>
										))}
									</Table.Body>
								</Table>
							</section>
						)}

						{/* Gjennomførte rutinegjennomganger */}
						{completedReviews.length > 0 && (
							<>
								<Heading size="medium" level="3">
									Gjennomførte gjennomganger
								</Heading>
								<Table size="small">
									<Table.Header>
										<Table.Row>
											<Table.HeaderCell>Dato</Table.HeaderCell>
											<Table.HeaderCell>Rutine</Table.HeaderCell>
											<Table.HeaderCell>Tittel</Table.HeaderCell>
											<Table.HeaderCell>Status</Table.HeaderCell>
											<Table.HeaderCell>Opprettet av</Table.HeaderCell>
											<Table.HeaderCell>Deltakere</Table.HeaderCell>
										</Table.Row>
									</Table.Header>
									<Table.Body>
										{completedReviews.map((review) => {
											const confirmed = review.participants.filter((p) => p.confirmedAt).length
											const slug = review.sectionId ? sectionSlugMap[review.sectionId] : null
											return (
												<Table.Row key={review.id}>
													<Table.DataCell>{new Date(review.reviewedAt).toLocaleDateString("nb-NO")}</Table.DataCell>
													<Table.DataCell>{review.routineName}</Table.DataCell>
													<Table.DataCell>
														{slug ? (
															<Link to={`/seksjoner/${slug}/rutiner/${review.routineId}/gjennomgang/${review.id}`}>
																{review.title}
															</Link>
														) : (
															review.title
														)}
													</Table.DataCell>
													<Table.DataCell>
														{review.status === "completed" ? (
															<Tag variant="success" size="xsmall">
																Fullført
															</Tag>
														) : (
															<Tag variant="warning" size="xsmall">
																Utkast
															</Tag>
														)}
													</Table.DataCell>
													<Table.DataCell>{review.createdBy}</Table.DataCell>
													<Table.DataCell>
														{review.participants.length} ({confirmed} bekreftet)
													</Table.DataCell>
												</Table.Row>
											)
										})}
									</Table.Body>
								</Table>
							</>
						)}
					</VStack>
				</Tabs.Panel>

				{/* Rapporter */}
				<Tabs.Panel value="rapporter" style={{ paddingTop: "var(--ax-space-6)" }}>
					<ReportsPanel appReports={appReports} completedReviews={completedReviews} />
				</Tabs.Panel>

				{/* Lenkede applikasjoner */}
				{linkedApps.length > 0 && (
					<Tabs.Panel value="lenkede-applikasjoner" style={{ paddingTop: "var(--ax-space-6)" }}>
						<VStack gap="space-8">
							<BodyLong>
								Disse applikasjonene er testdeploymenter eller varianter som arver compliance-vurderinger fra denne
								applikasjonen.
							</BodyLong>
							<HStack gap="space-4" wrap>
								{linkedApps.map((la) => (
									<Tag key={la.id} variant="neutral" size="small">
										<Link to={`/applikasjoner/${la.id}/detaljer`}>{la.name}</Link>
									</Tag>
								))}
							</HStack>
						</VStack>
					</Tabs.Panel>
				)}
			</Tabs>
		</VStack>
	)
}

function ReportsPanel({
	appReports,
	completedReviews,
}: {
	appReports: Array<{
		id: string
		name: string
		createdAt: string
		createdBy: string
		reportBucketPath: string | null
	}>
	completedReviews: Array<{
		id: string
		title: string
		routineName: string
		reviewedAt: Date | string
		status: string
		createdBy: string
	}>
}) {
	const submit = useSubmit()
	const navigation = useNavigation()
	const actionData = useActionData<typeof action>()
	const isGenerating = navigation.state === "submitting"
	const [reportOptions, setReportOptions] = useState<string[]>([
		"includeReviews",
		"includeRoutineDescription",
		"includeAttachments",
	])
	const includeReviews = reportOptions.includes("includeReviews")

	const completed = completedReviews.filter((r) => r.status === "completed")
	const [selectedReviewIds, setSelectedReviewIds] = useState<string[]>(() => completed.map((r) => r.id))

	const toggleReview = (reviewId: string) => {
		setSelectedReviewIds((prev) =>
			prev.includes(reviewId) ? prev.filter((id) => id !== reviewId) : [...prev, reviewId],
		)
	}

	const allSelected = completed.length > 0 && selectedReviewIds.length === completed.length
	const toggleAll = () => {
		setSelectedReviewIds(allSelected ? [] : completed.map((r) => r.id))
	}

	return (
		<VStack gap="space-8">
			{/* Generate report section */}
			<Box background="sunken" padding="space-6" borderRadius="8">
				<Heading size="medium" level="3" spacing>
					Generer rapport
				</Heading>
				<VStack gap="space-4">
					<BodyShort>
						Generer en compliance-rapport for denne applikasjonen som PDF. Rapporten lagres og kan lastes ned eller
						vises senere.
					</BodyShort>
					<CheckboxGroup
						legend="Inkluder i rapporten"
						size="small"
						value={reportOptions}
						onChange={(val) => setReportOptions(val)}
					>
						<Checkbox value="includeReviews">Rutinegjennomganger</Checkbox>
						<Checkbox value="includeRoutineDescription">Rutinebeskrivelse (vises på gjennomgangssider)</Checkbox>
						<Checkbox value="includeAttachments">Vedlegg fra gjennomganger (flettes som sider i PDF)</Checkbox>
					</CheckboxGroup>

					{/* Review selection */}
					{includeReviews && completed.length > 0 && (
						<Box padding="space-4" borderWidth="1" borderColor="neutral" borderRadius="8">
							<VStack gap="space-2">
								<HStack justify="space-between" align="center">
									<Label size="small">
										Velg gjennomganger ({selectedReviewIds.length} av {completed.length})
									</Label>
									<Button variant="tertiary" size="xsmall" onClick={toggleAll}>
										{allSelected ? "Fjern alle" : "Velg alle"}
									</Button>
								</HStack>
								<Table size="small">
									<Table.Header>
										<Table.Row>
											<Table.HeaderCell style={{ width: "2rem" }} />
											<Table.HeaderCell>Tittel</Table.HeaderCell>
											<Table.HeaderCell>Rutine</Table.HeaderCell>
											<Table.HeaderCell>Dato</Table.HeaderCell>
											<Table.HeaderCell>Av</Table.HeaderCell>
										</Table.Row>
									</Table.Header>
									<Table.Body>
										{completed.map((review) => (
											<Table.Row key={review.id} onClick={() => toggleReview(review.id)} style={{ cursor: "pointer" }}>
												<Table.DataCell>
													<Checkbox
														size="small"
														hideLabel
														checked={selectedReviewIds.includes(review.id)}
														onChange={() => toggleReview(review.id)}
														onClick={(e) => e.stopPropagation()}
													>
														Velg
													</Checkbox>
												</Table.DataCell>
												<Table.DataCell>{review.title}</Table.DataCell>
												<Table.DataCell>{review.routineName}</Table.DataCell>
												<Table.DataCell>{new Date(review.reviewedAt).toLocaleDateString("nb-NO")}</Table.DataCell>
												<Table.DataCell>{review.createdBy}</Table.DataCell>
											</Table.Row>
										))}
									</Table.Body>
								</Table>
							</VStack>
						</Box>
					)}

					{includeReviews && completed.length === 0 && (
						<BodyShort size="small" textColor="subtle">
							Ingen fullførte gjennomganger tilgjengelig.
						</BodyShort>
					)}

					{actionData?.success && (
						<Alert variant="success" size="small">
							{actionData.message}
						</Alert>
					)}
					{actionData && !actionData.success && actionData.error && (
						<Alert variant="error" size="small">
							{actionData.error}
						</Alert>
					)}
					<div>
						<Button
							type="button"
							variant="primary"
							size="small"
							loading={isGenerating}
							onClick={() => {
								const fd = new FormData()
								fd.set("intent", "generate-report")
								fd.set("includeReviews", String(includeReviews))
								fd.set("includeAttachments", String(reportOptions.includes("includeAttachments")))
								fd.set("includeRoutineDescription", String(reportOptions.includes("includeRoutineDescription")))
								if (includeReviews) {
									fd.set("reviewIds", selectedReviewIds.join(","))
								}
								submit(fd, { method: "post" })
							}}
						>
							Generer compliance-rapport
						</Button>
					</div>
				</VStack>
			</Box>

			{/* Generated reports list */}
			<Box>
				<Heading size="medium" level="3" spacing>
					Genererte rapporter
				</Heading>
				{appReports.length === 0 ? (
					<BodyShort>Ingen rapporter er generert ennå.</BodyShort>
				) : (
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell>Rapport</Table.HeaderCell>
								<Table.HeaderCell>Generert</Table.HeaderCell>
								<Table.HeaderCell>Av</Table.HeaderCell>
								<Table.HeaderCell>Vis</Table.HeaderCell>
								<Table.HeaderCell>Last ned</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{appReports.map((r) => (
								<Table.Row key={r.id}>
									<Table.DataCell>{r.name}</Table.DataCell>
									<Table.DataCell>
										{new Date(r.createdAt).toLocaleString("nb-NO", {
											day: "numeric",
											month: "short",
											year: "numeric",
											hour: "2-digit",
											minute: "2-digit",
										})}
									</Table.DataCell>
									<Table.DataCell>{r.createdBy}</Table.DataCell>
									<Table.DataCell>
										{r.reportBucketPath && (
											<Button
												as="a"
												href={`/api/rapporter/${r.id}/pdf`}
												target="_blank"
												rel="noopener noreferrer"
												variant="tertiary"
												size="xsmall"
												icon={<EyeIcon aria-hidden />}
											>
												Vis
											</Button>
										)}
									</Table.DataCell>
									<Table.DataCell>
										{r.reportBucketPath && (
											<Button
												as="a"
												href={`/api/rapporter/${r.id}/pdf?download=true`}
												variant="tertiary"
												size="xsmall"
												icon={<DownloadIcon aria-hidden />}
											>
												Last ned
											</Button>
										)}
									</Table.DataCell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				)}
			</Box>
		</VStack>
	)
}

const STALENESS_THRESHOLD_MS = 2 * 60 * 60 * 1000 // 2 hours

function getCoverageVariant(percent: number | null): "success" | "warning" | "error" | "neutral" {
	if (percent === null) return "neutral"
	if (percent >= 80) return "success"
	if (percent >= 60) return "warning"
	return "error"
}

function CoverageCard({
	title,
	percent,
	numerator,
	denominator,
	details,
}: {
	title: string
	percent: number | null
	numerator: number | null
	denominator: number | null
	details?: Array<{ label: string; value: number | null }>
}) {
	const variant = getCoverageVariant(percent)

	return (
		<Box padding="space-16" borderRadius="8" borderColor="neutral-subtle" borderWidth="1">
			<VStack gap="space-8">
				<Heading size="xsmall">{title}</Heading>
				{percent !== null ? (
					<>
						<div
							style={{
								height: "8px",
								background: "var(--ax-bg-neutral-moderate)",
								borderRadius: "var(--ax-radius-4)",
								overflow: "hidden",
							}}
						>
							<div
								style={{
									height: "100%",
									width: `${Math.min(100, percent)}%`,
									background:
										variant === "success"
											? "var(--ax-bg-positive-strong)"
											: variant === "warning"
												? "var(--ax-bg-warning-strong)"
												: "var(--ax-bg-danger-strong)",
									borderRadius: "var(--ax-radius-4)",
									transition: "width 0.3s ease",
								}}
								role="progressbar"
								aria-valuenow={percent}
								aria-valuemin={0}
								aria-valuemax={100}
								aria-label={`${title}: ${Math.round(percent)}%`}
							/>
						</div>
						<HStack gap="space-4" align="center">
							<Tag variant={variant} size="small">
								{Math.round(percent)}%
							</Tag>
							{numerator !== null && denominator !== null && (
								<Detail>
									{numerator} av {denominator}
								</Detail>
							)}
						</HStack>
					</>
				) : (
					<Tag variant="neutral" size="small">
						Ingen data
					</Tag>
				)}
				{details && details.length > 0 && (
					<VStack gap="space-2">
						{details.map((d) => (
							<HStack key={d.label} gap="space-4" justify="space-between">
								<Detail>{d.label}</Detail>
								<Detail>{d.value ?? "–"}</Detail>
							</HStack>
						))}
					</VStack>
				)}
			</VStack>
		</Box>
	)
}

function DeploymentVerificationPanel({
	verifications,
}: {
	verifications: Array<{
		environment: string
		appName: string
		teamSlug: string
		status: string
		fourEyesCoveragePercent: number | null
		fourEyesTotal: number | null
		fourEyesApproved: number | null
		changeOriginCoveragePercent: number | null
		changeOriginTotal: number | null
		changeOriginLinked: number | null
		lastDeploymentAt: string | null
		fetchedAt: string
		rawSummary: {
			fourEyesCoverage: { unapproved: number; pending: number }
			changeOriginCoverage: { dependabot: number }
			lastDeployment: {
				createdAt: string
				deployer: string | null
				commitSha: string | null
				fourEyesStatus: string
				hasChangeOrigin: boolean
			} | null
		}
	}>
}) {
	if (verifications.length === 0) {
		return (
			<Alert variant="info" size="small">
				Ingen deployment-data tilgjengelig. Data hentes automatisk fra deployment-audit og oppdateres periodisk.
			</Alert>
		)
	}

	const allNotMonitored = verifications.every((v) => v.status === "not_monitored")
	if (allNotMonitored) {
		return (
			<Alert variant="info" size="small">
				Denne applikasjonen overvåkes ikke av deployment-audit. Kontakt plattformteamet for å aktivere overvåking.
			</Alert>
		)
	}

	const syncedVerifications = verifications.filter((v) => v.status === "synced")

	return (
		<VStack gap="space-16">
			{syncedVerifications.map((v) => {
				const isStale = v.fetchedAt && Date.now() - new Date(v.fetchedAt).getTime() > STALENESS_THRESHOLD_MS
				const lastDeploy = v.rawSummary?.lastDeployment

				return (
					<VStack key={v.environment} gap="space-12">
						<HStack gap="space-8" align="center">
							<Heading size="small">{v.environment}</Heading>
							{isStale && (
								<Tag variant="neutral" size="xsmall">
									⚠️ Foreldet
								</Tag>
							)}
							<Detail>
								Sist oppdatert:{" "}
								{new Date(v.fetchedAt).toLocaleString("nb-NO", {
									day: "numeric",
									month: "short",
									hour: "2-digit",
									minute: "2-digit",
								})}
							</Detail>
						</HStack>

						<HGrid columns={{ xs: 1, md: 2, lg: 3 }} gap="space-12">
							<CoverageCard
								title="Fire-øyne-dekning"
								percent={v.fourEyesCoveragePercent}
								numerator={v.fourEyesApproved}
								denominator={v.fourEyesTotal}
								details={[
									{ label: "Ugodkjent", value: v.rawSummary?.fourEyesCoverage.unapproved ?? null },
									{ label: "Ventende", value: v.rawSummary?.fourEyesCoverage.pending ?? null },
								]}
							/>
							<CoverageCard
								title="Endringsopphav"
								percent={v.changeOriginCoveragePercent}
								numerator={v.changeOriginLinked}
								denominator={v.changeOriginTotal}
								details={[
									{
										label: "Dependabot",
										value: v.rawSummary?.changeOriginCoverage.dependabot ?? null,
									},
								]}
							/>
							<Box padding="space-16" borderRadius="8" borderColor="neutral-subtle" borderWidth="1">
								<VStack gap="space-8">
									<Heading size="xsmall">Siste deployment</Heading>
									{lastDeploy ? (
										<VStack gap="space-4">
											<HStack gap="space-4" justify="space-between">
												<Detail>Dato</Detail>
												<Detail>
													{new Date(lastDeploy.createdAt).toLocaleString("nb-NO", {
														day: "numeric",
														month: "short",
														year: "numeric",
														hour: "2-digit",
														minute: "2-digit",
													})}
												</Detail>
											</HStack>
											{lastDeploy.deployer && (
												<HStack gap="space-4" justify="space-between">
													<Detail>Deployer</Detail>
													<Detail>{lastDeploy.deployer}</Detail>
												</HStack>
											)}
											{lastDeploy.commitSha && (
												<HStack gap="space-4" justify="space-between">
													<Detail>Commit</Detail>
													<HStack gap="space-2" align="center">
														<Detail>{lastDeploy.commitSha.slice(0, 8)}</Detail>
														<CopyButton copyText={lastDeploy.commitSha} size="xsmall" variant="action" />
													</HStack>
												</HStack>
											)}
											<HStack gap="space-4" justify="space-between">
												<Detail>Fire-øyne</Detail>
												<Tag
													variant={
														lastDeploy.fourEyesStatus === "approved"
															? "success"
															: lastDeploy.fourEyesStatus === "pending"
																? "neutral"
																: "warning"
													}
													size="xsmall"
												>
													{lastDeploy.fourEyesStatus}
												</Tag>
											</HStack>
											<HStack gap="space-4" justify="space-between">
												<Detail>Endringsopphav</Detail>
												<Tag variant={lastDeploy.hasChangeOrigin ? "success" : "neutral"} size="xsmall">
													{lastDeploy.hasChangeOrigin ? "Koblet" : "Ikke koblet"}
												</Tag>
											</HStack>
										</VStack>
									) : (
										<Tag variant="neutral" size="small">
											Ingen deployments
										</Tag>
									)}
								</VStack>
							</Box>
						</HGrid>
					</VStack>
				)
			})}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }

// ─── Traffic Comparison Component ───────────────────────────────────────────

interface TrafficRow {
	appName: string
	namespace: string
	cluster: string
	count: number
}

function parseTrafficCsv(text: string): TrafficRow[] {
	const lines = text.trim().split(/\r?\n/)
	if (lines.length < 2) return []

	return lines.slice(1).flatMap((line) => {
		const trimmed = line.trim()
		if (!trimmed) return []
		// Handle quoted CSV: "cluster:namespace:app","1,234" or "cluster:namespace:app",1234
		const match = trimmed.match(/^"([^"]+)"[,;]"?([^"]*)"?$/)
		if (!match) return []
		const parts = match[1].split(":")
		if (parts.length !== 3) return []
		const countStr = match[2].replace(/,/g, "")
		const count = Number.parseInt(countStr, 10)
		if (Number.isNaN(count)) return []
		return [{ cluster: parts[0], namespace: parts[1], appName: parts[2], count }]
	})
}

const statusSortOrder: Record<string, number> = {
	monitored: 0,
	discovered: 1,
	acknowledged: 2,
	unknown: 3,
}

function getStatusKey(
	resolution: { status: string; appId?: string } | undefined,
	ack: { comment: string; acknowledgedBy: string; acknowledgedAt: string } | undefined,
): string {
	if (resolution?.status === "monitored") return "monitored"
	if (resolution?.status === "discovered") return "discovered"
	if (ack) return "acknowledged"
	return "unknown"
}

function AuthorizedAppsPanel({
	accessPolicyRules,
	knownApps,
	acknowledgments,
	submit,
	setAckTarget,
	setAckComment,
	ackModalRef,
}: {
	accessPolicyRules: AccessPolicyRule[]
	knownApps: Record<string, { status: string; appId?: string }>
	acknowledgments: Record<string, { comment: string; acknowledgedBy: string; acknowledgedAt: string }>
	submit: ReturnType<typeof useSubmit>
	setAckTarget: (target: string | null) => void
	setAckComment: (comment: string) => void
	ackModalRef: React.RefObject<HTMLDialogElement | null>
}) {
	const [searchQuery, setSearchQuery] = useState("")
	const [sort, setSort] = useState<{ orderBy: string; direction: "ascending" | "descending" } | undefined>()
	const [trafficData, setTrafficData] = useState<TrafficRow[] | null>(null)
	const [fileName, setFileName] = useState<string | null>(null)
	const fileInputRef = useRef<HTMLInputElement>(null)

	const handleFile = useCallback((file: File) => {
		const reader = new FileReader()
		reader.onload = (e) => {
			const text = e.target?.result as string
			setTrafficData(parseTrafficCsv(text))
			setFileName(file.name)
		}
		reader.readAsText(file)
	}, [])

	const handleSort = (sortKey: string) =>
		setSort((prev) =>
			prev?.orderBy === sortKey && prev.direction === "ascending"
				? { orderBy: sortKey, direction: "descending" }
				: { orderBy: sortKey, direction: "ascending" },
		)

	const inboundRules = accessPolicyRules.filter((r) => r.direction === "inbound")
	const trafficByApp = trafficData ? new Map(trafficData.map((t) => [t.appName, t])) : null

	const filteredRules = inboundRules.filter((rule) => {
		if (!searchQuery) return true
		const q = searchQuery.toLowerCase()
		return (
			rule.ruleApplication.toLowerCase().includes(q) ||
			(rule.ruleNamespace?.toLowerCase().includes(q) ?? false) ||
			(rule.ruleCluster?.toLowerCase().includes(q) ?? false)
		)
	})

	const sortedRules = sort
		? [...filteredRules].sort((a, b) => {
				const dir = sort.direction === "ascending" ? 1 : -1
				switch (sort.orderBy) {
					case "appName":
						return dir * a.ruleApplication.localeCompare(b.ruleApplication, "nb")
					case "namespace":
						return dir * (a.ruleNamespace ?? "").localeCompare(b.ruleNamespace ?? "", "nb")
					case "cluster":
						return dir * (a.ruleCluster ?? "").localeCompare(b.ruleCluster ?? "", "nb")
					case "status": {
						const statusA =
							statusSortOrder[getStatusKey(knownApps[a.ruleApplication], acknowledgments[a.ruleApplication])] ?? 99
						const statusB =
							statusSortOrder[getStatusKey(knownApps[b.ruleApplication], acknowledgments[b.ruleApplication])] ?? 99
						return dir * (statusA - statusB)
					}
					case "callCount": {
						const countA = trafficByApp?.get(a.ruleApplication)?.count ?? -1
						const countB = trafficByApp?.get(b.ruleApplication)?.count ?? -1
						return dir * (countA - countB)
					}
					case "trafficStatus": {
						const hasA = trafficByApp?.has(a.ruleApplication) ? 0 : 1
						const hasB = trafficByApp?.has(b.ruleApplication) ? 0 : 1
						return dir * (hasA - hasB)
					}
					default:
						return 0
				}
			})
		: filteredRules

	// Unknown callers: apps in traffic data that are NOT in the access policy
	const policyAppNames = new Set(inboundRules.map((r) => r.ruleApplication))
	const unknownCallers = trafficData?.filter((t) => !policyAppNames.has(t.appName)) ?? []
	const noTrafficCount = trafficByApp ? inboundRules.filter((r) => !trafficByApp.has(r.ruleApplication)).length : 0

	return (
		<VStack gap="space-4">
			<Alert variant="info" size="small">
				Autoriserte applikasjoner er de som har nettverkstilgang til å kalle denne applikasjonen, og som kan utstede
				tokens via TokenX eller Entra ID. Oversikten hentes automatisk fra <code>spec.accessPolicy.inbound.rules</code>{" "}
				i Nais-manifestet.
			</Alert>

			{inboundRules.length === 0 ? (
				<BodyLong>
					Ingen autoriserte applikasjoner funnet. Applikasjonen har enten ikke definert{" "}
					<code>accessPolicy.inbound.rules</code> i sitt Nais-manifest, eller den har ikke blitt synkronisert ennå.
				</BodyLong>
			) : (
				<VStack gap="space-2">
					<Heading size="xsmall" level="4">
						Innkommende tilgang ({inboundRules.length} {inboundRules.length === 1 ? "applikasjon" : "applikasjoner"})
					</Heading>
					<BodyShort size="small" textColor="subtle">
						Disse applikasjonene har tillatelse til å kalle dette API-et over nettverket.
					</BodyShort>
					<HStack gap="space-4" align="end">
						<div style={{ flex: 1 }}>
							<Search
								label="Søk i autoriserte applikasjoner"
								variant="simple"
								size="small"
								value={searchQuery}
								onChange={setSearchQuery}
								onClear={() => setSearchQuery("")}
								placeholder="Filtrer på applikasjon, namespace eller klynge"
							/>
						</div>
						{!trafficData ? (
							<div>
								<input
									ref={fileInputRef}
									type="file"
									accept=".csv"
									style={{ display: "none" }}
									onChange={(e) => {
										const file = e.target.files?.[0]
										if (file) handleFile(file)
									}}
								/>
								<Button
									variant="secondary"
									size="small"
									icon={<UploadIcon aria-hidden />}
									onClick={() => fileInputRef.current?.click()}
								>
									Last opp trafikkdata
								</Button>
							</div>
						) : (
							<HStack gap="space-2" align="center">
								<Detail textColor="subtle">{fileName}</Detail>
								<Button
									variant="tertiary"
									size="xsmall"
									onClick={() => {
										setTrafficData(null)
										setFileName(null)
									}}
								>
									Fjern
								</Button>
							</HStack>
						)}
					</HStack>

					{trafficData && noTrafficCount > 0 && (
						<Alert variant="warning" size="small">
							{noTrafficCount} av {inboundRules.length} autoriserte applikasjoner har ingen registrert trafikk i den
							opplastede perioden.
						</Alert>
					)}

					{filteredRules.length === 0 ? (
						<Box padding="space-6" borderRadius="8" background="sunken">
							<BodyShort>Ingen treff for «{searchQuery}».</BodyShort>
						</Box>
					) : (
						// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table container needs keyboard focus
						<section className="table-scroll" tabIndex={0} aria-label="Autoriserte applikasjoner">
							<Table size="small" sort={sort} onSortChange={handleSort}>
								<Table.Header>
									<Table.Row>
										<Table.ColumnHeader sortKey="appName" sortable scope="col">
											Applikasjon
										</Table.ColumnHeader>
										<Table.ColumnHeader sortKey="namespace" sortable scope="col">
											Namespace
										</Table.ColumnHeader>
										<Table.ColumnHeader sortKey="cluster" sortable scope="col">
											Klynge
										</Table.ColumnHeader>
										<Table.ColumnHeader sortKey="status" sortable scope="col">
											Status
										</Table.ColumnHeader>
										{trafficData && (
											<>
												<Table.ColumnHeader sortKey="callCount" sortable scope="col" align="right">
													Antall kall
												</Table.ColumnHeader>
												<Table.ColumnHeader sortKey="trafficStatus" sortable scope="col">
													Trafikk
												</Table.ColumnHeader>
											</>
										)}
										<Table.HeaderCell scope="col">Handling</Table.HeaderCell>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{sortedRules.map((rule) => {
										const resolution = knownApps[rule.ruleApplication]
										const ack = acknowledgments[rule.ruleApplication]
										const isUnknown = !resolution || resolution.status === "unknown"
										const traffic = trafficByApp?.get(rule.ruleApplication)
										return (
											<Table.Row key={rule.id}>
												<Table.DataCell>
													{resolution?.status === "monitored" ? (
														<Link to={`/applikasjoner/${resolution.appId}/detaljer`}>
															<code style={{ fontSize: "var(--ax-font-size-sm)" }}>{rule.ruleApplication}</code>
														</Link>
													) : (
														<code style={{ fontSize: "var(--ax-font-size-sm)" }}>{rule.ruleApplication}</code>
													)}
												</Table.DataCell>
												<Table.DataCell>
													{rule.ruleNamespace ? (
														<code style={{ fontSize: "var(--ax-font-size-sm)" }}>{rule.ruleNamespace}</code>
													) : (
														<BodyShort size="small" textColor="subtle">
															Samme
														</BodyShort>
													)}
												</Table.DataCell>
												<Table.DataCell>
													{rule.ruleCluster ? (
														<code style={{ fontSize: "var(--ax-font-size-sm)" }}>{rule.ruleCluster}</code>
													) : (
														<BodyShort size="small" textColor="subtle">
															Samme
														</BodyShort>
													)}
												</Table.DataCell>
												<Table.DataCell>
													{resolution?.status === "monitored" ? (
														<Tag variant="success" size="xsmall">
															Overvåket
														</Tag>
													) : resolution?.status === "discovered" ? (
														<Tag variant="info" size="xsmall">
															Nais
														</Tag>
													) : ack ? (
														<VStack gap="space-1">
															<HStack gap="space-2" align="center">
																<Tag variant="neutral" size="xsmall">
																	Kvittert
																</Tag>
															</HStack>
															<BodyShort size="small" textColor="subtle">
																{ack.comment}
															</BodyShort>
															<Detail textColor="subtle">
																{ack.acknowledgedBy}, {new Date(ack.acknowledgedAt).toLocaleDateString("nb-NO")}
															</Detail>
														</VStack>
													) : (
														<HStack gap="space-1" align="center">
															<XMarkOctagonIcon
																aria-hidden
																fontSize="1rem"
																style={{ color: "var(--ax-text-warning)" }}
															/>
															<Tag variant="warning" size="xsmall">
																Ukjent
															</Tag>
														</HStack>
													)}
												</Table.DataCell>
												{trafficByApp && (
													<>
														<Table.DataCell align="right">
															{traffic ? traffic.count.toLocaleString("nb-NO") : "–"}
														</Table.DataCell>
														<Table.DataCell>
															{traffic ? (
																<Tag variant="success" size="xsmall">
																	Aktiv
																</Tag>
															) : (
																<Tag variant="warning" size="xsmall">
																	Ingen trafikk
																</Tag>
															)}
														</Table.DataCell>
													</>
												)}
												<Table.DataCell>
													{isUnknown &&
														(ack ? (
															<Button
																variant="tertiary-neutral"
																size="xsmall"
																onClick={() =>
																	submit(
																		{
																			intent: "revoke-acknowledgment",
																			ruleApplication: rule.ruleApplication,
																		},
																		{ method: "POST" },
																	)
																}
															>
																Trekk tilbake
															</Button>
														) : (
															<Button
																variant="tertiary"
																size="xsmall"
																onClick={() => {
																	setAckTarget(rule.ruleApplication)
																	setAckComment("")
																	ackModalRef.current?.showModal()
																}}
															>
																Kvitter ut
															</Button>
														))}
												</Table.DataCell>
											</Table.Row>
										)
									})}
								</Table.Body>
							</Table>
						</section>
					)}
					{searchQuery && filteredRules.length < inboundRules.length && (
						<BodyShort size="small" textColor="subtle">
							Viser {filteredRules.length} av {inboundRules.length} applikasjoner
						</BodyShort>
					)}
				</VStack>
			)}

			{/* Unknown callers from traffic data */}
			{unknownCallers.length > 0 && (
				<VStack gap="space-2">
					<Heading size="xsmall" level="4">
						Kallende applikasjoner uten autorisasjon ({unknownCallers.length})
					</Heading>
					<BodyShort size="small" textColor="subtle">
						Disse applikasjonene har trafikk i loggen, men er ikke blant de autoriserte applikasjonene.
					</BodyShort>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table container needs keyboard focus */}
					<section className="table-scroll" tabIndex={0} aria-label="Kallende applikasjoner uten autorisasjon">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
									<Table.HeaderCell scope="col">Namespace</Table.HeaderCell>
									<Table.HeaderCell scope="col">Klynge</Table.HeaderCell>
									<Table.HeaderCell scope="col" align="right">
										Antall kall
									</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{unknownCallers
									.sort((a, b) => b.count - a.count)
									.map((t) => (
										<Table.Row key={`${t.cluster}:${t.namespace}:${t.appName}`}>
											<Table.DataCell>
												<code style={{ fontSize: "var(--ax-font-size-sm)" }}>{t.appName}</code>
											</Table.DataCell>
											<Table.DataCell>
												<code style={{ fontSize: "var(--ax-font-size-sm)" }}>{t.namespace}</code>
											</Table.DataCell>
											<Table.DataCell>
												<code style={{ fontSize: "var(--ax-font-size-sm)" }}>{t.cluster}</code>
											</Table.DataCell>
											<Table.DataCell align="right">{t.count.toLocaleString("nb-NO")}</Table.DataCell>
										</Table.Row>
									))}
							</Table.Body>
						</Table>
					</section>
				</VStack>
			)}
		</VStack>
	)
}

interface AccessPolicyRule {
	id: string
	direction: string
	ruleApplication: string
	ruleNamespace: string | null
	ruleCluster: string | null
}

function AddPersistenceForm() {
	const fetcher = useFetcher()
	const isSubmitting = fetcher.state !== "idle"

	return (
		<Box background="sunken" padding="space-8" borderRadius="8">
			<fetcher.Form method="post">
				<input type="hidden" name="intent" value="add-persistence" />
				<VStack gap="space-4">
					<Heading size="xsmall" level="3">
						Legg til database manuelt
					</Heading>
					<HStack gap="space-4" align="end" wrap>
						<Select label="Type" name="persistenceType" style={{ minWidth: "12rem" }}>
							{persistenceTypeEnum.map((t) => (
								<option key={t} value={t}>
									{persistenceLabels[t] ?? t}
								</option>
							))}
						</Select>
						<TextField label="Navn" name="persistenceName" size="small" style={{ minWidth: "14rem" }} />
						<Select label="Dataklassifisering" name="dataClassification">
							<option value="">Ikke satt</option>
							{(Object.entries(dataClassificationLabels) as [DataClassification, string][]).map(([value, label]) => (
								<option key={value} value={value}>
									{label}
								</option>
							))}
						</Select>
						<Button
							type="submit"
							variant="secondary"
							size="small"
							icon={<PlusIcon aria-hidden />}
							loading={isSubmitting}
						>
							Legg til
						</Button>
					</HStack>
				</VStack>
			</fetcher.Form>
		</Box>
	)
}

function PersistenceRow({
	p,
	oracleAuditSummaries,
}: {
	p: {
		id: string
		type: string
		name: string
		version: string | null
		tier: string | null
		highAvailability: boolean | null
		auditLogging: boolean | null
		auditLogUrl: string | null
		oracleInstanceId: string | null
		dataClassification: string | null
		manuallyAdded: boolean
	}
	oracleAuditSummaries: Record<
		string,
		{
			conclusion: string
			reason: string
			findings: Array<{ severity: string; message: string }>
		}
	>
}) {
	const classificationFetcher = useFetcher()
	const deleteFetcher = useFetcher()

	return (
		<Table.Row>
			<Table.DataCell>
				<HStack gap="space-2" align="center">
					<Tag variant={persistenceVariants[p.type] ?? "neutral"} size="xsmall">
						{persistenceLabels[p.type] ?? p.type}
					</Tag>
					{p.manuallyAdded && (
						<Tag variant="neutral" size="xsmall">
							Manuelt
						</Tag>
					)}
					{!p.manuallyAdded && p.oracleInstanceId && p.oracleInstanceId === p.name && (
						<Tag variant="neutral" size="xsmall">
							Manuelt konfigurert
						</Tag>
					)}
				</HStack>
			</Table.DataCell>
			<Table.DataCell>{p.name}</Table.DataCell>
			<Table.DataCell>
				<classificationFetcher.Form method="post">
					<input type="hidden" name="intent" value="update-classification" />
					<input type="hidden" name="persistenceId" value={p.id} />
					<Select
						label="Dataklassifisering"
						hideLabel
						size="small"
						name="dataClassification"
						defaultValue={p.dataClassification ?? ""}
						onChange={(e: ChangeEvent<HTMLSelectElement>) => {
							const form = e.currentTarget.form
							if (form) classificationFetcher.submit(form)
						}}
					>
						<option value="">Ikke satt</option>
						{(Object.entries(dataClassificationLabels) as [DataClassification, string][]).map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</Select>
				</classificationFetcher.Form>
			</Table.DataCell>
			<Table.DataCell>{p.version ?? "–"}</Table.DataCell>
			<Table.DataCell>{p.tier ?? "–"}</Table.DataCell>
			<Table.DataCell>
				{p.highAvailability === true ? (
					<Tag variant="success" size="xsmall">
						Ja
					</Tag>
				) : p.highAvailability === false ? (
					<Tag variant="error" size="xsmall">
						Nei
					</Tag>
				) : (
					"–"
				)}
			</Table.DataCell>
			<Table.DataCell>
				{p.type === "oracle" && oracleAuditSummaries[p.id] ? (
					<VStack gap="space-2">
						<Tag variant={conclusionConfig[oracleAuditSummaries[p.id].conclusion]?.variant ?? "neutral"} size="xsmall">
							{conclusionConfig[oracleAuditSummaries[p.id].conclusion]?.label ?? oracleAuditSummaries[p.id].conclusion}
						</Tag>
						<Detail style={{ color: "var(--ax-text-subtle)" }}>{oracleAuditSummaries[p.id].reason}</Detail>
						{oracleAuditSummaries[p.id].findings.length > 0 && (
							<ReadMore header="Funn" size="small" defaultOpen={false}>
								<VStack gap="space-2">
									{oracleAuditSummaries[p.id].findings.map((f, i) => (
										// biome-ignore lint/suspicious/noArrayIndexKey: static findings list
										<HStack key={i} gap="space-2" align="center" wrap>
											<Tag variant={findingSeverityVariant[f.severity] ?? "info"} size="xsmall">
												{f.severity}
											</Tag>
											<Detail>{f.message}</Detail>
										</HStack>
									))}
								</VStack>
							</ReadMore>
						)}
					</VStack>
				) : p.auditLogging === true ? (
					p.auditLogUrl ? (
						<AkselLink href={p.auditLogUrl} target="_blank" rel="noopener noreferrer">
							<Tag variant="success" size="xsmall">
								Ja – se logg (åpnes i nytt vindu)
							</Tag>
						</AkselLink>
					) : (
						<Tag variant="success" size="xsmall">
							Ja
						</Tag>
					)
				) : p.auditLogging === false ? (
					<Tag variant="error" size="xsmall">
						Nei
					</Tag>
				) : (
					"–"
				)}
			</Table.DataCell>
			<Table.DataCell>
				{p.manuallyAdded && (
					<deleteFetcher.Form method="post">
						<input type="hidden" name="intent" value="delete-persistence" />
						<input type="hidden" name="persistenceId" value={p.id} />
						<Button
							type="submit"
							variant="tertiary-neutral"
							size="xsmall"
							icon={<TrashIcon aria-hidden />}
							loading={deleteFetcher.state !== "idle"}
						>
							Slett
						</Button>
					</deleteFetcher.Form>
				)}
			</Table.DataCell>
		</Table.Row>
	)
}

// ─── Unified Groups Section ──────────────────────────────────────────────

const criticalityTagVariant: Record<string, "success" | "warning" | "neutral" | "error"> = {
	low: "success",
	medium: "warning",
	high: "warning",
	very_high: "error",
}

const criticalityTagColor: Record<string, string> = {
	high: "var(--ax-bg-warning-moderate)",
}

type UnifiedGroup = {
	groupId: string
	source: "nais" | "manual" | "removed"
	manualGroupDbId?: string
	createdBy?: string
}

function GroupsSection({
	naisGroupIds,
	manualGroups,
	ghostGroupIds,
	groupNames,
	assessmentsByGroupId,
	authIntegrations,
	canAdmin,
}: {
	naisGroupIds: string[]
	manualGroups: Array<{ id: string; groupId: string; groupName: string | null; createdBy: string; createdAt: string }>
	ghostGroupIds: string[]
	groupNames: Record<string, string>
	assessmentsByGroupId: Record<string, { criticality: string; updatedBy: string; updatedAt: string }>
	authIntegrations: Array<{ type: string; allowAllUsers: boolean | null; groups: string | null }>
	canAdmin: boolean
}) {
	const addFetcher = useFetcher()
	const removeFetcher = useFetcher()
	const criticalityFetcher = useFetcher()
	const searchFetcher = useFetcher<{ results: Array<{ id: string; displayName: string }> }>()
	const [searchQuery, setSearchQuery] = useState("")
	const [showResults, setShowResults] = useState(false)
	const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

	// Build unified group list: Nais groups first, then manual-only, then ghost (removed)
	const naisGroupIdSet = new Set(naisGroupIds)
	const allExistingGroupIds = new Set([...naisGroupIds, ...manualGroups.map((g) => g.groupId)])

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

	const totalGroupCount = unifiedGroups.length

	const entraAuth = authIntegrations.find((a) => a.type === "entra_id")
	const hasAllUsers = entraAuth?.allowAllUsers ?? false

	return (
		<VStack gap="space-4">
			<VStack gap="space-2">
				<Heading size="xsmall" level="4">
					Entra ID-grupper ({totalGroupCount})
				</Heading>
				<BodyShort size="small" textColor="subtle">
					{hasAllUsers
						? "Alle brukere får utstedt token uavhengig av gruppemedlemskap."
						: naisGroupIds.length > 0
							? "Bruker må være medlem av minst én av gruppene for å få utstedt token. Applikasjonen kan ha ytterligere tilgangskontroll som avgrenser tilgang."
							: "Ingen grupper er konfigurert i Nais-manifestet."}
				</BodyShort>
			</VStack>

			{/* Add manual group search */}
			{canAdmin && (
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
													style={{
														justifyContent: "flex-start",
														width: "100%",
														textAlign: "left",
													}}
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
			)}

			{/* Unified groups table */}
			{unifiedGroups.length > 0 && (
				<div className="table-scroll">
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Gruppe</Table.HeaderCell>
								<Table.HeaderCell scope="col">Kilde</Table.HeaderCell>
								<Table.HeaderCell scope="col">Kritikalitet</Table.HeaderCell>
								{canAdmin && (
									<Table.HeaderCell scope="col" style={{ width: "1px" }}>
										<span className="navds-sr-only">Handlinger</span>
									</Table.HeaderCell>
								)}
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
											<VStack gap="space-1">
												{displayName ?? (
													<BodyShort size="small" textColor="subtle">
														Ukjent
													</BodyShort>
												)}
												<HStack gap="space-1" align="center">
													<Detail textColor="subtle" style={{ fontFamily: "monospace" }}>
														{ug.groupId}
													</Detail>
													<CopyButton copyText={ug.groupId} size="xsmall" />
												</HStack>
											</VStack>
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
											{canAdmin ? (
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
											) : assessment ? (
												<Tag
													variant={criticalityTagVariant[assessment.criticality] ?? "neutral"}
													size="xsmall"
													style={
														assessment.criticality === "high"
															? { backgroundColor: criticalityTagColor.high, borderColor: criticalityTagColor.high }
															: undefined
													}
												>
													{groupCriticalityLabels[assessment.criticality as GroupCriticality] ?? assessment.criticality}
												</Tag>
											) : (
												<BodyShort size="small" textColor="subtle">
													Ikke vurdert
												</BodyShort>
											)}
										</Table.DataCell>
										{canAdmin && (
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
										)}
									</Table.Row>
								)
							})}
						</Table.Body>
					</Table>
				</div>
			)}
		</VStack>
	)
}
