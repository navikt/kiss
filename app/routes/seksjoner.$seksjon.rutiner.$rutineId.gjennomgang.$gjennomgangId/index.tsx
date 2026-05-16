import { DownloadIcon, ExternalLinkIcon, LinkIcon, PlusIcon, TrashIcon } from "@navikt/aksel-icons"
import type { FileObject, SortState } from "@navikt/ds-react"
import {
	Link as AkselLink,
	Alert,
	BodyShort,
	Box,
	Button,
	ConfirmationPanel,
	CopyButton,
	Detail,
	Dialog,
	Heading,
	HStack,
	Label,
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
	Link,
	redirect,
	useActionData,
	useFetcher,
	useLoaderData,
	useNavigation,
	useRevalidator,
	useSubmit,
} from "react-router"
import { AutoUploadDropzone } from "~/components/AutoUploadDropzone"
import { EvidenceSection } from "~/components/evidence"
import { FrequencyDisplay } from "~/components/FrequencyDisplay"
import { MarkdownEditor } from "~/components/MarkdownEditor"
import { ParticipantsCombobox } from "~/components/ParticipantsCombobox"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import {
	addFollowUpPoint,
	addReviewLink,
	autoCreateActivityForReview,
	completeReview,
	deleteFollowUpPoint,
	deleteReviewLink,
	discardReview,
	getReview,
	getReviewActivity,
	getRoutine,
	getRoutineArchivedStatusByReviewId,
	recordEntraChange,
	updateFollowUpPointDescription,
	updateFollowUpPointStatus,
	updateFollowUpPointText,
	updateReview,
} from "~/db/queries/routines.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { type GroupCriticality, groupCriticalityEnum } from "~/db/schema/applications"
import { FOLLOW_UP_POINT_STATUSES, type FollowUpPointStatus } from "~/db/schema/routines"
import { getEvidenceTypesForActivity, getProviderTypeForActivity } from "~/lib/activity-types"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { renderMarkdown } from "~/lib/markdown.server"
import { parseParticipantsFormValue } from "~/lib/participants"

const MAX_SIZE_MB = 50
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024

type ActionResult = {
	success: boolean
	message?: string
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
	let appAuthIntegrations: Array<{ type: string; groups: string | null }> = []
	if (review.applicationId) {
		const { getApplicationDetail } = await import("~/db/queries/nais.server")
		const appDetail = await getApplicationDetail(review.applicationId)
		applicationName = appDetail?.app.name ?? null
		appAuthIntegrations = appDetail?.authIntegrations ?? []
	}

	// Load activity data — auto-create only for draft reviews missing an activity
	// (handles reviews created before the activity system was deployed)
	let activity = await getReviewActivity(gjennomgangId)
	if (!activity && routine.activityType && review.status === "draft") {
		await autoCreateActivityForReview(gjennomgangId, rutineId, review.applicationId, "system")
		activity = await getReviewActivity(gjennomgangId)
	}
	let entraGroupsData: {
		naisGroupIds: string[]
		manualGroups: Array<{ id: string; groupId: string; groupName: string | null; createdBy: string; createdAt: string }>
		ghostGroupIds: string[]
		groupNames: Record<string, string>
		assessmentsByGroupId: Record<string, { criticality: string; updatedBy: string; updatedAt: string }>
	} | null = null

	if (activity?.type === "entra_id_group_maintenance" && review.applicationId) {
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
		entraGroupsData = {
			naisGroupIds,
			manualGroups: manualGroups.map((g) => ({ ...g, createdAt: g.createdAt.toISOString() })),
			ghostGroupIds,
			groupNames,
			assessmentsByGroupId,
		}
	}

	// Load evidence data for provider activities. Currently only Oracle is implemented;
	// deployment evidence loading will be added when the NDA provider is ready.
	const evidenceProviderType = activity ? getProviderTypeForActivity(activity.type) : null
	let oracleEvidenceData: {
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
	} | null = null

	if (activity && evidenceProviderType === "oracle" && review.applicationId) {
		const { getOracleInstancesForApp } = await import("~/db/queries/audit-evidence.server")
		const { getEvidenceDownloadsForActivityWithBucketDetails } = await import("~/db/queries/evidence-downloads.server")
		const [configuredInstances, downloads] = await Promise.all([
			getOracleInstancesForApp(review.applicationId),
			getEvidenceDownloadsForActivityWithBucketDetails(activity.id),
		])
		oracleEvidenceData = {
			configuredInstances: configuredInstances.map((i) => ({ instanceId: i.instanceId })),
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

	// Load NDA evidence data
	let ndaEvidenceData: {
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
	} | null = null

	if (activity && evidenceProviderType === "deployments") {
		const { getNdaAppParams } = await import("~/db/queries/deployment-audit.server")
		const { getEvidenceDownloadsForActivityWithBucketDetails } = await import("~/db/queries/evidence-downloads.server")
		const [appParams, downloads] = await Promise.all([
			review.applicationId ? getNdaAppParams(review.applicationId) : Promise.resolve(null),
			getEvidenceDownloadsForActivityWithBucketDetails(activity.id),
		])
		ndaEvidenceData = {
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

	return data({
		section,
		routine,
		activity: activity
			? {
					...activity,
					completedAt: activity.completedAt?.toISOString() ?? null,
					createdAt: activity.createdAt.toISOString(),
					changes: activity.changes.map((c) => ({
						...c,
						performedAt: c.performedAt.toISOString(),
					})),
				}
			: null,
		entraGroupsData,
		oracleEvidenceData,
		ndaEvidenceData,
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
		const title = (formData.get("title") as string)?.trim()
		const summary = (formData.get("summary") as string)?.trim() || null
		const reviewedAt = formData.get("reviewedAt") as string
		const reviewedTime = (formData.get("reviewedTime") as string) || "00:00"
		const participantsRaw = formData.get("participants")

		if (!title) {
			return data<ActionResult>({ success: false, error: "Tittel er påkrevd", intent: "update-review" })
		}

		const participants = parseParticipantsFormValue(participantsRaw)

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

		return data<ActionResult>({ success: true, message: "Gjennomgang oppdatert.", intent: "update-review" })
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

		const message =
			updated?.status === "needs_follow_up"
				? "Gjennomgangen er fullført med oppfølgingspunkter som må adresseres."
				: "Gjennomgangen er fullført."

		return data<ActionResult>({
			success: true,
			message,
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
			new URL(url)
		} catch {
			return data<ActionResult>({ success: false, error: "Ugyldig URL", intent: "add-link" })
		}
		await addReviewLink({ reviewId: gjennomgangId, url, title, addedBy: authedUser.navIdent })
		return data<ActionResult>({ success: true, message: "Lenke lagt til.", intent: "add-link" })
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
		return data<ActionResult>({ success: true, message: "Lenke fjernet.", intent: "delete-link" })
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
		const activity = await getReviewActivity(gjennomgangId)
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
		return data<ActionResult>({ success: true, message: "Gruppe lagt til.", intent: "add-manual-group" })
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
		const activity = await getReviewActivity(gjennomgangId)
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
		return data<ActionResult>({ success: true, message: "Gruppe fjernet.", intent: "remove-manual-group" })
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
		const activity = await getReviewActivity(gjennomgangId)
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
		return data<ActionResult>({ success: true, message: "Oppfølgingspunkt lagt til.", intent: "add-follow-up" })
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
			message: "Status oppdatert.",
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
			message: "Oppfølgingspunkt oppdatert.",
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
			message: "Beskrivelse oppdatert.",
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
		return data<ActionResult>({ success: true, message: "Oppfølgingspunkt fjernet.", intent: "delete-follow-up" })
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

function AttachmentSourceTag({ sourceType }: { sourceType: string }) {
	if (sourceType === "automated") {
		return (
			<Tag variant="info" size="xsmall">
				Hentet automatisk
			</Tag>
		)
	}

	if (sourceType === "manual") {
		return (
			<Tag variant="neutral" size="xsmall">
				Lastet opp manuelt
			</Tag>
		)
	}

	return (
		<Tag variant="neutral" size="xsmall">
			Ukjent
		</Tag>
	)
}

function AddLinkSection() {
	const actionData = useActionData<typeof action>()
	const navigation = useNavigation()
	const isSubmitting = navigation.state === "submitting"
	const [url, setUrl] = useState("")
	const [title, setTitle] = useState("")

	return (
		<Box padding="space-6" borderWidth="1" borderColor="neutral-subtle" borderRadius="8">
			<Heading size="small" level="4" spacing>
				Legg til lenke
			</Heading>
			<Form
				method="post"
				onSubmit={() => {
					setTimeout(() => {
						setUrl("")
						setTitle("")
					}, 100)
				}}
			>
				<input type="hidden" name="intent" value="add-link" />
				<VStack gap="space-4">
					<HStack gap="space-4" align="end" style={{ flexWrap: "wrap" }}>
						<TextField
							label="Tittel (valgfritt)"
							name="linkTitle"
							size="small"
							autoComplete="off"
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							style={{ minWidth: "15rem", flex: 1 }}
						/>
						<TextField
							label="URL"
							name="url"
							size="small"
							type="url"
							autoComplete="off"
							value={url}
							onChange={(e) => setUrl(e.target.value)}
							placeholder="https://..."
							style={{ minWidth: "20rem", flex: 2 }}
						/>
						<Button
							type="submit"
							variant="secondary"
							size="small"
							loading={isSubmitting}
							icon={<LinkIcon aria-hidden />}
						>
							Legg til
						</Button>
					</HStack>
					{actionData?.intent === "add-link" && actionData.error && (
						<Alert variant="error" size="small">
							{actionData.error}
						</Alert>
					)}
				</VStack>
			</Form>
		</Box>
	)
}

function UploadSection({ reviewId }: { reviewId: string }) {
	const revalidator = useRevalidator()
	const [files, setFiles] = useState<FileObject[]>([])
	const [uploading, setUploading] = useState(false)
	const [uploadResult, setUploadResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null)

	async function uploadFile(file: File) {
		setUploading(true)
		setUploadResult(null)

		try {
			const formData = new FormData()
			formData.append("file", file)

			const response = await fetch(`/api/gjennomgang/${reviewId}/vedlegg`, {
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

	return (
		<VStack gap="space-4">
			<Heading size="small" level="4">
				Last opp vedlegg
			</Heading>

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
				label="Dra og slipp fil, eller klikk for å velge"
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
	)
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

type ActivityProp = {
	id: string
	type: string
	status: string
	completedAt: string | null
	createdAt: string
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

function DiscardSection() {
	const [dialogOpen, setDialogOpen] = useState(false)
	const navigation = useNavigation()
	const isSubmitting = navigation.state === "submitting"

	return (
		<Box padding="space-8" borderWidth="1" borderColor="neutral-subtle" borderRadius="8">
			<VStack gap="space-4">
				<Heading size="small" level="4">
					Forkast gjennomgang
				</Heading>
				<BodyShort>
					Forkaster du gjennomgangen vil den fjernes fra alle oversikter. Dataene beholdes for sporbarhet.
				</BodyShort>
				<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
					<Dialog.Trigger>
						<Button type="button" variant="danger" size="small">
							Forkast gjennomgang
						</Button>
					</Dialog.Trigger>
					<Dialog.Popup width="small" position="center" closeOnOutsideClick aria-label="Bekreft forkasting">
						<Dialog.Header>Forkast gjennomgang?</Dialog.Header>
						<Dialog.Body>
							<VStack gap="space-6">
								<BodyShort>
									Er du sikker på at du vil forkaste denne gjennomgangen? Handlingen kan ikke angres.
								</BodyShort>
								<Form method="post">
									<input type="hidden" name="intent" value="discard-review" />
									<HStack gap="space-4">
										<Button type="submit" variant="danger" size="small" disabled={isSubmitting} loading={isSubmitting}>
											Ja, forkast
										</Button>
										<Button type="button" variant="secondary" size="small" onClick={() => setDialogOpen(false)}>
											Avbryt
										</Button>
									</HStack>
								</Form>
							</VStack>
						</Dialog.Body>
					</Dialog.Popup>
				</Dialog>
			</VStack>
		</Box>
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

function CompleteSection({
	followUpPoints,
}: {
	followUpPoints: Array<{ id: string; text: string; description: string | null }>
}) {
	const submit = useSubmit()
	const navigation = useNavigation()
	const actionData = useActionData<ActionResult>()
	const [confirmed, setConfirmed] = useState(false)
	const isSubmitting = navigation.state === "submitting"

	const pointsMissingDescription = followUpPoints.filter((p) => !p.description || p.description.trim().length === 0)
	const hasMissingDescriptions = pointsMissingDescription.length > 0

	function handleComplete() {
		if (!confirmed || hasMissingDescriptions) return
		const formData = new FormData()
		formData.set("intent", "complete")
		submit(formData, { method: "post" })
	}

	return (
		<Box padding="space-8" borderWidth="1" borderColor="warning" borderRadius="8" background="warning-softA">
			<VStack gap="space-4">
				<Heading size="small" level="4">
					Fullfør gjennomgang
				</Heading>
				<BodyShort>
					Når gjennomgangen er fullført låses oppsummering, referat og deltakerlisten. Eventuelle uadresserte
					oppfølgingspunkter vil føre til at gjennomgangen får status «må følges opp», og du kan fortsatt oppdatere
					status og oppfølging på punktene inntil alle er adressert.
				</BodyShort>

				{hasMissingDescriptions && (
					<Alert variant="warning" size="small">
						<BodyShort spacing>
							Alle oppfølgingspunkter må ha en beskrivelse før gjennomgangen kan fullføres. Legg til beskrivelse på:
						</BodyShort>
						<ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
							{pointsMissingDescription.map((p) => (
								<li key={p.id}>{p.text}</li>
							))}
						</ul>
					</Alert>
				)}

				{actionData?.intent === "complete" && actionData.error && (
					<Alert variant="error" size="small">
						{actionData.error}
					</Alert>
				)}

				<ConfirmationPanel
					checked={confirmed}
					onChange={() => setConfirmed(!confirmed)}
					label="Jeg bekrefter at gjennomgangen er komplett"
					size="small"
					disabled={hasMissingDescriptions}
				/>

				<HStack>
					<Button
						type="button"
						variant="primary"
						size="small"
						onClick={handleComplete}
						disabled={!confirmed || isSubmitting || hasMissingDescriptions}
						loading={isSubmitting}
					>
						Fullfør gjennomgang
					</Button>
				</HStack>
			</VStack>
		</Box>
	)
}

export default function GjennomgangDetalj() {
	const { section, routine, review, activity, entraGroupsData, oracleEvidenceData, ndaEvidenceData } =
		useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const confirmedCount = review.participants.filter((p) => p.confirmedAt).length
	const isDraft = review.status === "draft"
	const evidenceProviderType = activity ? getProviderTypeForActivity(activity.type) : null
	const isCompleted = review.status === "completed"
	const isNeedsFollowUp = review.status === "needs_follow_up"
	const isDiscarded = review.status === "discarded"

	const reviewDate = new Date(review.reviewedAt)
	const defaultDate = reviewDate.toISOString().split("T")[0]
	const defaultTime = reviewDate.toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" })

	return (
		<VStack gap="space-8" style={{ maxWidth: "64rem" }}>
			<div>
				<HStack gap="space-4" align="center">
					<Heading size="xlarge" level="2">
						{review.title}
					</Heading>
					{isDraft && (
						<Tag variant="warning" size="small">
							Utkast
						</Tag>
					)}
					{isNeedsFollowUp && (
						<Tag variant="warning" size="small">
							Må følges opp
						</Tag>
					)}
					{isCompleted && (
						<Tag variant="success" size="small">
							Fullført
						</Tag>
					)}
					{isDiscarded && (
						<Tag variant="neutral" size="small">
							Forkastet
						</Tag>
					)}
				</HStack>
			</div>

			{isDraft ? (
				/* Editable form for drafts */
				<Form method="post">
					<input type="hidden" name="intent" value="update-review" />
					<VStack gap="space-6">
						<TextField label="Tittel" name="title" size="small" autoComplete="off" defaultValue={review.title} />

						{/* Metadata (read-only info + editable date) */}
						<Box padding="space-8" borderWidth="1" borderColor="neutral-subtle" borderRadius="8">
							<VStack gap="space-4">
								<HStack gap="space-12" wrap>
									<VStack gap="space-2">
										<Label size="small">Rutine</Label>
										<BodyShort>
											<AkselLink as={Link} to={`/seksjoner/${section.slug}/rutiner/${routine.id}`}>
												{routine.name}
											</AkselLink>
										</BodyShort>
									</VStack>
									<VStack gap="space-2">
										<Label size="small">Frekvens</Label>
										<FrequencyDisplay frequency={routine.frequency} eventFrequency={routine.eventFrequency} />
									</VStack>
									{review.applicationId && (
										<VStack gap="space-2">
											<Label size="small">Applikasjon</Label>
											<BodyShort>
												<AkselLink as={Link} to={`/applikasjoner/${review.applicationId}/detaljer`}>
													{review.applicationName ?? review.applicationId}
												</AkselLink>
											</BodyShort>
										</VStack>
									)}
									<VStack gap="space-2">
										<Label size="small">Opprettet av</Label>
										<BodyShort>{review.createdBy}</BodyShort>
									</VStack>
								</HStack>
								<HStack gap="space-6" align="end">
									<div>
										<Label size="small" htmlFor="reviewedAt">
											Dato for gjennomgang
										</Label>
										<input
											type="date"
											id="reviewedAt"
											name="reviewedAt"
											defaultValue={defaultDate}
											className="navds-text-field__input navds-body-short navds-body-short--small"
										/>
									</div>
									<div>
										<Label size="small" htmlFor="reviewedTime">
											Tidspunkt
										</Label>
										<input
											type="time"
											id="reviewedTime"
											name="reviewedTime"
											defaultValue={defaultTime}
											className="navds-text-field__input navds-body-short navds-body-short--small"
										/>
									</div>
								</HStack>
							</VStack>
						</Box>

						<MarkdownEditor label="Oppsummering/referat" name="summary" defaultValue={review.summary ?? ""} />

						<ParticipantsCombobox
							key={review.id}
							name="participants"
							label="Deltakere"
							description="Søk på navn eller e-post for å legge til personer. Du kan også skrive inn en NAV-ident direkte."
							defaultParticipants={review.participants.map((p) => ({
								navIdent: p.userIdent,
								displayName: p.userName,
							}))}
						/>

						{actionData?.intent === "update-review" && actionData.success && (
							<Alert variant="success" size="small">
								{actionData.message}
							</Alert>
						)}
						{actionData?.intent === "update-review" && actionData.error && (
							<Alert variant="error" size="small">
								{actionData.error}
							</Alert>
						)}

						<HStack>
							<Button type="submit" variant="primary" size="small">
								Lagre endringer
							</Button>
						</HStack>
					</VStack>
				</Form>
			) : (
				<>
					{/* Metadata (read-only) */}
					<Box padding="space-8" borderWidth="1" borderColor="neutral-subtle" borderRadius="8">
						<HStack gap="space-12" wrap>
							<VStack gap="space-2">
								<Label size="small">Rutine</Label>
								<BodyShort>
									<AkselLink as={Link} to={`/seksjoner/${section.slug}/rutiner/${routine.id}`}>
										{routine.name}
									</AkselLink>
								</BodyShort>
							</VStack>
							<VStack gap="space-2">
								<Label size="small">Frekvens</Label>
								<FrequencyDisplay frequency={routine.frequency} eventFrequency={routine.eventFrequency} />
							</VStack>
							<VStack gap="space-2">
								<Label size="small">Gjennomgangsdato</Label>
								<BodyShort>{formatDateTime(review.reviewedAt)}</BodyShort>
							</VStack>
							<VStack gap="space-2">
								<Label size="small">Opprettet av</Label>
								<BodyShort>{review.createdBy}</BodyShort>
							</VStack>
							<VStack gap="space-2">
								<Label size="small">Opprettet</Label>
								<BodyShort>{formatDateTime(review.createdAt)}</BodyShort>
							</VStack>
							{review.applicationId && (
								<VStack gap="space-2">
									<Label size="small">Applikasjon</Label>
									<BodyShort>
										<AkselLink as={Link} to={`/applikasjoner/${review.applicationId}/detaljer`}>
											{review.applicationName ?? review.applicationId}
										</AkselLink>
									</BodyShort>
								</VStack>
							)}
						</HStack>
					</Box>

					{/* Summary (read-only) */}
					{review.summaryHtml && (
						<VStack gap="space-2">
							<Heading size="medium" level="3">
								Oppsummering / referat
							</Heading>
							<Box padding="space-8" borderWidth="1" borderColor="neutral-subtle" borderRadius="8">
								<div
									className="markdown-content"
									// biome-ignore lint/security/noDangerouslySetInnerHtml: server-sanitized
									dangerouslySetInnerHTML={{ __html: review.summaryHtml }}
								/>
							</Box>
						</VStack>
					)}
				</>
			)}

			{/* Oppfølgingspunkter — rett under oppsummering/referat */}
			{!isDiscarded && (
				<FollowUpPointsSection reviewId={review.id} status={review.status} points={review.followUpPoints} />
			)}

			{/* Participants */}
			{review.participants.length > 0 && (
				<VStack gap="space-4">
					<Heading size="medium" level="3">
						Deltakere ({confirmedCount}/{review.participants.length} bekreftet)
					</Heading>
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell>Ident</Table.HeaderCell>
								<Table.HeaderCell>Navn</Table.HeaderCell>
								<Table.HeaderCell>Status</Table.HeaderCell>
								<Table.HeaderCell>Bekreftet</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{review.participants.map((p) => (
								<Table.Row key={p.id}>
									<Table.DataCell>{p.userIdent}</Table.DataCell>
									<Table.DataCell>{p.userName ?? "—"}</Table.DataCell>
									<Table.DataCell>
										{p.confirmedAt ? (
											<Tag variant="success" size="xsmall">
												Bekreftet
											</Tag>
										) : (
											<Tag variant="warning" size="xsmall">
												Venter
											</Tag>
										)}
									</Table.DataCell>
									<Table.DataCell>{p.confirmedAt ? formatDate(p.confirmedAt) : "—"}</Table.DataCell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				</VStack>
			)}

			{/* Entra ID-gruppevedlikehold */}
			{activity?.type === "entra_id_group_maintenance" && entraGroupsData && (
				<EntraMaintenanceSection activity={activity} entraGroupsData={entraGroupsData} isDraft={isDraft} />
			)}

			{/* Revisjonsbevis (Oracle, NDA, etc.) */}
			{activity && evidenceProviderType === "oracle" && oracleEvidenceData && (
				<EvidenceSection
					providerType="oracle"
					activity={activity}
					evidenceData={oracleEvidenceData}
					isDraft={isDraft}
				/>
			)}
			{activity && evidenceProviderType === "deployments" && ndaEvidenceData && (
				<EvidenceSection
					providerType="deployments"
					activity={activity}
					evidenceData={ndaEvidenceData}
					isDraft={isDraft}
				/>
			)}

			{/* Vedlegg */}
			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Vedlegg
				</Heading>
				{review.attachments.length > 0 ? (
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell>Filnavn</Table.HeaderCell>
								<Table.HeaderCell>Type</Table.HeaderCell>
								<Table.HeaderCell>Størrelse</Table.HeaderCell>
								<Table.HeaderCell>Kilde</Table.HeaderCell>
								<Table.HeaderCell>Lastet opp av</Table.HeaderCell>
								<Table.HeaderCell>Dato</Table.HeaderCell>
								<Table.HeaderCell />
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{review.attachments.map((a) => (
								<Table.Row key={a.id}>
									<Table.DataCell>{a.fileName}</Table.DataCell>
									<Table.DataCell>{a.contentType}</Table.DataCell>
									<Table.DataCell>{formatFileSize(a.sizeBytes)}</Table.DataCell>
									<Table.DataCell>
										<AttachmentSourceTag sourceType={a.sourceType} />
									</Table.DataCell>
									<Table.DataCell>{a.uploadedBy}</Table.DataCell>
									<Table.DataCell>{formatDate(a.uploadedAt)}</Table.DataCell>
									<Table.DataCell>
										<HStack gap="space-2">
											<Button
												as="a"
												href={`/api/rutine-vedlegg/${a.id}`}
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
												href={`/api/rutine-vedlegg/${a.id}?download=true`}
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
					<Box padding="space-6" borderRadius="8" background="sunken">
						<BodyShort>Ingen vedlegg er lagt til denne gjennomgangen.</BodyShort>
					</Box>
				)}
			</VStack>

			{/* Lenker */}
			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Lenker
				</Heading>
				{review.links.length > 0 ? (
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell>Tittel</Table.HeaderCell>
								<Table.HeaderCell>URL</Table.HeaderCell>
								<Table.HeaderCell>Lagt til av</Table.HeaderCell>
								<Table.HeaderCell>Dato</Table.HeaderCell>
								{isDraft && <Table.HeaderCell />}
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{review.links.map((l) => (
								<Table.Row key={l.id}>
									<Table.DataCell>{l.title || "—"}</Table.DataCell>
									<Table.DataCell>
										<AkselLink href={l.url} target="_blank" rel="noopener noreferrer">
											{l.url.length > 60 ? `${l.url.slice(0, 60)}…` : l.url}
											<ExternalLinkIcon aria-hidden style={{ marginLeft: "0.25rem" }} />
										</AkselLink>
									</Table.DataCell>
									<Table.DataCell>{l.addedBy}</Table.DataCell>
									<Table.DataCell>{formatDate(l.addedAt)}</Table.DataCell>
									{isDraft && (
										<Table.DataCell>
											<Form method="post">
												<input type="hidden" name="intent" value="delete-link" />
												<input type="hidden" name="linkId" value={l.id} />
												<Button type="submit" variant="tertiary-neutral" size="xsmall" icon={<TrashIcon aria-hidden />}>
													Fjern
												</Button>
											</Form>
										</Table.DataCell>
									)}
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				) : (
					<Box padding="space-6" borderRadius="8" background="sunken">
						<BodyShort>Ingen lenker er lagt til denne gjennomgangen.</BodyShort>
					</Box>
				)}
			</VStack>

			{/* Add link — only for drafts */}
			{isDraft && <AddLinkSection />}

			{/* Upload section — only for drafts */}
			{isDraft && <UploadSection reviewId={review.id} />}

			{/* Complete section — only for drafts */}
			{isDraft && <CompleteSection followUpPoints={review.followUpPoints} />}

			{/* Discard section — only for drafts */}
			{isDraft && <DiscardSection />}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
