/**
 * Shared enrichment for application assessments used by report/PDF generation.
 *
 * Combines raw assessments from `getAppAssessments()` with:
 *   - auto-computed effective compliance status (screening + routine deadlines)
 *   - persisted comment metadata from `application_controls`
 *
 * Centralized to keep the on-demand PDF route and the persisted report
 * generator in sync — both rely on the same composite key format
 * (`${controlUuid}:${technologyElementId ?? "null"}`) and enrichment rules.
 *
 * Missing routine/screening tables (e.g., during early bootstrap) are treated
 * as empty inputs so report generation continues to degrade gracefully, in
 * line with the existing fallback for `getReviewsForApp`.
 */
import { computeAutoCompliance } from "../../lib/auto-compliance"
import type { ComplianceStatus } from "../../lib/compliance-status"
import { logger } from "../../lib/logger.server"
import { getActiveApplicationControls } from "./application-controls.server"
import { getScreeningEffectsByControlForApp } from "./compliance-auto.server"
import { getRoutineDeadlinesWithControls } from "./routine-deadlines.server"

interface RawAssessment {
	controlUuid: string
	technologyElementId: string | null
}

export type EnrichedAssessment<T extends RawAssessment> = T & {
	effectiveStatus: ComplianceStatus | null
	comment: string | null
	commentUpdatedBy: string | null
	commentUpdatedAt: string | null
}

async function safe<T>(fn: () => Promise<T>, fallback: T, label: string): Promise<T> {
	try {
		return await fn()
	} catch (err) {
		logger.warn("App assessment enrichment dependency unavailable", { label, error: String(err) })
		return fallback
	}
}

/**
 * Enrich raw assessments with effective compliance status and persisted comments.
 *
 * Returns the input rows with four added fields: `effectiveStatus`, `comment`,
 * `commentUpdatedBy`, and `commentUpdatedAt`.
 */
export async function enrichAppAssessments<T extends RawAssessment>(
	appId: string,
	rawAssessments: T[],
): Promise<EnrichedAssessment<T>[]> {
	const [deadlinesWithControls, screeningEffects, persistedControls] = await Promise.all([
		safe(() => getRoutineDeadlinesWithControls(appId), [], "routine-deadlines"),
		safe(
			() => getScreeningEffectsByControlForApp(appId),
			new Map() as Awaited<ReturnType<typeof getScreeningEffectsByControlForApp>>,
			"screening-effects",
		),
		safe(() => getActiveApplicationControls(appId), [], "application-controls"),
	])

	const autoMap = computeAutoCompliance(
		rawAssessments.map((a) => ({
			controlUuid: a.controlUuid,
			technologyElementId: a.technologyElementId,
			status: null,
		})),
		deadlinesWithControls,
		screeningEffects,
	)
	const persistedMap = new Map(persistedControls.map((c) => [`${c.controlId}:${c.technologyElementId ?? "null"}`, c]))

	return rawAssessments.map((a) => {
		const key = `${a.controlUuid}:${a.technologyElementId ?? "null"}`
		const auto = autoMap.get(key)
		const persisted = persistedMap.get(key)
		return {
			...a,
			effectiveStatus: auto?.autoStatus ?? null,
			comment: persisted?.comment ?? null,
			commentUpdatedBy: persisted?.commentUpdatedBy ?? null,
			commentUpdatedAt: persisted?.commentUpdatedAt?.toISOString() ?? null,
		}
	})
}
