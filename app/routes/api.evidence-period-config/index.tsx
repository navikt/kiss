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
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAnySectionRole } from "~/lib/authorization.server"
import { PERIOD_TYPES, type PeriodType } from "~/lib/nda-audit-reports.server"
import { isValidUuid } from "~/lib/utils"

// ─── Period validation helpers ──────────────────────────────────────────────

const PERIOD_BOUNDARIES: Record<PeriodType, number[]> = {
	yearly: [1],
	tertiary: [1, 5, 9],
	quarterly: [1, 4, 7, 10],
	monthly: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
}

function isValidPeriodType(value: string): value is PeriodType {
	return (PERIOD_TYPES as readonly string[]).includes(value)
}

function isValidPeriodStart(periodType: PeriodType, periodStart: string): boolean {
	const match = periodStart.match(/^(\d{4})-(\d{2})-(\d{2})$/)
	if (!match) return false

	const month = Number.parseInt(match[2], 10)
	const day = Number.parseInt(match[3], 10)

	if (day !== 1) return false
	return PERIOD_BOUNDARIES[periodType].includes(month)
}

function isPeriodEnded(periodType: PeriodType, periodStart: string): boolean {
	const startDate = new Date(periodStart)
	if (Number.isNaN(startDate.getTime())) return false

	const year = startDate.getFullYear()
	const month = startDate.getMonth()

	let endDate: Date
	switch (periodType) {
		case "yearly":
			endDate = new Date(year + 1, 0, 1)
			break
		case "tertiary":
			endDate = new Date(year, month + 4, 1)
			break
		case "quarterly":
			endDate = new Date(year, month + 3, 1)
			break
		case "monthly":
			endDate = new Date(year, month + 1, 1)
			break
	}

	return endDate <= new Date()
}

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

	return { success: true, periodConfig: { periodType, periodStart } }
}

// Export validation helpers for testing
export { isPeriodEnded, isValidPeriodStart, isValidPeriodType, PERIOD_BOUNDARIES }
