import type { ActionFunctionArgs } from "react-router"
import { data, redirect } from "react-router"
import {
	addReviewLink,
	completeReview,
	deleteReviewLink,
	discardReview,
	getReview,
	getReviewActivity,
	recordEntraChange,
	updateReview,
} from "~/db/queries/routines.server"
import { type GroupCriticality, groupCriticalityEnum } from "~/db/schema/applications"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import type { ActionResult } from "./shared"

export async function action({ request, params }: ActionFunctionArgs) {
	const { gjennomgangId } = params
	if (!gjennomgangId) {
		throw data({ message: "Mangler parametere" }, { status: 400 })
	}

	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)

	const formData = await request.formData()
	const intent = formData.get("intent") as string

	if (intent === "update-review") {
		const title = (formData.get("title") as string)?.trim()
		const summary = (formData.get("summary") as string)?.trim() || null
		const reviewedAt = formData.get("reviewedAt") as string
		const reviewedTime = (formData.get("reviewedTime") as string) || "00:00"
		const participantsRaw = (formData.get("participants") as string)?.trim() || ""

		if (!title) {
			return data<ActionResult>({ success: false, error: "Tittel er påkrevd", intent: "update-review" })
		}

		const participants = participantsRaw
			.split(",")
			.map((ident) => ident.trim())
			.filter(Boolean)
			.map((ident) => ({ userIdent: ident, userName: ident }))

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
		if (review.status === "completed") {
			return data<ActionResult>({ success: false, error: "Gjennomgangen er allerede fullført.", intent: "complete" })
		}

		await completeReview(gjennomgangId, authedUser.navIdent)

		return data<ActionResult>({
			success: true,
			message: "Gjennomgangen er fullført.",
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
		await deleteReviewLink(linkId, authedUser.navIdent)
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

	return data<ActionResult>({ success: false, error: "Ukjent handling" })
}
