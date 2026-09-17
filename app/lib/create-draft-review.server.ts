/**
 * Shared validation and creation logic for draft reviews, used by multiple routes.
 * Returns a plain result object — callers construct the final Response/redirect
 * so TypeScript can infer action return types correctly.
 */

import { isUniqueViolation } from "~/db/pg-errors.server"
import {
	createReview,
	findActiveReviewConflict,
	getAppsRequiringRoutine,
	getReviewDetailAccessScope,
	getRoutine,
	getRoutineActivityLinks,
} from "~/db/queries/routines.server"
import { getSectionBySlug, isAppEffectiveInSection } from "~/db/queries/sections.server"
import { activityTypeLabels, type RoutineActivityType } from "~/lib/activity-types"
import type { NavUser } from "~/lib/auth.server"
import { canViewReviewDetail } from "~/lib/authorization.server"
import { isValidUuid } from "~/lib/utils"

export type CreateDraftReviewSuccess = {
	ok: true
	reviewId: string
	routineId: string
	sectionSlug: string
}

export type CreateDraftReviewFailure = {
	ok: false
	error: string
	status: number
}

export type CreateDraftReviewResult = CreateDraftReviewSuccess | CreateDraftReviewFailure

/**
 * Validates inputs and creates a draft review.
 *
 * NOTE: This function does NOT perform authentication or access control.
 * The caller is responsible for ensuring the user is authenticated and authorized
 * before invoking this function.
 *
 * Validates:
 * - Section routines: validates that `applicationId` (if provided) is effectively in the section.
 * - Non-section routines: requires `applicationId` and verifies the routine applies to that app.
 * - Checks for active review conflicts before creating.
 */
export async function createDraftReview(params: {
	routineId: string | null
	sectionSlug: string | null
	applicationId: string | null
	user: NavUser
}): Promise<CreateDraftReviewResult> {
	const { routineId, sectionSlug, applicationId, user } = params
	const navIdent = user.navIdent

	if (!routineId) return { ok: false, error: "Mangler rutine-ID", status: 400 }
	if (!isValidUuid(routineId)) return { ok: false, error: "Ugyldig rutine-ID-format", status: 400 }
	if (!sectionSlug || typeof sectionSlug !== "string") return { ok: false, error: "Mangler seksjons-slug", status: 400 }
	if (applicationId !== null && !isValidUuid(applicationId)) {
		return { ok: false, error: "Ugyldig applikasjons-ID-format", status: 400 }
	}

	const routine = await getRoutine(routineId)
	if (!routine) return { ok: false, error: "Fant ikke rutine", status: 404 }
	if (routine.archivedAt) {
		return { ok: false, error: "Kan ikke opprette gjennomgang for en arkivert rutine", status: 403 }
	}
	if (routine.status !== "approved") {
		return { ok: false, error: "Kun godkjente rutiner kan ha nye gjennomganger", status: 400 }
	}

	const section = await getSectionBySlug(sectionSlug)
	if (!section || routine.sectionId !== section.id) {
		return { ok: false, error: "Rutinen tilhører ikke denne seksjonen", status: 403 }
	}

	if (routine.isSectionRoutine === 1) {
		if (applicationId) {
			const isMember = await isAppEffectiveInSection(applicationId, section.id)
			if (!isMember) {
				return { ok: false, error: "Applikasjonen tilhører ikke denne seksjonen", status: 403 }
			}
		}
	} else {
		if (!applicationId) {
			return { ok: false, error: "Mangler applikasjons-ID for applikasjonsrutine", status: 400 }
		}
		const appsRequiring = await getAppsRequiringRoutine(routineId, { routineData: routine })
		if (!appsRequiring.some((a) => a.id === applicationId)) {
			return { ok: false, error: "Rutinen gjelder ikke for denne applikasjonen", status: 403 }
		}
	}

	const effectiveAppId = routine.isSectionRoutine === 1 ? null : applicationId
	const activityLinks = await getRoutineActivityLinks(routineId)
	const activityTypes = activityLinks.map((l) => l.activityType)

	// Bygger en konfliktrespons som ikke avslører at en gjennomgang finnes hvis brukeren ikke
	// har detaljtilgang til den — ellers lekker en generisk 409 informasjon om et utkast
	// brukeren ellers ikke skulle visst om (se canViewReviewDetail).
	async function buildConflictResponse(conflict: {
		activityType: RoutineActivityType | null
		reviewId: string
	}): Promise<CreateDraftReviewFailure> {
		const conflictScope = await getReviewDetailAccessScope(conflict.reviewId)
		if (!conflictScope || !canViewReviewDetail(user, conflictScope)) {
			return { ok: false, error: "Kan ikke opprette gjennomgang for denne rutinen nå.", status: 409 }
		}
		const conflictMessage = conflict.activityType
			? `Det finnes allerede en aktiv gjennomgang for «${activityTypeLabels[conflict.activityType] ?? conflict.activityType}». Fullfør eller forkast den eksisterende gjennomgangen før du oppretter en ny.`
			: "Det finnes allerede en aktiv gjennomgang for denne rutinen. Fullfør eller forkast den eksisterende gjennomgangen før du oppretter en ny."
		return { ok: false, error: conflictMessage, status: 409 }
	}

	const conflict = await findActiveReviewConflict(routineId, effectiveAppId, activityTypes)
	if (conflict) {
		return buildConflictResponse(conflict)
	}

	const now = new Date()
	const title = `${routine.name} — ${now.toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" })}`
	try {
		const review = await createReview({
			routineId,
			applicationId: effectiveAppId,
			title,
			summary: null,
			routineSnapshotPath: null,
			reviewedAt: now,
			createdBy: navIdent,
			participants: [],
		})
		return { ok: true, reviewId: review.id, routineId, sectionSlug }
	} catch (err) {
		if (isUniqueViolation(err)) {
			// En annen forespørsel opprettet en konflikterende gjennomgang mellom sjekken over og
			// innsettingen her (race). Slå opp konflikten på nytt slik at samme tilgangssjekk
			// gjelder her som i det ikke-samtidige tilfellet over.
			// findActiveReviewConflict filtrerer på rutinens nåværende aktivitetstyper, mens den
			// unike databaseindeksen forkaster enhver aktiv gjennomgang for samme rutine/app
			// uavhengig av aktivitetstype. Bruk derfor alltid den generiske meldingen her —
			// vi kan ikke garantere at raceConflict finner den faktiske konflikten som forårsaket
			// unik-brudd, og en detaljert melding ville da kunne avsløre en skjult gjennomgang.
			const raceConflict = await findActiveReviewConflict(routineId, effectiveAppId, activityTypes)
			if (raceConflict) return buildConflictResponse(raceConflict)
			return { ok: false, error: "Kan ikke opprette gjennomgang for denne rutinen nå.", status: 409 }
		}
		throw err
	}
}
