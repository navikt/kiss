import type { LoaderFunctionArgs } from "react-router"
import { data } from "react-router"
import { autoCreateActivityForReview, getReview, getReviewActivity, getRoutine } from "~/db/queries/routines.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { renderMarkdown } from "~/lib/markdown.server"

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
		},
	})
}
