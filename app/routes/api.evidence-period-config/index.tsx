/**
 * API route for saving period configuration on review activities.
 *
 * POST /api/evidence-period-config
 *
 * Used by the deployment evidence UI to persist the user's period selection
 * (periodType + periodStart) on the review activity.
 */

import { type ActionFunctionArgs, data } from "react-router"
import { getActivityContext } from "~/db/queries/evidence-downloads.server"
import { savePeriodConfig } from "~/db/queries/routines.server"
import { isDeploymentEvidenceActivityType } from "~/lib/activity-types"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAnySectionRole } from "~/lib/authorization.server"
import { isPeriodEnded, isValidPeriodStart, isValidPeriodType, PERIOD_TYPES } from "~/lib/period-validation"
import { isValidUuid } from "~/lib/utils"

// ─── Action ─────────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
	if (request.method !== "POST") {
		throw data({ error: "Method not allowed" }, { status: 405 })
	}

	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)

	const formData = await request.formData()
	const activityId = formData.get("activityId")
	const periodType = formData.get("periodType")
	const periodStart = formData.get("periodStart")

	if (typeof activityId !== "string" || !activityId) {
		throw data({ error: "activityId er påkrevd" }, { status: 400 })
	}
	if (!isValidUuid(activityId)) {
		throw data({ error: "Ugyldig activityId-format" }, { status: 400 })
	}

	const ctx = await getActivityContext(activityId)
	if (!ctx) throw data({ error: "Aktivitet ikke funnet" }, { status: 404 })
	requireAnySectionRole(authedUser, ctx.sectionId)
	if (ctx.reviewStatus !== "draft") {
		throw data({ error: `Gjennomgangen kan ikke endres (status: ${ctx.reviewStatus})` }, { status: 403 })
	}
	if (ctx.activityStatus !== "pending") {
		throw data({ error: "Aktiviteten er allerede fullført" }, { status: 403 })
	}
	if (ctx.routineArchivedAt) {
		throw data({ error: "Rutinen er arkivert" }, { status: 403 })
	}

	if (!isDeploymentEvidenceActivityType(ctx.activityType)) {
		throw data(
			{ error: `Periodekonfigurasjon støttes ikke for aktivitetstypen '${ctx.activityType}'` },
			{ status: 400 },
		)
	}

	if (typeof periodType !== "string" || !isValidPeriodType(periodType)) {
		throw data(
			{ error: `Ugyldig periodType: ${periodType}. Gyldige verdier: ${PERIOD_TYPES.join(", ")}` },
			{ status: 400 },
		)
	}
	if (typeof periodStart !== "string" || !isValidPeriodStart(periodType, periodStart)) {
		throw data({ error: `Ugyldig periodStart: ${periodStart} for periodType ${periodType}` }, { status: 400 })
	}
	if (!isPeriodEnded(periodType, periodStart)) {
		throw data({ error: "Perioden er ikke avsluttet ennå" }, { status: 400 })
	}

	await savePeriodConfig(activityId, { periodType, periodStart })

	return data({ success: true, periodConfig: { periodType, periodStart } })
}
