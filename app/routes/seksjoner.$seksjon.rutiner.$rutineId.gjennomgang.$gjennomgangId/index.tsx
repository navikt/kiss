import { VStack } from "@navikt/ds-react"
import { useCallback, useMemo } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, redirect, useLoaderData, useSearchParams } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import {
	addFollowUpPoint,
	addReviewLink,
	autoCreateActivitiesForReview,
	completeReview,
	deleteFollowUpPoint,
	deleteReviewLink,
	discardReview,
	getReview,
	getReviewActivities,
	getReviewActivityByType,
	getReviewActivityIdByType,
	getRoutine,
	getRoutineActivityLinks,
	getRoutineArchivedStatusByReviewId,
	patchEntraActivity,
	seedEntraActivity,
	updateFollowUpPointDescription,
	updateFollowUpPointStatus,
	updateFollowUpPointText,
	updateReview,
} from "~/db/queries/routines.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { type GroupCriticality, groupCriticalityEnum } from "~/db/schema/applications"
import { FOLLOW_UP_POINT_STATUSES, type FollowUpPointStatus, RPA_DECISION_VALUES } from "~/db/schema/routines"
import { getEvidenceTypesForActivity, getProviderTypeForActivity, type RoutineActivityType } from "~/lib/activity-types"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import {
	ENTRA_STAGED_DATA_ACTIVITY_TYPE,
	type EntraCriticality,
	entraCriticalityValues,
	parseEntraGroupSnapshot,
	parseEntraStagedData,
} from "~/lib/entra-staged-data"
import { logger } from "~/lib/logger.server"
import { renderMarkdown } from "~/lib/markdown.server"
import { parseParticipantsFormValue } from "~/lib/participants"
import { EntraMaintenanceSection, type EntraStagedGroupsProp } from "./components/activities/EntraMaintenanceSection"
import { type RpaMaintenanceData, RpaUserMaintenanceSection } from "./components/activities/RpaUserMaintenanceSection"
import { FollowUpPointsSection } from "./components/follow-up/FollowUpPointsSection"
import { ReviewWizard } from "./components/ReviewWizard"
import { StepActivity } from "./components/StepActivity"
import { StepAttachments } from "./components/StepAttachments"
import { StepComplete } from "./components/StepComplete"
import { StepControls } from "./components/StepControls"
import { StepIntroduction } from "./components/StepIntroduction"
import { StepRoutine } from "./components/StepRoutine"
import { StepRulesets } from "./components/StepRulesets"
import { StepSummary } from "./components/StepSummary"
import { type ActionResult, type ActivityStepInfo, buildSteps, parseActivityStepIndex } from "./components/shared"

function getNullableString(value: unknown): string | null {
	return typeof value === "string" ? value : null
}

function parseOracleProviderMetadata(providerMetadata: Record<string, unknown>) {
	const instanceId = getNullableString(providerMetadata.instanceId)
	const evidenceType = getNullableString(providerMetadata.evidenceType)

	if (!instanceId || !evidenceType) {
		return null
	}

	return {
		instanceId,
		evidenceType,
		apiInstanceName: getNullableString(providerMetadata.apiInstanceName),
	}
}

function parseOracleInstanceFromProviderConfig(providerConfig: unknown): string | null {
	if (!providerConfig || typeof providerConfig !== "object" || Array.isArray(providerConfig)) {
		return null
	}
	const instanceId = (providerConfig as Record<string, unknown>).instanceId
	return typeof instanceId === "string" && instanceId ? instanceId : null
}

function toEntraGroupsData(
	groups: Array<{
		groupId: string
		groupName: string | null
		source: "nais_auth" | "manual" | "ghost"
		hasNaisSource: boolean
		hasManualSource: boolean
		isGone: boolean
		criticality: EntraCriticality | null
		isNewAssessment?: boolean
		isAddedDuringReview?: boolean
	}>,
): EntraStagedGroupsProp {
	return {
		groups: groups.map((group) => ({
			groupId: group.groupId,
			groupName: group.groupName,
			source: group.source,
			hasNaisSource: group.hasNaisSource,
			hasManualSource: group.hasManualSource,
			isGone: group.isGone,
			isNewAssessment: group.isNewAssessment ?? false,
			isAddedDuringReview: group.isAddedDuringReview ?? false,
			criticality: group.criticality,
		})),
	}
}

function parseLegacyEntraSnapshot(snapshot: unknown): EntraStagedGroupsProp | null {
	if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
		return null
	}

	const groups = (snapshot as { groups?: unknown }).groups
	if (!Array.isArray(groups)) {
		return null
	}

	type RawEntry = {
		groupId: string
		groupName: string | null
		source: "nais" | "manual" | "removed"
		criticality: EntraCriticality | null
	}
	const validEntries: RawEntry[] = []
	for (const group of groups) {
		if (!group || typeof group !== "object" || Array.isArray(group)) {
			continue
		}

		const entry = group as {
			groupId?: unknown
			groupName?: unknown
			source?: unknown
			criticality?: unknown
		}

		if (typeof entry.groupId !== "string") {
			continue
		}
		if (entry.source !== "nais" && entry.source !== "manual" && entry.source !== "removed") {
			continue
		}

		const rawCriticality = typeof entry.criticality === "string" ? entry.criticality : null
		const criticality: EntraCriticality | null =
			rawCriticality !== null && (entraCriticalityValues as readonly string[]).includes(rawCriticality)
				? (rawCriticality as EntraCriticality)
				: null

		validEntries.push({
			groupId: entry.groupId,
			groupName: typeof entry.groupName === "string" ? entry.groupName : null,
			source: entry.source,
			criticality,
		})
	}

	// Merge entries with the same groupId — legacy snapshots can have both a
	// "nais" and a "manual" row for overlapping groups.
	const merged = new Map<string, EntraStagedGroupsProp["groups"][number]>()
	for (const entry of validEntries) {
		const existing = merged.get(entry.groupId)
		const hasNaisSource = entry.source === "nais" || (existing?.hasNaisSource ?? false)
		const hasManualSource = entry.source === "manual" || (existing?.hasManualSource ?? false)
		const source: "nais_auth" | "manual" | "ghost" = hasNaisSource ? "nais_auth" : hasManualSource ? "manual" : "ghost"
		merged.set(entry.groupId, {
			groupId: entry.groupId,
			groupName: entry.groupName ?? existing?.groupName ?? null,
			source,
			hasNaisSource,
			hasManualSource,
			isGone: false,
			isNewAssessment: false,
			isAddedDuringReview: false,
			criticality: entry.criticality ?? existing?.criticality ?? null,
		})
	}

	return { groups: [...merged.values()] }
}

function getCompletedEntraGroupsData(snapshot: unknown): EntraStagedGroupsProp | null {
	// Snapshots written after the type/schemaVersion fields were introduced have
	// snapshot.type = "entra_id_group_maintenance". Use explicit discriminant check
	// instead of try/catch to distinguish new from legacy format.
	const hasTypeField =
		snapshot !== null &&
		typeof snapshot === "object" &&
		!Array.isArray(snapshot) &&
		"type" in snapshot &&
		(snapshot as Record<string, unknown>).type === ENTRA_STAGED_DATA_ACTIVITY_TYPE
	if (hasTypeField) {
		return toEntraGroupsData(parseEntraGroupSnapshot(snapshot).groups)
	}
	// Legacy snapshots (written before type/schemaVersion) fall back to the
	// lenient parser that handles the old { groups: [...] } shape.
	return parseLegacyEntraSnapshot(snapshot)
}

export async function loader({ params }: LoaderFunctionArgs) {
	const { seksjon, rutineId, gjennomgangId } = params
	if (!seksjon || !rutineId || !gjennomgangId) {
		throw data({ message: "Mangler parametere" }, { status: 400 })
	}

	const section = await getSectionBySlug(seksjon)
	if (!section) {
		throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })
	}

	const routine = await getRoutine(rutineId)
	if (!routine) {
		throw data({ message: `Fant ikke rutine: ${rutineId}` }, { status: 404 })
	}

	const review = await getReview(gjennomgangId)
	if (!review) {
		throw data({ message: "Fant ikke gjennomgang" }, { status: 404 })
	}

	let applicationName: string | null = null
	if (review.applicationId) {
		const { getApplicationDetail } = await import("~/db/queries/nais.server")
		const appDetail = await getApplicationDetail(review.applicationId)
		applicationName = appDetail?.app.name ?? null
	}

	// Load activity data — auto-create activities for any draft review that is missing them.
	// This covers both legacy reviews created before the multi-activity system and reviews
	// that were created when the routine had no linked activities but later gained some.
	let activities = await getReviewActivities(gjennomgangId)
	if (review.status === "draft") {
		const routineLinks = await getRoutineActivityLinks(rutineId)
		const existingTypes = new Set(activities.map((a) => a.type))
		const needsBackfill = activities.length === 0 || routineLinks.some((l) => !existingTypes.has(l.activityType))
		if (needsBackfill) {
			await autoCreateActivitiesForReview(gjennomgangId, rutineId, review.applicationId, "system")
			activities = await getReviewActivities(gjennomgangId)
		}
	}

	// Build per-activity evidence data
	type EntraGroupsData = EntraStagedGroupsProp

	type OracleEvidenceData = {
		configuredInstances: Array<{ instanceId: string }>
		selectedInstanceId: string | null
		downloads: Array<{
			id: string
			instanceId: string
			evidenceType: string
			format: string
			fileName: string
			sizeBytes: number | null
			source: string
			apiInstanceName: string | null
			forceFetchJustification: string | null
			performedBy: string
			performedAt: string
		}>
		evidenceTypes: string[]
	}

	type NdaEvidenceData = {
		appParams: { team: string; environment: string; appName: string } | null
		periodConfig: { periodType: string; periodStart: string } | null
		downloads: Array<{
			id: string
			format: string
			fileName: string
			sizeBytes: number | null
			source: string
			forceFetchJustification: string | null
			performedBy: string
			performedAt: string
		}>
	}

	type ActivityWithEvidence = {
		id: string
		type: RoutineActivityType
		status: string
		completedAt: string | null
		createdAt: string
		providerConfig: unknown
		periodConfig: { periodType: string; periodStart: string } | null
		changes: Array<{
			id: string
			changeType: string
			groupId: string
			groupName: string | null
			previousValue: string | null
			newValue: string | null
			performedBy: string
			performedAt: string
		}>
		entraGroupsData: EntraGroupsData | null
		oracleEvidenceData: OracleEvidenceData | null
		ndaEvidenceData: NdaEvidenceData | null
		rpaMaintenanceData: RpaMaintenanceData | null
		evidenceProviderType: string | null
		evidenceLoadError?: string
	}

	const activitiesWithEvidence: ActivityWithEvidence[] = []

	// Cache Oracle instances per application (shared across all Oracle activities)
	let cachedOracleInstances: Array<{ instanceId: string }> | null = null

	for (const activity of activities) {
		let actEntraGroupsData: EntraGroupsData | null = null
		let actOracleEvidenceData: OracleEvidenceData | null = null
		let actNdaEvidenceData: NdaEvidenceData | null = null
		let actRpaMaintenanceData: RpaMaintenanceData | null = null
		const evidenceProviderType = getProviderTypeForActivity(activity.type)

		try {
			if (activity.type === "entra_id_group_maintenance") {
				if (activity.status === "completed") {
					actEntraGroupsData = getCompletedEntraGroupsData(activity.snapshotAfter)
				} else if (review.applicationId) {
					const stagedData = activity.stagedData
						? parseEntraStagedData(activity.stagedData)
						: await seedEntraActivity(activity.id, review.applicationId, "system")
					actEntraGroupsData = toEntraGroupsData(stagedData.groups)
				}
			}

			if (evidenceProviderType === "oracle" && review.applicationId) {
				const { getEvidenceDownloadsForActivityWithBucketDetails } = await import(
					"~/db/queries/evidence-downloads.server"
				)
				if (!cachedOracleInstances) {
					const { getOracleInstancesForApp } = await import("~/db/queries/audit-evidence.server")
					const instances = await getOracleInstancesForApp(review.applicationId)
					cachedOracleInstances = instances.map((i) => ({ instanceId: i.instanceId }))
				}
				const downloads = await getEvidenceDownloadsForActivityWithBucketDetails(activity.id)
				actOracleEvidenceData = {
					configuredInstances: cachedOracleInstances,
					selectedInstanceId: parseOracleInstanceFromProviderConfig(activity.providerConfig),
					downloads: downloads
						.map((d) => {
							if (d.providerType !== "oracle") {
								return null
							}

							const oracleMetadata = parseOracleProviderMetadata(d.providerMetadata)
							if (!oracleMetadata) {
								return null
							}

							return {
								id: d.id,
								instanceId: oracleMetadata.instanceId,
								evidenceType: oracleMetadata.evidenceType,
								format: d.format,
								fileName: d.fileName,
								sizeBytes: d.sizeBytes,
								source: d.source,
								apiInstanceName: oracleMetadata.apiInstanceName,
								forceFetchJustification: d.forceFetchJustification,
								performedBy: d.performedBy,
								performedAt: d.performedAt.toISOString(),
							}
						})
						.filter((download): download is NonNullable<typeof download> => download !== null),
					evidenceTypes: getEvidenceTypesForActivity(activity.type) ?? [],
				}
			}

			if (evidenceProviderType === "deployments") {
				const { getNdaAppParams } = await import("~/db/queries/deployment-audit.server")
				const { getEvidenceDownloadsForActivityWithBucketDetails } = await import(
					"~/db/queries/evidence-downloads.server"
				)
				const [appParams, downloads] = await Promise.all([
					review.applicationId ? getNdaAppParams(review.applicationId) : Promise.resolve(null),
					getEvidenceDownloadsForActivityWithBucketDetails(activity.id),
				])
				actNdaEvidenceData = {
					appParams,
					periodConfig: activity.periodConfig ?? null,
					downloads: downloads
						.filter((d) => d.providerType === "deployments")
						.map((d) => ({
							id: d.id,
							format: d.format,
							fileName: d.fileName,
							sizeBytes: d.sizeBytes,
							source: d.source,
							forceFetchJustification: d.forceFetchJustification,
							performedBy: d.performedBy,
							performedAt: d.performedAt.toISOString(),
						})),
				}
			}

			if (activity.type === "rpa_user_maintenance" && review.applicationId) {
				const { parseRpaStagedData, toRpaMaintenanceData, buildReadOnlyRpaData } = await import("~/lib/rpa-staged-data")

				if (activity.stagedData) {
					// Has staged_data — parse and convert
					actRpaMaintenanceData = toRpaMaintenanceData(parseRpaStagedData(activity.stagedData))
				} else if (activity.status === "pending") {
					// Pending without staged_data — seed it
					const { seedRpaActivity } = await import("~/db/queries/rpa.server")
					const stagedData = await seedRpaActivity(activity.id, "system")
					actRpaMaintenanceData = toRpaMaintenanceData(stagedData)
				} else if (activity.snapshotAfter) {
					// Completed/other status without staged_data — legacy activity, build read-only from snapshotAfter
					const readOnlyData = buildReadOnlyRpaData(activity.snapshotAfter)
					if (readOnlyData) {
						actRpaMaintenanceData = readOnlyData
					} else {
						// snapshotAfter has invalid shape — fall back to DB read
						const { getRpaUserAssessmentsForReview } = await import("~/db/queries/rpa.server")
						const assessments = await getRpaUserAssessmentsForReview(review.id)
						if (assessments.size > 0) {
							// Build users from entries() to use trimmed key as userObjectId (consistent with assessments keys)
							const users = [...assessments.entries()].map(([trimmedId, _a]) => ({
								userObjectId: trimmedId,
								displayName: null,
								userPrincipalName: null,
								accountEnabled: null,
								rpaGroupName: null,
								matchSource: "removed" as const,
							}))
							const assessmentEntries = Object.fromEntries(
								[...assessments.entries()].map(([id, a]) => [
									id,
									{
										id: a.id,
										owner: a.owner,
										needComment: a.needComment,
										criticalityComment: a.criticalityComment,
										securityComment: a.securityComment,
										decision: a.decision,
										decisionDeadline: a.decisionDeadline,
									},
								]),
							)
							actRpaMaintenanceData = { users, assessments: assessmentEntries }
						} else {
							actRpaMaintenanceData = { users: [], assessments: {} }
						}
					}
				} else {
					// Legacy activity without snapshotAfter — fall back to reading assessments from DB
					const { getRpaUserAssessmentsForReview } = await import("~/db/queries/rpa.server")
					const assessments = await getRpaUserAssessmentsForReview(review.id)
					if (assessments.size > 0) {
						// Build users from entries() to use trimmed key as userObjectId (consistent with assessments keys)
						const users = [...assessments.entries()].map(([trimmedId, _a]) => ({
							userObjectId: trimmedId,
							displayName: null,
							userPrincipalName: null,
							accountEnabled: null,
							rpaGroupName: null,
							// Legacy assessments without staged_data are ghosts — use "removed" to match isGone=true semantics
							matchSource: "removed" as const,
						}))
						const assessmentEntries = Object.fromEntries(
							[...assessments.entries()].map(([id, a]) => [
								id,
								{
									id: a.id,
									owner: a.owner,
									needComment: a.needComment,
									criticalityComment: a.criticalityComment,
									securityComment: a.securityComment,
									decision: a.decision,
									decisionDeadline: a.decisionDeadline,
								},
							]),
						)
						actRpaMaintenanceData = { users, assessments: assessmentEntries }
					} else {
						// No assessments — render empty state
						actRpaMaintenanceData = { users: [], assessments: {} }
					}
				}
			}
		} catch (err) {
			logger.error(
				`Failed to load evidence data for activity ${activity.id} (${activity.type})`,
				err instanceof Error ? err : { details: String(err) },
			)
			const evidenceLoadError =
				err instanceof Response && err.status === 409
					? "Gjennomgangen er låst av en annen operasjon. Prøv å laste siden på nytt om noen sekunder."
					: "Kunne ikke laste bevisdata. Prøv å laste siden på nytt."
			activitiesWithEvidence.push({
				id: activity.id,
				type: activity.type,
				status: activity.status,
				completedAt: activity.completedAt?.toISOString() ?? null,
				createdAt: activity.createdAt.toISOString(),
				providerConfig: activity.providerConfig,
				periodConfig: activity.periodConfig ?? null,
				changes: activity.changes.map((c) => ({
					...c,
					performedAt: c.performedAt.toISOString(),
				})),
				entraGroupsData: null,
				oracleEvidenceData: null,
				ndaEvidenceData: null,
				rpaMaintenanceData: null,
				evidenceProviderType,
				evidenceLoadError,
			})
			continue
		}

		activitiesWithEvidence.push({
			id: activity.id,
			type: activity.type,
			status: activity.status,
			completedAt: activity.completedAt?.toISOString() ?? null,
			createdAt: activity.createdAt.toISOString(),
			providerConfig: activity.providerConfig,
			periodConfig: activity.periodConfig ?? null,
			changes: activity.changes.map((c) => ({
				...c,
				performedAt: c.performedAt.toISOString(),
			})),
			entraGroupsData: actEntraGroupsData,
			oracleEvidenceData: actOracleEvidenceData,
			ndaEvidenceData: actNdaEvidenceData,
			rpaMaintenanceData: actRpaMaintenanceData,
			evidenceProviderType,
		})
	}

	// Load rulesets that share controls with this routine, filtered by screening selection when app is set
	const routineControlIds = routine.controls.map((c) => c.id)
	let linkedRulesets: Array<{
		id: string
		code: string | null
		name: string
		description: string | null
		frequency: string
		status: string
		responsibleName: string | null
		responsibleRole: string | null
		approvalStatus: string
		lastApproval: { validFrom: string; validUntil: string } | null
		controls: Array<{ id: string; controlId: string; shortTitle: string | null }>
	}> = []
	if (routineControlIds.length > 0) {
		const { getRulesetsLinkedToControls, getRulesetIdsSelectedByApp } = await import("~/db/queries/rulesets.server")

		if (review.applicationId) {
			const [allLinked, selectedIds] = await Promise.all([
				getRulesetsLinkedToControls(routineControlIds, routine.sectionId),
				getRulesetIdsSelectedByApp(review.applicationId),
			])
			linkedRulesets = allLinked.filter((rs) => selectedIds.has(rs.id))
		} else {
			linkedRulesets = await getRulesetsLinkedToControls(routineControlIds, routine.sectionId)
		}
	}

	// Render ruleset descriptions as HTML
	const linkedRulesetsWithHtml = linkedRulesets.map((rs) => ({
		...rs,
		descriptionHtml: renderMarkdown(rs.description),
	}))

	const routineDescriptionHtml = renderMarkdown(routine.description)

	return data({
		section,
		routine,
		routineDescriptionHtml,
		linkedRulesets: linkedRulesetsWithHtml,
		activities: activitiesWithEvidence,
		review: {
			...review,
			applicationName,
			reviewedAt: review.reviewedAt.toISOString(),
			createdAt: review.createdAt.toISOString(),
			summaryHtml: renderMarkdown(review.summary),
			participants: review.participants.map((p) => ({
				...p,
				confirmedAt: p.confirmedAt?.toISOString() ?? null,
			})),
			attachments: review.attachments.map((a) => ({
				...a,
				uploadedAt: a.uploadedAt.toISOString(),
			})),
			links: review.links.map((l) => ({
				...l,
				addedAt: l.addedAt.toISOString(),
			})),
			followUpPoints: review.followUpPoints.map((p) => ({
				...p,
				createdAt: p.createdAt.toISOString(),
				updatedAt: p.updatedAt.toISOString(),
				resolvedAt: p.resolvedAt?.toISOString() ?? null,
				attachments: p.attachments.map((a) => ({
					...a,
					uploadedAt: a.uploadedAt.toISOString(),
				})),
			})),
		},
	})
}

export async function action({ request, params }: ActionFunctionArgs) {
	const { gjennomgangId } = params
	if (!gjennomgangId) {
		throw data({ message: "Mangler parametere" }, { status: 400 })
	}

	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)

	const formData = await request.formData()
	const intent = formData.get("intent") as string

	// Soft-delete-guard: enhver mutasjon på en gjennomgang som tilhører en
	// arkivert rutine blokkeres med 403. Brukeren må reaktivere rutinen først.
	// Dette er forsvar i dybden — query-laget guarder også enkelt-operasjoner.
	// Lettvekts JOIN-spørring (ikke full getReview()/getRoutine()) for å unngå
	// unødvendige subqueries per POST.
	const archiveStatus = await getRoutineArchivedStatusByReviewId(gjennomgangId)
	if (archiveStatus?.archivedAt) {
		throw data(
			{ message: "Kan ikke endre gjennomganger på en arkivert rutine. Reaktiver rutinen først." },
			{ status: 403 },
		)
	}

	if (intent === "update-review") {
		// Only update fields that are actually present in the form submission.
		// Each wizard step sends only its own fields — absent fields must not overwrite existing data.
		const hasTitle = formData.has("title")
		const hasSummary = formData.has("summary")
		const hasReviewedAt = formData.has("reviewedAt")
		const hasParticipants = formData.has("participants")

		const title = hasTitle ? (formData.get("title") as string).trim() : undefined
		const summary = hasSummary ? (formData.get("summary") as string)?.trim() || null : undefined
		const reviewedAt = hasReviewedAt ? (formData.get("reviewedAt") as string) : undefined
		const reviewedTime = (formData.get("reviewedTime") as string) || "00:00"
		const participants = hasParticipants ? parseParticipantsFormValue(formData.get("participants")) : undefined

		if (hasTitle && !title) {
			return data<ActionResult>({ success: false, error: "Tittel er påkrevd", intent: "update-review" })
		}

		await updateReview(
			gjennomgangId,
			{
				title,
				summary,
				reviewedAt: reviewedAt ? new Date(`${reviewedAt}T${reviewedTime}`) : undefined,
				participants,
			},
			authedUser.navIdent,
		)

		return data<ActionResult>({ success: true, intent: "update-review" })
	}

	if (intent === "complete") {
		const review = await getReview(gjennomgangId)
		if (!review) {
			return data<ActionResult>({ success: false, error: "Fant ikke gjennomgang", intent: "complete" })
		}
		if (review.status !== "draft") {
			const error =
				review.status === "completed"
					? "Gjennomgangen er allerede fullført."
					: review.status === "needs_follow_up"
						? "Gjennomgangen er allerede fullført, men har oppfølgingspunkter som må adresseres."
						: review.status === "discarded"
							? "Gjennomgangen er forkastet og kan ikke fullføres."
							: "Kun utkast kan fullføres."
			return data<ActionResult>({
				success: false,
				error,
				intent: "complete",
			})
		}

		const updated = await completeReview(gjennomgangId, authedUser.navIdent).catch((err) => {
			if (err instanceof Response) return err
			throw err
		})

		if (updated instanceof Response) {
			const errorText = await updated.text()
			return data<ActionResult>({
				success: false,
				error: errorText || "Kunne ikke fullføre gjennomgang.",
				intent: "complete",
			})
		}

		return data<ActionResult>({
			success: true,
			intent: "complete",
		})
	}

	if (intent === "discard-review") {
		const { seksjon, rutineId } = params
		const result = await discardReview(gjennomgangId, authedUser.navIdent)
		if (!result) {
			return data<ActionResult>({
				success: false,
				error: "Kun gjennomganger med status utkast kan forkastes.",
				intent: "discard-review",
			})
		}
		return redirect(`/seksjoner/${seksjon}/rutiner/${rutineId}`)
	}

	if (intent === "add-link") {
		const url = (formData.get("url") as string)?.trim()
		const title = (formData.get("linkTitle") as string)?.trim() || null
		if (!url) {
			return data<ActionResult>({ success: false, error: "URL er påkrevd", intent: "add-link" })
		}
		try {
			const parsed = new URL(url)
			const safeProtocols = new Set(["http:", "https:", "mailto:"])
			if (!safeProtocols.has(parsed.protocol)) {
				return data<ActionResult>({ success: false, error: "Kun http, https og mailto er tillatt", intent: "add-link" })
			}
		} catch {
			return data<ActionResult>({ success: false, error: "Ugyldig URL", intent: "add-link" })
		}
		await addReviewLink({ reviewId: gjennomgangId, url, title, addedBy: authedUser.navIdent })
		return data<ActionResult>({ success: true, intent: "add-link" })
	}

	if (intent === "delete-link") {
		const linkId = formData.get("linkId") as string
		if (!linkId) {
			return data<ActionResult>({ success: false, error: "Mangler lenke-ID", intent: "delete-link" })
		}
		const deleted = await deleteReviewLink(linkId, gjennomgangId, authedUser.navIdent)
		if (!deleted) {
			return data<ActionResult>({ success: false, error: "Fant ikke lenken.", intent: "delete-link" }, { status: 404 })
		}
		return data<ActionResult>({ success: true, intent: "delete-link" })
	}

	if (intent === "add-manual-group") {
		const groupId = (formData.get("groupId") as string)?.trim()
		const groupName = (formData.get("groupName") as string)?.trim() || null
		if (!groupId) {
			return data<ActionResult>({ success: false, error: "Mangler gruppe-ID", intent: "add-manual-group" })
		}
		const review = await getReview(gjennomgangId)
		if (!review?.applicationId) {
			return data<ActionResult>({ success: false, error: "Ingen applikasjon", intent: "add-manual-group" })
		}
		const activity = await getReviewActivityByType(gjennomgangId, "entra_id_group_maintenance")
		if (!activity) {
			return data<ActionResult>(
				{ success: false, error: "Fant ikke Entra-aktivitet", intent: "add-manual-group" },
				{ status: 404 },
			)
		}
		try {
			await patchEntraActivity(activity.id, { op: "add-group", groupId, groupName }, authedUser.navIdent)
		} catch (e) {
			if (e instanceof Response) {
				const error = e.status === 409 ? "Gjennomgangen er låst av en annen operasjon. Prøv igjen." : await e.text()
				return data<ActionResult>({ success: false, error, intent: "add-manual-group" }, { status: e.status })
			}
			throw e
		}

		return data<ActionResult>({ success: true, intent: "add-manual-group" })
	}

	if (intent === "remove-manual-group") {
		const groupId = (formData.get("groupId") as string)?.trim()
		if (!groupId) {
			return data<ActionResult>({ success: false, error: "Mangler gruppe-ID", intent: "remove-manual-group" })
		}
		const review = await getReview(gjennomgangId)
		if (!review?.applicationId) {
			return data<ActionResult>({ success: false, error: "Ingen applikasjon", intent: "remove-manual-group" })
		}
		const activity = await getReviewActivityByType(gjennomgangId, "entra_id_group_maintenance")
		if (!activity) {
			return data<ActionResult>(
				{ success: false, error: "Fant ikke Entra-aktivitet", intent: "remove-manual-group" },
				{ status: 404 },
			)
		}
		let stagedDataRemove: ReturnType<typeof parseEntraStagedData>
		try {
			stagedDataRemove = activity.stagedData
				? parseEntraStagedData(activity.stagedData)
				: await seedEntraActivity(activity.id, review.applicationId, authedUser.navIdent)
		} catch (e) {
			if (e instanceof Response) {
				const error = e.status === 409 ? "Gjennomgangen er låst av en annen operasjon. Prøv igjen." : await e.text()
				return data<ActionResult>({ success: false, error, intent: "remove-manual-group" }, { status: e.status })
			}
			throw e
		}
		const group = stagedDataRemove.groups.find((entry) => entry.groupId === groupId) ?? null
		if (!group) {
			return data<ActionResult>(
				{ success: false, error: "Fant ikke gruppe", intent: "remove-manual-group" },
				{ status: 404 },
			)
		}
		if (group.isGone) {
			return data<ActionResult>({ success: true, intent: "remove-manual-group" })
		}
		if (group.hasNaisSource && !group.hasManualSource) {
			// Idempotency: if seededManualGroupId is set, the manual source was already removed
			// (via remove-manual-source). A stale remove-manual-group is a no-op.
			if (group.seededManualGroupId !== null) {
				return data<ActionResult>({ success: true, intent: "remove-manual-group" })
			}
			return data<ActionResult>(
				{ success: false, error: "Kan ikke fjerne en ren NAIS-gruppe manuelt", intent: "remove-manual-group" },
				{ status: 400 },
			)
		}

		try {
			await patchEntraActivity(
				activity.id,
				group.hasNaisSource && group.hasManualSource
					? { op: "remove-manual-source", groupId }
					: { op: "mark-gone", groupId },
				authedUser.navIdent,
			)
		} catch (e) {
			if (e instanceof Response) {
				const error = e.status === 409 ? "Gjennomgangen er låst av en annen operasjon. Prøv igjen." : await e.text()
				return data<ActionResult>({ success: false, error, intent: "remove-manual-group" }, { status: e.status })
			}
			throw e
		}

		return data<ActionResult>({ success: true, intent: "remove-manual-group" })
	}

	if (intent === "set-group-criticality") {
		const groupId = (formData.get("groupId") as string)?.trim()
		const criticality = (formData.get("criticality") as string)?.trim()
		if (!groupId || !criticality || !groupCriticalityEnum.includes(criticality as GroupCriticality)) {
			return data<ActionResult>({ success: false, error: "Mangler data", intent: "set-group-criticality" })
		}
		const review = await getReview(gjennomgangId)
		if (!review?.applicationId) {
			return data<ActionResult>({ success: false, error: "Ingen applikasjon", intent: "set-group-criticality" })
		}
		const activity = await getReviewActivityByType(gjennomgangId, "entra_id_group_maintenance")
		if (!activity) {
			return data<ActionResult>(
				{ success: false, error: "Fant ikke Entra-aktivitet", intent: "set-group-criticality" },
				{ status: 404 },
			)
		}
		let stagedDataCriticality: ReturnType<typeof parseEntraStagedData>
		try {
			stagedDataCriticality = activity.stagedData
				? parseEntraStagedData(activity.stagedData)
				: await seedEntraActivity(activity.id, review.applicationId, authedUser.navIdent)
		} catch (e) {
			if (e instanceof Response) {
				const error = e.status === 409 ? "Gjennomgangen er låst av en annen operasjon. Prøv igjen." : await e.text()
				return data<ActionResult>({ success: false, error, intent: "set-group-criticality" }, { status: e.status })
			}
			throw e
		}
		const group = stagedDataCriticality.groups.find((entry) => entry.groupId === groupId) ?? null
		if (!group) {
			return data<ActionResult>(
				{ success: false, error: "Fant ikke gruppe", intent: "set-group-criticality" },
				{ status: 404 },
			)
		}
		if (group.isGone) {
			return data<ActionResult>(
				{ success: false, error: "Kan ikke endre kritikalitet for en fjernet gruppe", intent: "set-group-criticality" },
				{ status: 400 },
			)
		}

		if (group.criticality === criticality) {
			return data<ActionResult>({ success: true, intent: "set-group-criticality" })
		}

		try {
			await patchEntraActivity(
				activity.id,
				{
					op: "set-criticality",
					groupId,
					criticality: criticality as GroupCriticality,
					setBy: authedUser.navIdent,
					setAt: new Date().toISOString(),
				},
				authedUser.navIdent,
			)
		} catch (e) {
			if (e instanceof Response) {
				const error = e.status === 409 ? "Gjennomgangen er låst av en annen operasjon. Prøv igjen." : await e.text()
				return data<ActionResult>({ success: false, error, intent: "set-group-criticality" }, { status: e.status })
			}
			throw e
		}

		return data<ActionResult>({ success: true, intent: "set-group-criticality" })
	}

	if (intent === "add-follow-up") {
		const text = (formData.get("text") as string)?.trim()
		const description = (formData.get("description") as string)?.trim() || null
		if (!text) {
			return data<ActionResult>({ success: false, error: "Tittel er påkrevd", intent: "add-follow-up" })
		}
		await addFollowUpPoint({ reviewId: gjennomgangId, text, description, performedBy: authedUser.navIdent })
		return data<ActionResult>({ success: true, intent: "add-follow-up" })
	}

	if (intent === "update-follow-up-status") {
		const pointId = (formData.get("pointId") as string)?.trim()
		const status = (formData.get("status") as string)?.trim() as FollowUpPointStatus
		if (!pointId || !FOLLOW_UP_POINT_STATUSES.includes(status)) {
			return data<ActionResult>({ success: false, error: "Mangler data", intent: "update-follow-up-status" })
		}
		const resolutionRaw = formData.get("resolution")
		const resolution = resolutionRaw === null ? undefined : (resolutionRaw as string)
		const isResolving = status === "completed" || status === "not_relevant"
		if (isResolving && (typeof resolution !== "string" || resolution.trim().length === 0)) {
			return data<ActionResult>({
				success: false,
				error: "Oppfølging er påkrevd.",
				intent: "update-follow-up-status",
			})
		}
		await updateFollowUpPointStatus({
			pointId,
			expectedReviewId: gjennomgangId,
			status,
			resolution: isResolving ? resolution : undefined,
			performedBy: authedUser.navIdent,
		})
		return data<ActionResult>({
			success: true,
			intent: "update-follow-up-status",
			pointId,
		})
	}

	if (intent === "update-follow-up-text") {
		const pointId = (formData.get("pointId") as string)?.trim()
		const text = (formData.get("text") as string)?.trim()
		if (!pointId || !text) {
			return data<ActionResult>({ success: false, error: "Mangler data", intent: "update-follow-up-text" })
		}
		await updateFollowUpPointText({
			pointId,
			expectedReviewId: gjennomgangId,
			text,
			performedBy: authedUser.navIdent,
		})
		return data<ActionResult>({
			success: true,
			intent: "update-follow-up-text",
			pointId,
		})
	}

	if (intent === "update-follow-up-description") {
		const pointId = (formData.get("pointId") as string)?.trim()
		const description = (formData.get("description") as string) ?? ""
		if (!pointId) {
			return data<ActionResult>({ success: false, error: "Mangler ID", intent: "update-follow-up-description" })
		}
		if (description.trim().length === 0) {
			return data<ActionResult>({
				success: false,
				error: "Beskrivelse er påkrevd.",
				intent: "update-follow-up-description",
			})
		}
		await updateFollowUpPointDescription({
			pointId,
			expectedReviewId: gjennomgangId,
			description,
			performedBy: authedUser.navIdent,
		})
		return data<ActionResult>({
			success: true,
			intent: "update-follow-up-description",
			pointId,
		})
	}

	if (intent === "delete-follow-up") {
		const pointId = (formData.get("pointId") as string)?.trim()
		if (!pointId) {
			return data<ActionResult>({ success: false, error: "Mangler ID", intent: "delete-follow-up" })
		}
		await deleteFollowUpPoint({ pointId, expectedReviewId: gjennomgangId, performedBy: authedUser.navIdent })
		return data<ActionResult>({ success: true, intent: "delete-follow-up" })
	}

	if (intent === "save-rpa-user-assessment") {
		const rawUserObjectId = formData.get("userObjectId")
		if (typeof rawUserObjectId !== "string" || !rawUserObjectId.trim()) {
			return data<ActionResult>(
				{ success: false, error: "Mangler bruker-ID", intent: "save-rpa-user-assessment" },
				{ status: 400 },
			)
		}
		const userObjectId = rawUserObjectId.trim()

		// Use lightweight lookup — only need the activity ID for patching
		const rpaActivityId = await getReviewActivityIdByType(gjennomgangId, "rpa_user_maintenance")
		if (!rpaActivityId) {
			return data<ActionResult>(
				{
					success: false,
					error: "Gjennomgangen har ingen RPA-vedlikeholdsaktivitet",
					intent: "save-rpa-user-assessment",
				},
				{ status: 404 },
			)
		}

		const fields: {
			owner?: string | null
			needComment?: string | null
			criticalityComment?: string | null
			securityComment?: string | null
			decision?: (typeof RPA_DECISION_VALUES)[number] | null
			decisionDeadline?: string | null
		} = {}
		for (const key of ["owner", "needComment", "criticalityComment", "securityComment"] as const) {
			const val = formData.get(key)
			if (val !== null) {
				if (typeof val !== "string") {
					return data<ActionResult>(
						{ success: false, error: `Ugyldig verdi for felt: ${key}`, intent: "save-rpa-user-assessment" },
						{ status: 400 },
					)
				}
				fields[key] = val.trim() || null
			}
		}
		const rawDecision = formData.get("decision")
		if (rawDecision !== null) {
			if (typeof rawDecision !== "string") {
				return data<ActionResult>(
					{ success: false, error: "Ugyldig beslutningsverdi", intent: "save-rpa-user-assessment" },
					{ status: 400 },
				)
			}
			const trimmed = rawDecision.trim()
			if (trimmed && !(RPA_DECISION_VALUES as readonly string[]).includes(trimmed)) {
				return data<ActionResult>(
					{ success: false, error: "Ugyldig beslutning", intent: "save-rpa-user-assessment" },
					{ status: 400 },
				)
			}
			const validDecision = trimmed ? (trimmed as (typeof RPA_DECISION_VALUES)[number]) : null
			fields.decision = validDecision
			// Clear deadline when decision no longer requires one
			if (validDecision !== "avvikles" && validDecision !== "endres") {
				fields.decisionDeadline = null
			}
		}
		// Read decisionDeadline independently — the field can be submitted alone via onBlur
		// without resending the current decision value. Skip if already nulled by decision change above.
		if (fields.decisionDeadline === undefined) {
			const rawDeadline = formData.get("decisionDeadline")
			if (rawDeadline !== null) {
				if (typeof rawDeadline !== "string") {
					return data<ActionResult>(
						{ success: false, error: "Ugyldig datoformat", intent: "save-rpa-user-assessment" },
						{ status: 400 },
					)
				}
				const trimmedDeadline = rawDeadline.trim()
				if (trimmedDeadline && !/^\d{4}-\d{2}-\d{2}$/.test(trimmedDeadline)) {
					return data<ActionResult>(
						{
							success: false,
							error: "Ugyldig datoformat (forventet ÅÅÅÅ-MM-DD)",
							intent: "save-rpa-user-assessment",
						},
						{ status: 400 },
					)
				}
				if (trimmedDeadline) {
					const [y, m, d] = trimmedDeadline.split("-").map(Number)
					const parsed = new Date(Date.UTC(y, m - 1, d))
					if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() + 1 !== m || parsed.getUTCDate() !== d) {
						return data<ActionResult>(
							{ success: false, error: "Ugyldig dato", intent: "save-rpa-user-assessment" },
							{ status: 400 },
						)
					}
				}
				fields.decisionDeadline = trimmedDeadline || null
			}
		}
		if (Object.keys(fields).length === 0) {
			return data<ActionResult>(
				{ success: false, error: "Ingen felt å lagre", intent: "save-rpa-user-assessment" },
				{ status: 400 },
			)
		}
		const { patchRpaActivity } = await import("~/db/queries/rpa.server")
		try {
			await patchRpaActivity(rpaActivityId, { op: "set-assessment", userObjectId, ...fields }, authedUser.navIdent)
		} catch (e) {
			if (e instanceof Response) {
				const responseText = await e.text()
				// Use response text if available; only fallback to lock message for empty 409 responses
				const fallback = e.status === 409 ? "Gjennomgangen er låst av en annen operasjon. Prøv igjen." : "Ukjent feil"
				const error = responseText || fallback
				return data<ActionResult>({ success: false, error, intent: "save-rpa-user-assessment" }, { status: e.status })
			}
			throw e
		}
		return data<ActionResult>({ success: true, intent: "save-rpa-user-assessment" })
	}

	return data<ActionResult>({ success: false, error: "Ukjent handling" })
}

export default function GjennomgangDetalj() {
	const { section, routine, routineDescriptionHtml, linkedRulesets, review, activities } =
		useLoaderData<typeof loader>()
	const isDraft = review.status === "draft"

	const hasControls = routine.controls.length > 0
	const hasRulesets = linkedRulesets.length > 0

	// Build ActivityStepInfo[] from the review's frozen activities (not the routine's current config)
	const activityStepInfos: ActivityStepInfo[] = activities.map((a) => ({
		id: a.id,
		activityType: a.type,
	}))

	const [searchParams, setSearchParams] = useSearchParams()
	const stepParam = searchParams.get("step")

	// Default to first step
	const steps = buildSteps({ hasControls, hasRulesets, activities: activityStepInfos })
	const currentStepId = steps.find((s) => s.id === stepParam)?.id ?? steps[0]?.id ?? "innledning"

	const handleStepChange = useCallback(
		(stepId: string) => {
			setSearchParams(
				(prev) => {
					const next = new URLSearchParams(prev)
					next.set("step", stepId)
					return next
				},
				{ replace: true },
			)
		},
		[setSearchParams],
	)

	// Determine which steps are "completed" (have data)
	const completedSteps = useMemo(() => {
		const completed = new Set<string>()
		// Innledning is always done if the review exists
		completed.add("innledning")
		// Read-only steps are always "completed"
		if (hasControls) completed.add("krav")
		if (hasRulesets) completed.add("regelsett")
		completed.add("rutine")
		// Each activity step is completed if the corresponding review activity has status "completed"
		for (let i = 0; i < activityStepInfos.length; i++) {
			const reviewActivity = activities.find((a) => a.type === activityStepInfos[i].activityType)
			if (reviewActivity?.status === "completed") {
				completed.add(`aktivitet-${i}`)
			}
		}
		// Dokumentasjon is completed if there's summary text, attachments, or links
		if (review.summary || review.attachments.length > 0 || review.links.length > 0) completed.add("dokumentasjon")
		// Follow-ups is completed if there are points
		if (review.followUpPoints.length > 0) completed.add("oppfolging")
		// Fullfør is completed if review is completed
		if (review.status === "completed" || review.status === "needs_follow_up") completed.add("fullfor")
		return completed
	}, [hasControls, hasRulesets, activities, activityStepInfos, review])

	function renderStep() {
		// Check if current step is a dynamic activity step
		const activityIndex = parseActivityStepIndex(currentStepId)
		if (activityIndex !== null && activityIndex < activityStepInfos.length) {
			const activityType = activityStepInfos[activityIndex].activityType
			const activity = activities.find((a) => a.type === activityType) ?? null

			if (activity?.type === "entra_id_group_maintenance" && activity.entraGroupsData) {
				return (
					<EntraMaintenanceSection activity={activity} entraGroupsData={activity.entraGroupsData} isDraft={isDraft} />
				)
			}
			if (activity?.type === "rpa_user_maintenance" && activity.rpaMaintenanceData) {
				return (
					<RpaUserMaintenanceSection
						activity={activity}
						rpaMaintenanceData={activity.rpaMaintenanceData}
						isDraft={isDraft}
					/>
				)
			}
			return (
				<StepActivity
					activity={activity}
					entraGroupsData={activity?.entraGroupsData ?? null}
					oracleEvidenceData={activity?.oracleEvidenceData ?? null}
					ndaEvidenceData={activity?.ndaEvidenceData ?? null}
					evidenceProviderType={activity?.evidenceProviderType ?? null}
					evidenceLoadError={activity?.evidenceLoadError}
					isDraft={isDraft}
				/>
			)
		}

		switch (currentStepId) {
			case "innledning":
				return <StepIntroduction review={review} isDraft={isDraft} />
			case "krav":
				return <StepControls controls={routine.controls} />
			case "regelsett":
				return <StepRulesets rulesets={linkedRulesets} sectionSlug={section.slug} />
			case "rutine":
				return (
					<StepRoutine routine={routine} routineDescriptionHtml={routineDescriptionHtml} sectionSlug={section.slug} />
				)
			case "dokumentasjon":
				return (
					<VStack gap="space-12">
						<StepSummary review={review} isDraft={isDraft} />
						<StepAttachments reviewId={review.id} attachments={review.attachments} isDraft={isDraft} />
					</VStack>
				)
			case "oppfolging":
				return <FollowUpPointsSection reviewId={review.id} status={review.status} points={review.followUpPoints} />
			case "fullfor":
				return <StepComplete review={review} isDraft={isDraft} />
			default:
				return null
		}
	}

	return (
		<ReviewWizard
			title={review.title}
			status={review.status}
			hasControls={hasControls}
			hasRulesets={hasRulesets}
			activities={activityStepInfos}
			currentStepId={currentStepId}
			completedSteps={completedSteps}
			onStepChange={handleStepChange}
		>
			{renderStep()}
		</ReviewWizard>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
