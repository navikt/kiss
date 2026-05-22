import { DownloadIcon, ExternalLinkIcon, PlusIcon, TrashIcon } from "@navikt/aksel-icons"
import type { FileObject, SortState } from "@navikt/ds-react"
import {
	Alert,
	BodyShort,
	Box,
	Button,
	CopyButton,
	Detail,
	Dialog,
	Heading,
	HStack,
	ReadMore,
	Search,
	Select,
	Table,
	Tag,
	Textarea,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import {
	data,
	Form,
	redirect,
	useActionData,
	useFetcher,
	useLoaderData,
	useNavigation,
	useRevalidator,
	useSearchParams,
} from "react-router"
import { AutoUploadDropzone } from "~/components/AutoUploadDropzone"
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
	getRoutine,
	getRoutineActivityLinks,
	getRoutineArchivedStatusByReviewId,
	hasReviewActivityType,
	recordEntraChange,
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
import { logger } from "~/lib/logger.server"
import { renderMarkdown } from "~/lib/markdown.server"
import { parseParticipantsFormValue } from "~/lib/participants"
import {
	type RpaMaintenanceData,
	type RpaUserAssessmentEntry,
	type RpaUserEntry,
	RpaUserMaintenanceSection,
} from "./components/activities/RpaUserMaintenanceSection"
import { ReviewWizard } from "./components/ReviewWizard"
import { StepActivity } from "./components/StepActivity"
import { StepAttachments } from "./components/StepAttachments"
import { StepComplete } from "./components/StepComplete"
import { StepControls } from "./components/StepControls"
import { StepIntroduction } from "./components/StepIntroduction"
import { StepRoutine } from "./components/StepRoutine"
import { StepRulesets } from "./components/StepRulesets"
import { StepSummary } from "./components/StepSummary"
import { type ActivityProp, type ActivityStepInfo, buildSteps, parseActivityStepIndex } from "./components/shared"

const MAX_SIZE_MB = 50
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024

type ActionResult = {
	success: boolean
	error?: string
	intent?: string
	pointId?: string
}

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
	let appAuthIntegrations: Array<{ type: string; groups: string | null; allowAllUsers?: boolean | null }> = []
	if (review.applicationId) {
		const { getApplicationDetail } = await import("~/db/queries/nais.server")
		const appDetail = await getApplicationDetail(review.applicationId)
		applicationName = appDetail?.app.name ?? null
		appAuthIntegrations = appDetail?.authIntegrations ?? []
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
	type EntraGroupsData = {
		naisGroupIds: string[]
		manualGroups: Array<{ id: string; groupId: string; groupName: string | null; createdBy: string; createdAt: string }>
		ghostGroupIds: string[]
		groupNames: Record<string, string>
		assessmentsByGroupId: Record<string, { criticality: string; updatedBy: string; updatedAt: string }>
	}

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
			if (activity.type === "entra_id_group_maintenance" && review.applicationId) {
				const { getManualGroupsForApp, getGroupAssessmentsForApp } = await import("~/db/queries/nais.server")
				const { resolveGroupNames } = await import("~/lib/graph.server")
				const [manualGroups, groupAssessments] = await Promise.all([
					getManualGroupsForApp(review.applicationId),
					getGroupAssessmentsForApp(review.applicationId),
				])
				const naisGroupIds: string[] = []
				for (const auth of appAuthIntegrations) {
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
				actEntraGroupsData = {
					naisGroupIds,
					manualGroups: manualGroups.map((g) => ({ ...g, createdAt: g.createdAt.toISOString() })),
					ghostGroupIds,
					groupNames,
					assessmentsByGroupId,
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
				const { getRpaUsersForApp, getRpaUserAssessmentsForReview } = await import("~/db/queries/rpa.server")
				const { getManualGroupsForApp } = await import("~/db/queries/nais.server")
				const naisGroupIds: string[] = []
				for (const auth of appAuthIntegrations) {
					if (auth.groups) {
						const groups = JSON.parse(auth.groups) as string[]
						naisGroupIds.push(...groups)
					}
				}
				const hasAllowAllUsers = appAuthIntegrations.some(
					(auth) => auth.type === "entra_id" && auth.allowAllUsers === true,
				)
				const manualGroups = await getManualGroupsForApp(review.applicationId)
				const [rpaUsers, assessmentsMap] = await Promise.all([
					getRpaUsersForApp(
						naisGroupIds,
						manualGroups.map((g) => g.groupId),
						hasAllowAllUsers,
					),
					getRpaUserAssessmentsForReview(gjennomgangId),
				])
				const assessments: Record<string, RpaUserAssessmentEntry> = {}
				for (const [objectId, a] of assessmentsMap) {
					assessments[objectId] = {
						id: a.id,
						owner: a.owner,
						needComment: a.needComment,
						criticalityComment: a.criticalityComment,
						securityComment: a.securityComment,
						decision: a.decision,
						decisionDeadline: a.decisionDeadline,
					}
				}
				const rpaUserIds = new Set(rpaUsers.map((u) => u.userObjectId))
				// Include users that have saved assessments but are no longer returned by getRpaUsersForApp
				// (e.g. removed from app access) so their decisions remain visible in the review.
				const ghostUsers: RpaUserEntry[] = [...assessmentsMap.keys()]
					.filter((id) => !rpaUserIds.has(id))
					.map((id) => ({
						userObjectId: id,
						displayName: null,
						userPrincipalName: null,
						accountEnabled: null,
						rpaGroupName: null,
						matchSource: "removed",
					}))
				actRpaMaintenanceData = {
					users: [
						...rpaUsers.map((u) => ({
							userObjectId: u.userObjectId,
							displayName: u.displayName,
							userPrincipalName: u.userPrincipalName,
							accountEnabled: u.accountEnabled,
							rpaGroupName: u.rpaGroupName,
							matchSource: u.matchSource,
						})),
						...ghostUsers,
					],
					assessments,
				}
			}
		} catch (err) {
			logger.error(`Failed to load evidence data for activity ${activity.id} (${activity.type})`, {
				error: err,
			})
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
				evidenceLoadError: "Kunne ikke laste bevisdata. Prøv å laste siden på nytt.",
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

	// Load rulesets that share controls with this routine
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
		const { getRulesetsLinkedToControls } = await import("~/db/queries/rulesets.server")
		linkedRulesets = await getRulesetsLinkedToControls(routineControlIds, routine.sectionId)
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
			return data<ActionResult>({ success: false, error: "Ingen applikasjon tilknyttet", intent: "add-manual-group" })
		}
		const { addManualGroup } = await import("~/db/queries/nais.server")
		await addManualGroup(review.applicationId, groupId, groupName, authedUser.navIdent)
		const activity = await getReviewActivityByType(gjennomgangId, "entra_id_group_maintenance")
		if (activity) {
			await recordEntraChange({
				activityId: activity.id,
				changeType: "added",
				groupId,
				groupName,
				previousValue: null,
				newValue: groupName ?? groupId,
				performedBy: authedUser.navIdent,
			})
		}
		return data<ActionResult>({ success: true, intent: "add-manual-group" })
	}

	if (intent === "remove-manual-group") {
		const manualGroupId = (formData.get("manualGroupId") as string)?.trim()
		const groupId = (formData.get("groupId") as string)?.trim() || null
		const groupName = (formData.get("groupName") as string)?.trim() || null
		if (!manualGroupId) {
			return data<ActionResult>({ success: false, error: "Mangler ID", intent: "remove-manual-group" })
		}
		const review = await getReview(gjennomgangId)
		if (!review?.applicationId) {
			return data<ActionResult>({ success: false, error: "Ingen applikasjon", intent: "remove-manual-group" })
		}
		const { removeManualGroup } = await import("~/db/queries/nais.server")
		await removeManualGroup(manualGroupId, review.applicationId, authedUser.navIdent)
		const activity = await getReviewActivityByType(gjennomgangId, "entra_id_group_maintenance")
		if (activity && groupId) {
			await recordEntraChange({
				activityId: activity.id,
				changeType: "removed",
				groupId,
				groupName,
				previousValue: groupName ?? groupId,
				newValue: null,
				performedBy: authedUser.navIdent,
			})
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
		const { getGroupAssessmentsForApp, upsertGroupCriticality } = await import("~/db/queries/nais.server")
		const existingAssessments = await getGroupAssessmentsForApp(review.applicationId)
		const previousCriticality = existingAssessments.find((a) => a.groupId === groupId)?.criticality ?? null
		await upsertGroupCriticality(review.applicationId, groupId, criticality as GroupCriticality, authedUser.navIdent)
		const activity = await getReviewActivityByType(gjennomgangId, "entra_id_group_maintenance")
		if (activity && previousCriticality !== criticality) {
			await recordEntraChange({
				activityId: activity.id,
				changeType: "criticality_changed",
				groupId,
				groupName: null,
				previousValue: previousCriticality,
				newValue: criticality,
				performedBy: authedUser.navIdent,
			})
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
		// Verify the review actually has an rpa_user_maintenance activity (lightweight EXISTS check)
		if (!(await hasReviewActivityType(gjennomgangId, "rpa_user_maintenance"))) {
			return data<ActionResult>(
				{
					success: false,
					error: "Gjennomgangen har ingen RPA-vedlikeholdsaktivitet",
					intent: "save-rpa-user-assessment",
				},
				{ status: 403 },
			)
		}
		const { upsertRpaUserAssessment } = await import("~/db/queries/rpa.server")
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
		await upsertRpaUserAssessment(gjennomgangId, userObjectId, authedUser.navIdent, fields)
		return data<ActionResult>({ success: true, intent: "save-rpa-user-assessment" })
	}

	return data<ActionResult>({ success: false, error: "Ukjent handling" })
}

function formatDate(dateStr: string) {
	return new Date(dateStr).toLocaleDateString("nb-NO", {
		day: "numeric",
		month: "long",
		year: "numeric",
	})
}

function formatDateTime(dateStr: string) {
	const d = new Date(dateStr)
	return d.toLocaleDateString("nb-NO", {
		day: "numeric",
		month: "long",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	})
}

function formatFileSize(bytes: number | null) {
	if (!bytes) return "—"
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const groupCriticalityLabels: Record<string, string> = {
	low: "Lav",
	medium: "Middels",
	high: "Høy",
	very_high: "Svært høy",
}
const groupCriticalityOptions = ["low", "medium", "high", "very_high"] as const

const entraChangeTypeLabels: Record<string, string> = {
	added: "Lagt til",
	removed: "Fjernet",
	criticality_changed: "Kritikalitet endret",
}

type EntraGroupsDataProp = {
	naisGroupIds: string[]
	manualGroups: Array<{ id: string; groupId: string; groupName: string | null; createdBy: string; createdAt: string }>
	ghostGroupIds: string[]
	groupNames: Record<string, string>
	assessmentsByGroupId: Record<string, { criticality: string; updatedBy: string; updatedAt: string }>
}

function EntraMaintenanceSection({
	activity,
	entraGroupsData,
	isDraft,
}: {
	activity: ActivityProp
	entraGroupsData: EntraGroupsDataProp
	isDraft: boolean
}) {
	const addFetcher = useFetcher()
	const removeFetcher = useFetcher()
	const criticalityFetcher = useFetcher()
	const searchFetcher = useFetcher<{ results: Array<{ id: string; displayName: string }> }>()
	const [searchQuery, setSearchQuery] = useState("")
	const [showResults, setShowResults] = useState(false)
	const [dialogOpen, setDialogOpen] = useState(false)
	const [sort, setSort] = useState<SortState>({ orderBy: "name", direction: "ascending" })
	const searchInputRef = useRef<HTMLInputElement>(null)
	const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	const { naisGroupIds, manualGroups, ghostGroupIds, groupNames, assessmentsByGroupId } = entraGroupsData
	const searchResults = searchFetcher.data?.results ?? []
	const isSearching = searchFetcher.state === "loading"

	const naisGroupIdSet = useMemo(() => new Set(naisGroupIds), [naisGroupIds])
	const allExistingGroupIds = useMemo(
		() => new Set([...naisGroupIds, ...manualGroups.map((g) => g.groupId)]),
		[naisGroupIds, manualGroups],
	)

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
			if (allExistingGroupIds.has(groupId)) return
			addFetcher.submit({ intent: "add-manual-group", groupId, groupName: displayName }, { method: "POST" })
			setSearchQuery("")
			setShowResults(false)
			setDialogOpen(false)
		},
		[addFetcher, allExistingGroupIds],
	)

	type UnifiedGroup = {
		groupId: string
		source: "nais" | "manual" | "removed"
		manualGroupDbId?: string
	}

	const unifiedGroups = useMemo(() => {
		const groups: UnifiedGroup[] = []
		for (const gid of naisGroupIds) {
			groups.push({ groupId: gid, source: "nais" })
		}
		for (const mg of manualGroups) {
			if (!naisGroupIdSet.has(mg.groupId)) {
				groups.push({ groupId: mg.groupId, source: "manual", manualGroupDbId: mg.id })
			}
		}
		for (const gid of ghostGroupIds) {
			groups.push({ groupId: gid, source: "removed" })
		}
		return groups
	}, [naisGroupIds, manualGroups, ghostGroupIds, naisGroupIdSet])

	const sortedGroups = useMemo(() => {
		const dir = sort.direction === "ascending" ? 1 : -1
		return [...unifiedGroups].sort((a, b) => {
			const nameA = groupNames[a.groupId] ?? ""
			const nameB = groupNames[b.groupId] ?? ""
			switch (sort.orderBy) {
				case "name":
					return dir * nameA.localeCompare(nameB, "nb")
				case "source":
					return dir * a.source.localeCompare(b.source)
				case "criticality": {
					const critA = assessmentsByGroupId[a.groupId]?.criticality ?? ""
					const critB = assessmentsByGroupId[b.groupId]?.criticality ?? ""
					return dir * critA.localeCompare(critB, "nb")
				}
				default:
					return 0
			}
		})
	}, [unifiedGroups, sort, groupNames, assessmentsByGroupId])

	const handleSort = (sortKey: string) => {
		setSort((prev) =>
			prev.orderBy === sortKey
				? { orderBy: sortKey, direction: prev.direction === "ascending" ? "descending" : "ascending" }
				: { orderBy: sortKey, direction: "ascending" },
		)
	}

	const isPending = activity.status === "pending"

	return (
		<VStack gap="space-6">
			<HStack gap="space-4" align="center">
				<Heading size="medium" level="3">
					Entra ID-gruppevedlikehold
				</Heading>
				{isPending ? (
					<Tag variant="warning" size="small">
						Pågår
					</Tag>
				) : (
					<Tag variant="success" size="small">
						Fullført
					</Tag>
				)}
			</HStack>

			{/* Groups table */}
			{unifiedGroups.length > 0 ? (
				/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
				<section className="table-scroll" tabIndex={0} aria-label="Entra ID-grupper">
					<Table size="small" sort={sort} onSortChange={handleSort}>
						<Table.Header>
							<Table.Row>
								<Table.ColumnHeader sortKey="name" sortable scope="col">
									Gruppe
								</Table.ColumnHeader>
								<Table.ColumnHeader sortKey="source" sortable scope="col">
									Kilde
								</Table.ColumnHeader>
								<Table.ColumnHeader sortKey="criticality" sortable scope="col">
									Kritikalitet
								</Table.ColumnHeader>
								{isDraft && isPending && (
									<Table.HeaderCell scope="col" style={{ width: "1px" }}>
										<span className="navds-sr-only">Handlinger</span>
									</Table.HeaderCell>
								)}
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{sortedGroups.map((ug) => {
								const assessment = assessmentsByGroupId[ug.groupId]
								const displayName = groupNames[ug.groupId] ?? null

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
													Fjernet
												</Tag>
											)}
										</Table.DataCell>
										<Table.DataCell>
											{isDraft && isPending ? (
												<criticalityFetcher.Form method="post">
													<input type="hidden" name="intent" value="set-group-criticality" />
													<input type="hidden" name="groupId" value={ug.groupId} />
													<Select
														label="Kritikalitet"
														hideLabel
														size="small"
														value={assessment?.criticality ?? ""}
														onChange={(e) => {
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
														{groupCriticalityOptions.map((c) => (
															<option key={c} value={c}>
																{groupCriticalityLabels[c]}
															</option>
														))}
													</Select>
												</criticalityFetcher.Form>
											) : (
												<BodyShort size="small">
													{assessment?.criticality
														? (groupCriticalityLabels[assessment.criticality] ?? assessment.criticality)
														: "—"}
												</BodyShort>
											)}
										</Table.DataCell>
										{isDraft && isPending && (
											<Table.DataCell>
												{ug.source === "manual" && ug.manualGroupDbId && (
													<removeFetcher.Form method="post">
														<input type="hidden" name="intent" value="remove-manual-group" />
														<input type="hidden" name="manualGroupId" value={ug.manualGroupDbId} />
														<input type="hidden" name="groupId" value={ug.groupId} />
														<input type="hidden" name="groupName" value={displayName ?? ""} />
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
				</section>
			) : (
				<BodyShort size="small" textColor="subtle">
					Ingen Entra ID-grupper registrert.
				</BodyShort>
			)}

			{/* Add group button — only for pending activities in drafts */}
			{isDraft && isPending && (
				<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
					<Dialog.Trigger>
						<Button variant="secondary" size="small" icon={<PlusIcon aria-hidden />}>
							Legg til gruppe
						</Button>
					</Dialog.Trigger>
					<Dialog.Popup
						width="large"
						position="center"
						closeOnOutsideClick
						initialFocusTo={() => searchInputRef.current}
						aria-label="Legg til Entra ID-gruppe"
					>
						<Dialog.Header>Legg til Entra ID-gruppe</Dialog.Header>
						<Dialog.Body>
							<VStack gap="space-4">
								<Search
									ref={searchInputRef}
									label="Søk på gruppenavn eller Object-ID"
									size="small"
									value={searchQuery}
									onChange={handleSearch}
									onClear={() => {
										setSearchQuery("")
										setShowResults(false)
									}}
									autoComplete="off"
								/>
								{showResults && (
									<Box
										borderRadius="8"
										borderWidth="1"
										borderColor="neutral-subtle"
										style={{ maxHeight: "300px", overflowY: "auto" }}
									>
										{isSearching ? (
											<BodyShort size="small" textColor="subtle" style={{ padding: "var(--ax-space-8)" }}>
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
											<BodyShort size="small" textColor="subtle" style={{ padding: "var(--ax-space-8)" }}>
												Ingen grupper funnet
											</BodyShort>
										)}
									</Box>
								)}
							</VStack>
						</Dialog.Body>
					</Dialog.Popup>
				</Dialog>
			)}

			{/* Changes log */}
			{activity.changes.length > 0 && (
				<VStack gap="space-4">
					<Heading size="small" level="4">
						Endringslogg ({activity.changes.length})
					</Heading>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
					<section className="table-scroll" tabIndex={0} aria-label="Endringslogg for Entra ID-grupper">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell>Tidspunkt</Table.HeaderCell>
									<Table.HeaderCell>Handling</Table.HeaderCell>
									<Table.HeaderCell>Gruppe</Table.HeaderCell>
									<Table.HeaderCell>Detaljer</Table.HeaderCell>
									<Table.HeaderCell>Utført av</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{activity.changes.map((c) => (
									<Table.Row key={c.id}>
										<Table.DataCell>{formatDateTime(c.performedAt)}</Table.DataCell>
										<Table.DataCell>
											<Tag
												variant={c.changeType === "added" ? "success" : c.changeType === "removed" ? "error" : "info"}
												size="xsmall"
											>
												{entraChangeTypeLabels[c.changeType] ?? c.changeType}
											</Tag>
										</Table.DataCell>
										<Table.DataCell>
											<VStack gap="space-1">
												{c.groupName && <BodyShort size="small">{c.groupName}</BodyShort>}
												<Detail textColor="subtle" style={{ fontFamily: "monospace" }}>
													{c.groupId}
												</Detail>
											</VStack>
										</Table.DataCell>
										<Table.DataCell>
											{c.changeType === "criticality_changed" && (
												<BodyShort size="small">
													{c.previousValue ? (groupCriticalityLabels[c.previousValue] ?? c.previousValue) : "Ingen"} →{" "}
													{c.newValue ? (groupCriticalityLabels[c.newValue] ?? c.newValue) : "Ingen"}
												</BodyShort>
											)}
										</Table.DataCell>
										<Table.DataCell>{c.performedBy}</Table.DataCell>
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

function FollowUpPointsSection({
	reviewId: _reviewId,
	status,
	points,
}: {
	reviewId: string
	status: "draft" | "needs_follow_up" | "completed" | "discarded"
	points: Array<{
		id: string
		text: string
		description: string | null
		resolution: string | null
		status: "needs_follow_up" | "completed" | "not_relevant"
		createdBy: string
		createdAt: string
		updatedBy: string
		updatedAt: string
		resolvedAt: string | null
		resolvedBy: string | null
		attachments: Array<{
			id: string
			kind: "description" | "resolution"
			fileName: string
			contentType: string
			sizeBytes: number | null
			uploadedBy: string
			uploadedAt: string
		}>
	}>
}) {
	const actionData = useActionData<ActionResult>()
	const navigation = useNavigation()
	const isSubmitting = navigation.state === "submitting"
	const [newText, setNewText] = useState("")
	const formRef = useRef<HTMLFormElement>(null)

	const canAdd = status === "draft" || status === "needs_follow_up"
	const canEditText = status === "draft"
	// Beskrivelse på oppfølgingspunkter kan kun redigeres mens gjennomgangen
	// fortsatt er i utkast — etter fullføring (også «må følges opp») er
	// beskrivelsen låst for å bevare konteksten punktet ble opprettet i.
	const canEditDescription = status === "draft"
	const canDelete = status === "draft"
	// Når gjennomgangen er fullført låses begrunnelse/oppfølging på hvert
	// oppfølgingspunkt — man kan kun se eksisterende data, ikke endre status
	// eller laste opp nye vedlegg på resolution.
	const canChangeStatus = status === "draft" || status === "needs_follow_up"

	const followUpAddSuccess = actionData?.intent === "add-follow-up" && actionData.success
	useEffect(() => {
		if (followUpAddSuccess) {
			setNewText("")
			formRef.current?.reset()
		}
	}, [followUpAddSuccess])

	const seenIdsRef = useRef<Set<string> | null>(null)
	const newlyAddedIds = useMemo(() => {
		const previouslySeen = seenIdsRef.current
		const currentIds = new Set(points.map((p) => p.id))
		const added = new Set<string>()
		if (previouslySeen !== null) {
			for (const id of currentIds) {
				if (!previouslySeen.has(id)) {
					added.add(id)
				}
			}
		}
		return added
	}, [points])

	useEffect(() => {
		seenIdsRef.current = new Set(points.map((p) => p.id))
	}, [points])

	const colSpan = 3 + (canChangeStatus || canDelete ? 1 : 0)

	return (
		<VStack gap="space-4">
			<Heading size="medium" level="3">
				Oppfølgingspunkter
			</Heading>
			<BodyShort size="small" textColor="subtle">
				Punkter som må følges opp etter gjennomgangen. Når alle punkter er adressert (fullført eller markert som ikke
				relevant) settes gjennomgangen automatisk til fullført.
			</BodyShort>

			{points.length > 0 ? (
				<Table size="small">
					<Table.Header>
						<Table.Row>
							<Table.HeaderCell scope="col">Tittel</Table.HeaderCell>
							<Table.HeaderCell scope="col">Status</Table.HeaderCell>
							<Table.HeaderCell scope="col">Sist endret</Table.HeaderCell>
							{(canChangeStatus || canDelete) && <Table.HeaderCell scope="col" />}
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{points.map((p) => (
							<FollowUpPointRow
								key={p.id}
								point={p}
								canEditText={canEditText}
								canEditDescription={canEditDescription}
								canChangeStatus={canChangeStatus}
								canDelete={canDelete}
								colSpan={colSpan}
								initiallyOpen={newlyAddedIds.has(p.id)}
							/>
						))}
					</Table.Body>
				</Table>
			) : (
				<Box padding="space-6" borderRadius="8" background="sunken">
					<BodyShort>Ingen oppfølgingspunkter er lagt til.</BodyShort>
				</Box>
			)}

			{canAdd && (
				<Box
					marginBlock="space-8 space-0"
					padding="space-6"
					borderWidth="1"
					borderColor="neutral-subtle"
					borderRadius="8"
				>
					<Form method="post" ref={formRef}>
						<input type="hidden" name="intent" value="add-follow-up" />
						<VStack gap="space-2">
							<TextField
								label="Nytt oppfølgingspunkt"
								name="text"
								size="small"
								value={newText}
								onChange={(e) => setNewText(e.currentTarget.value)}
								description="Kort tittel på hva som må følges opp. Du kan legge til en utdypende beskrivelse og vedlegg etter at punktet er opprettet."
							/>
							{actionData?.intent === "add-follow-up" && actionData.error && (
								<Alert variant="error" size="small">
									{actionData.error}
								</Alert>
							)}
							<HStack>
								<Button
									type="submit"
									variant="secondary"
									size="small"
									icon={<PlusIcon aria-hidden />}
									disabled={!newText.trim() || isSubmitting}
								>
									Legg til oppfølgingspunkt
								</Button>
							</HStack>
						</VStack>
					</Form>
				</Box>
			)}
		</VStack>
	)
}

function FollowUpPointRow({
	point: p,
	canEditText,
	canEditDescription,
	canChangeStatus,
	canDelete,
	colSpan,
	initiallyOpen = false,
}: {
	point: {
		id: string
		text: string
		description: string | null
		resolution: string | null
		status: "needs_follow_up" | "completed" | "not_relevant"
		updatedBy: string
		updatedAt: string
		attachments: Array<{
			id: string
			kind: "description" | "resolution"
			fileName: string
			contentType: string
			sizeBytes: number | null
			uploadedBy: string
			uploadedAt: string
		}>
	}
	canEditText: boolean
	canEditDescription: boolean
	canChangeStatus: boolean
	canDelete: boolean
	colSpan: number
	initiallyOpen?: boolean
}) {
	const actionData = useActionData<ActionResult>()
	const [isOpen, setIsOpen] = useState(initiallyOpen)
	const [descriptionValue, setDescriptionValue] = useState(p.description ?? "")
	const [statusValue, setStatusValue] = useState<"needs_follow_up" | "completed" | "not_relevant">(p.status)
	const [resolutionValue, setResolutionValue] = useState(p.resolution ?? "")

	useEffect(() => {
		setDescriptionValue(p.description ?? "")
	}, [p.description])
	useEffect(() => {
		setStatusValue(p.status)
	}, [p.status])
	useEffect(() => {
		setResolutionValue(p.resolution ?? "")
	}, [p.resolution])

	const descriptionDirty = (descriptionValue ?? "") !== (p.description ?? "")
	const descriptionSavedNow =
		actionData?.intent === "update-follow-up-description" &&
		actionData.success &&
		actionData.pointId === p.id &&
		!descriptionDirty &&
		Boolean(p.description) === Boolean(descriptionValue.trim())

	const statusDirty = statusValue !== p.status || (resolutionValue ?? "") !== (p.resolution ?? "")
	const statusSavedNow =
		actionData?.intent === "update-follow-up-status" &&
		actionData.success &&
		actionData.pointId === p.id &&
		!statusDirty

	function statusTag(s: "needs_follow_up" | "completed" | "not_relevant") {
		if (s === "completed") {
			return (
				<Tag variant="success" size="xsmall">
					Fullført
				</Tag>
			)
		}
		if (s === "not_relevant") {
			return (
				<Tag variant="neutral" size="xsmall">
					Ikke relevant
				</Tag>
			)
		}
		return (
			<Tag variant="warning" size="xsmall">
				Må følges opp
			</Tag>
		)
	}

	return (
		<Table.ExpandableRow
			open={isOpen}
			onOpenChange={setIsOpen}
			togglePlacement="right"
			expandOnRowClick={true}
			colSpan={colSpan}
			content={
				<VStack gap="space-8">
					{canEditDescription ? (
						<Form method="post">
							<input type="hidden" name="intent" value="update-follow-up-description" />
							<input type="hidden" name="pointId" value={p.id} />
							<VStack gap="space-4">
								<Textarea
									label="Beskrivelse"
									name="description"
									size="small"
									minRows={3}
									maxLength={4000}
									required
									value={descriptionValue}
									onChange={(e) => setDescriptionValue(e.currentTarget.value)}
									description="Utdyp hva som må gjøres, hvem som er ansvarlig, frister osv."
								/>
								<FollowUpPointAttachments
									point={p}
									kind="description"
									title="Vedlegg til beskrivelse"
									canUpload={canEditDescription}
								/>
								{actionData?.intent === "update-follow-up-description" && actionData.error && (
									<Alert variant="error" size="small">
										{actionData.error}
									</Alert>
								)}
								<HStack gap="space-2" align="center">
									<Button
										type="submit"
										variant="secondary"
										size="xsmall"
										disabled={!descriptionDirty || descriptionValue.trim().length === 0}
									>
										Lagre beskrivelse
									</Button>
									{descriptionSavedNow && (
										<BodyShort size="small" textColor="subtle">
											Lagret.
										</BodyShort>
									)}
								</HStack>
							</VStack>
						</Form>
					) : (
						<>
							{p.description ? (
								<VStack gap="space-1">
									<Detail weight="semibold" textColor="subtle">
										Beskrivelse
									</Detail>
									<BodyShort size="small" style={{ whiteSpace: "pre-wrap" }}>
										{p.description}
									</BodyShort>
								</VStack>
							) : (
								<BodyShort size="small" textColor="subtle">
									Ingen beskrivelse er lagt til.
								</BodyShort>
							)}
							<FollowUpPointAttachments
								point={p}
								kind="description"
								title="Vedlegg til beskrivelse"
								canUpload={canEditDescription}
							/>
						</>
					)}

					{canChangeStatus && p.description ? (
						<Box borderWidth="1 0 0 0" borderColor="neutral-subtle" paddingBlock="space-16 space-0">
							<Form method="post">
								<input type="hidden" name="intent" value="update-follow-up-status" />
								<input type="hidden" name="pointId" value={p.id} />
								<VStack gap="space-2">
									<Select
										label="Status"
										name="status"
										size="small"
										value={statusValue}
										onChange={(e) =>
											setStatusValue(e.currentTarget.value as "needs_follow_up" | "completed" | "not_relevant")
										}
									>
										<option value="needs_follow_up">Må følges opp</option>
										<option value="completed">Fullført</option>
										<option value="not_relevant">Ikke relevant</option>
									</Select>
									<Textarea
										label="Oppfølging"
										name="resolution"
										size="small"
										minRows={2}
										maxLength={4000}
										required
										value={resolutionValue}
										onChange={(e) => setResolutionValue(e.currentTarget.value)}
										description="Beskriv kort hva som ble gjort eller hvorfor punktet er lukket."
									/>
									<FollowUpPointAttachments
										point={p}
										kind="resolution"
										title="Vedlegg til oppfølging"
										canUpload={canChangeStatus}
									/>
									{actionData?.intent === "update-follow-up-status" && actionData.error && (
										<Alert variant="error" size="small">
											{actionData.error}
										</Alert>
									)}
									<HStack gap="space-2" align="center">
										<Button
											type="submit"
											variant="secondary"
											size="xsmall"
											disabled={!statusDirty || resolutionValue.trim().length === 0}
										>
											Lagre status
										</Button>
										{statusSavedNow && (
											<BodyShort size="small" textColor="subtle">
												Lagret.
											</BodyShort>
										)}
									</HStack>
								</VStack>
							</Form>
						</Box>
					) : p.resolution ? (
						<Box borderWidth="1 0 0 0" borderColor="neutral-subtle" paddingBlock="space-16 space-0">
							<VStack gap="space-2">
								<VStack gap="space-1">
									<Detail weight="semibold" textColor="subtle">
										Oppfølging
									</Detail>
									<BodyShort size="small" style={{ whiteSpace: "pre-wrap" }}>
										{p.resolution}
									</BodyShort>
								</VStack>
								{p.description && (
									<FollowUpPointAttachments
										point={p}
										kind="resolution"
										title="Vedlegg til oppfølging"
										canUpload={canChangeStatus}
									/>
								)}
							</VStack>
						</Box>
					) : p.description ? (
						<Box borderWidth="1 0 0 0" borderColor="neutral-subtle" paddingBlock="space-16 space-0">
							<FollowUpPointAttachments
								point={p}
								kind="resolution"
								title="Vedlegg til oppfølging"
								canUpload={canChangeStatus}
							/>
						</Box>
					) : null}
				</VStack>
			}
		>
			<Table.DataCell>
				{canEditText ? (
					<Form method="post">
						<input type="hidden" name="intent" value="update-follow-up-text" />
						<input type="hidden" name="pointId" value={p.id} />
						<HStack gap="space-2" align="center">
							<TextField
								label="Tittel"
								hideLabel
								name="text"
								size="small"
								defaultValue={p.text}
								style={{ minWidth: "20rem" }}
							/>
							<Button type="submit" variant="tertiary" size="xsmall">
								Lagre
							</Button>
						</HStack>
					</Form>
				) : (
					p.text
				)}
			</Table.DataCell>
			<Table.DataCell>{statusTag(p.status)}</Table.DataCell>
			<Table.DataCell>
				<VStack gap="space-1">
					<Detail>{new Date(p.updatedAt).toLocaleString("nb-NO")}</Detail>
					<Detail textColor="subtle">av {p.updatedBy}</Detail>
				</VStack>
			</Table.DataCell>
			{(canChangeStatus || canDelete) && (
				<Table.DataCell>
					{canDelete && (
						<Form method="post">
							<input type="hidden" name="intent" value="delete-follow-up" />
							<input type="hidden" name="pointId" value={p.id} />
							<Button type="submit" variant="tertiary-neutral" size="xsmall" icon={<TrashIcon aria-hidden />}>
								Fjern
							</Button>
						</Form>
					)}
				</Table.DataCell>
			)}
		</Table.ExpandableRow>
	)
}

function FollowUpPointAttachments({
	point,
	kind,
	title,
	canUpload,
}: {
	point: {
		id: string
		attachments: Array<{
			id: string
			kind: "description" | "resolution"
			fileName: string
			contentType: string
			sizeBytes: number | null
			uploadedBy: string
			uploadedAt: string
		}>
	}
	kind: "description" | "resolution"
	title: string
	canUpload: boolean
}) {
	const revalidator = useRevalidator()
	const [files, setFiles] = useState<FileObject[]>([])
	const [uploading, setUploading] = useState(false)
	const [uploadResult, setUploadResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null)

	const attachmentsForKind = point.attachments.filter((a) => a.kind === kind)

	async function uploadFile(file: File) {
		setUploading(true)
		setUploadResult(null)

		try {
			const formData = new FormData()
			formData.append("file", file)
			formData.append("kind", kind)

			const response = await fetch(`/api/oppfolgingspunkt/${point.id}/vedlegg`, {
				method: "POST",
				body: formData,
			})

			if (response.status === 413) {
				setUploadResult({
					success: false,
					error: `Filen er for stor. Maksimal filstørrelse er ${MAX_SIZE_MB} MB.`,
				})
				return
			}

			const result = await response.json()
			setUploadResult(result)

			if (result.success) {
				revalidator.revalidate()
			}
		} catch {
			setUploadResult({ success: false, error: "Nettverksfeil ved opplasting." })
		} finally {
			setFiles([])
			setUploading(false)
		}
	}

	function handleFileSelect(newFiles: FileObject[]) {
		if (uploading && newFiles.length > 0) return
		setFiles(newFiles)
		const accepted = newFiles.find((f) => !f.error)
		if (accepted) {
			uploadFile(accepted.file)
		}
	}

	if (!canUpload && attachmentsForKind.length === 0) {
		return null
	}

	return (
		<VStack gap="space-4">
			<Detail weight="semibold" textColor="subtle">
				{title}
			</Detail>

			{attachmentsForKind.length > 0 ? (
				<Table size="small">
					<Table.Header>
						<Table.Row>
							<Table.HeaderCell scope="col">Filnavn</Table.HeaderCell>
							<Table.HeaderCell scope="col">Størrelse</Table.HeaderCell>
							<Table.HeaderCell scope="col">Lastet opp av</Table.HeaderCell>
							<Table.HeaderCell scope="col">Dato</Table.HeaderCell>
							<Table.HeaderCell scope="col" />
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{attachmentsForKind.map((a) => (
							<Table.Row key={a.id}>
								<Table.DataCell>{a.fileName}</Table.DataCell>
								<Table.DataCell>{formatFileSize(a.sizeBytes)}</Table.DataCell>
								<Table.DataCell>{a.uploadedBy}</Table.DataCell>
								<Table.DataCell>{formatDate(a.uploadedAt)}</Table.DataCell>
								<Table.DataCell>
									<HStack gap="space-2">
										<Button
											as="a"
											href={`/api/oppfolgingspunkt-vedlegg/${a.id}`}
											target="_blank"
											rel="noopener noreferrer"
											variant="tertiary"
											size="xsmall"
											icon={<ExternalLinkIcon aria-hidden />}
										>
											Åpne
										</Button>
										<Button
											as="a"
											href={`/api/oppfolgingspunkt-vedlegg/${a.id}?download=true`}
											download={a.fileName}
											variant="tertiary"
											size="xsmall"
											icon={<DownloadIcon aria-hidden />}
										>
											Last ned
										</Button>
									</HStack>
								</Table.DataCell>
							</Table.Row>
						))}
					</Table.Body>
				</Table>
			) : (
				<BodyShort size="small" textColor="subtle">
					Ingen vedlegg lagt til.
				</BodyShort>
			)}

			{canUpload && (
				<ReadMore header="Last opp vedlegg" size="small">
					<VStack gap="space-2">
						{uploadResult?.error && (
							<Alert variant="error" size="small">
								{uploadResult.error}
							</Alert>
						)}
						{uploadResult?.success && (
							<Alert variant="success" size="small">
								{uploadResult.message}
							</Alert>
						)}
						<AutoUploadDropzone
							label={title}
							description={`Maks ${MAX_SIZE_MB} MB. Støttede formater: PDF, DOCX, XLSX, PPTX, PNG, JPG, TXT, MD`}
							accept=".pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.txt,.md"
							maxSizeInBytes={MAX_SIZE_BYTES}
							files={files}
							onFilesChange={handleFileSelect}
							isUploading={uploading}
							rejectionErrors={{
								fileType: "Filtypen er ikke støttet",
								fileSize: `Filen er for stor (maks ${MAX_SIZE_MB} MB)`,
							}}
						/>
					</VStack>
				</ReadMore>
			)}
		</VStack>
	)
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
