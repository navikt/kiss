/**
 * CRUD and sync functions for application_controls — the materialized compliance cache.
 *
 * `syncApplicationControls(appId)` is the main entry point. It runs the existing
 * auto-compliance computation and persists the results, handling soft-delete,
 * re-activation, and history tracking.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import type { ComplianceStatus, RoutineCompliance, RoutineEstablishment } from "~/lib/compliance-status"
import { db } from "../connection.server"
import { applicationControlHistory, applicationControls } from "../schema/application-controls"
import { monitoredApplications } from "../schema/applications"
import { routineControls as routineControlsTable } from "../schema/routines"

// ─── Types ───────────────────────────────────────────────────────────────

interface SyncResult {
	activated: number
	deactivated: number
	reactivated: number
	statusChanged: number
	unchanged: number
}

/** Key for identifying a unique assessment row */
function assessmentKey(controlId: string, technologyElementId: string | null): string {
	return `${controlId}:${technologyElementId ?? "null"}`
}

// ─── Sync function ───────────────────────────────────────────────────────

/**
 * Recompute and persist which controls apply to an application, along with
 * their auto-compliance status. This is the main sync entry point.
 *
 * Handles:
 * - Inserting new applicable controls
 * - Soft-deactivating controls that no longer apply (preserving comments)
 * - Re-activating previously deactivated controls (restoring comments)
 * - Updating status when it changes
 * - Writing history entries for all changes
 */
export async function syncApplicationControls(appId: string, performedBy = "system"): Promise<SyncResult | null> {
	// Lazy-import to avoid circular dependencies
	const { getAppAssessments } = await import("./applications.server")
	const { getScreeningEffectsByControlForApp } = await import("./compliance-auto.server")
	const {
		getRoutineDeadlinesForApp,
		getRoutineDeadlinesForAppByGroupClassification,
		getRoutineDeadlinesForAppByOracleRoleCriticality,
		getRoutineDeadlinesForAppByPersistence,
		getRoutineDeadlinesForAppByScreeningSelection,
		getRoutineDeadlinesForAppBySection,
		getRoutineDeadlinesForAppByRuleset,
	} = await import("./routines.server")
	const { computeAutoCompliance } = await import("~/lib/auto-compliance")

	// 1. Get expected assessment rows
	const assessmentsResult = await getAppAssessments(appId)
	if (!assessmentsResult) return null

	// 2. Compute routine deadlines (same logic as detail page loader)
	const screeningRoutines = await getRoutineDeadlinesForApp(appId)
	const screeningRoutineIds = new Set(screeningRoutines.map((d) => d.routine?.id).filter(Boolean) as string[])
	const persistenceRoutines = await getRoutineDeadlinesForAppByPersistence(appId, screeningRoutineIds)
	const afterPersistenceIds = new Set([
		...screeningRoutineIds,
		...(persistenceRoutines.map((d) => d.routine?.id).filter(Boolean) as string[]),
	])
	const groupClassificationRoutines = await getRoutineDeadlinesForAppByGroupClassification(appId, afterPersistenceIds)
	const afterGroupIds = new Set([
		...afterPersistenceIds,
		...(groupClassificationRoutines.map((d) => d.routine?.id).filter(Boolean) as string[]),
	])
	const oracleRoleCriticalityRoutines = await getRoutineDeadlinesForAppByOracleRoleCriticality(appId, afterGroupIds)
	const alreadyMatchedIds = new Set([
		...afterGroupIds,
		...(oracleRoleCriticalityRoutines.map((d) => d.routine?.id).filter(Boolean) as string[]),
	])
	const screeningSelectionRoutines = await getRoutineDeadlinesForAppByScreeningSelection(appId, alreadyMatchedIds)
	const allMatchedIds = new Set([
		...alreadyMatchedIds,
		...(screeningSelectionRoutines.map((d) => d.routine?.id).filter(Boolean) as string[]),
	])
	const sectionWideRoutines = await getRoutineDeadlinesForAppBySection(appId, allMatchedIds)
	const allMatchedBeforeRuleset = new Set([
		...allMatchedIds,
		...(sectionWideRoutines.map((d) => d.routine?.id).filter(Boolean) as string[]),
	])
	const rulesetRoutines = await getRoutineDeadlinesForAppByRuleset(appId, allMatchedBeforeRuleset)

	const routineDeadlines = [
		...screeningRoutines.map((d) => ({ ...d, matchSource: "screening" as const })),
		...persistenceRoutines.map((d) => ({ ...d, matchSource: "persistence" as const })),
		...groupClassificationRoutines.map((d) => ({ ...d, matchSource: "group_classification" as const })),
		...oracleRoleCriticalityRoutines.map((d) => ({ ...d, matchSource: "oracle_role_criticality" as const })),
		...screeningSelectionRoutines.map((d) => ({ ...d, matchSource: "screening_selection" as const })),
		...sectionWideRoutines.map((d) => ({ ...d, matchSource: "section" as const })),
		...rulesetRoutines.map((d) => ({ ...d, matchSource: "ruleset" as const })),
	]

	// 3. Load routine → control mappings
	const allRoutineIds = [...new Set(routineDeadlines.map((d) => d.routine?.id).filter(Boolean) as string[])]
	const routineControlsMap = new Map<string, Array<{ id: string }>>()
	if (allRoutineIds.length > 0) {
		const controlRows = await db
			.select({
				routineId: routineControlsTable.routineId,
				controlId: routineControlsTable.controlId,
			})
			.from(routineControlsTable)
			.where(and(inArray(routineControlsTable.routineId, allRoutineIds), isNull(routineControlsTable.archivedAt)))
		for (const row of controlRows) {
			const list = routineControlsMap.get(row.routineId) ?? []
			list.push({ id: row.controlId })
			routineControlsMap.set(row.routineId, list)
		}
	}

	const deadlinesWithControls = routineDeadlines.map((d) => ({
		...d,
		routine: d.routine ? { ...d.routine, controls: routineControlsMap.get(d.routine.id) ?? [] } : d.routine,
	}))

	// 4. Compute auto-compliance
	const screeningEffectsByControl = await getScreeningEffectsByControlForApp(appId)
	const autoComplianceMap = computeAutoCompliance(
		assessmentsResult.assessments.map((a) => ({
			controlUuid: a.controlUuid,
			technologyElementId: a.technologyElementId,
			status: null,
		})),
		deadlinesWithControls,
		screeningEffectsByControl,
	)

	// 5. Build the expected set from computed results
	const expectedRows = new Map<
		string,
		{
			controlId: string
			technologyElementId: string | null
			status: ComplianceStatus | null
			autoReason: string | null
			establishment: RoutineEstablishment
			routineCompliance: RoutineCompliance
			routinesEstablished: number
			routinesCompleted: number
			routinesOverdue: number
			matchSources: string[]
			matchingRoutineIds: string[]
			isScreeningDerived: boolean
		}
	>()

	for (const a of assessmentsResult.assessments) {
		const key = assessmentKey(a.controlUuid, a.technologyElementId)
		const auto = autoComplianceMap.get(key)
		expectedRows.set(key, {
			controlId: a.controlUuid,
			technologyElementId: a.technologyElementId,
			status: auto?.autoStatus ?? null,
			autoReason: auto?.reason ?? null,
			establishment: auto?.establishment ?? "not_established",
			routineCompliance: auto?.compliance ?? "not_applicable",
			routinesEstablished: auto?.routinesEstablished ?? 0,
			routinesCompleted: auto?.routinesCompleted ?? 0,
			routinesOverdue: auto?.routinesOverdue ?? 0,
			matchSources: auto?.sources ?? [],
			matchingRoutineIds: auto?.matchingRoutineIds ?? [],
			isScreeningDerived: a.isScreeningDerived,
		})
	}

	// 6. Load existing persisted rows for this app
	const existingRows = await db.select().from(applicationControls).where(eq(applicationControls.applicationId, appId))

	const existingByKey = new Map<string, (typeof existingRows)[0]>()
	for (const row of existingRows) {
		existingByKey.set(assessmentKey(row.controlId, row.technologyElementId), row)
	}

	// 7. Diff and apply changes
	const result: SyncResult = {
		activated: 0,
		deactivated: 0,
		reactivated: 0,
		statusChanged: 0,
		unchanged: 0,
	}
	const now = new Date()

	// Process expected rows: insert new, reactivate deactivated, update changed
	for (const [key, expected] of expectedRows) {
		const existing = existingByKey.get(key)

		if (!existing) {
			// New control — insert
			const [inserted] = await db
				.insert(applicationControls)
				.values({
					applicationId: appId,
					controlId: expected.controlId,
					technologyElementId: expected.technologyElementId,
					status: expected.status,
					autoReason: expected.autoReason,
					establishment: expected.establishment,
					routineCompliance: expected.routineCompliance,
					routinesEstablished: expected.routinesEstablished,
					routinesCompleted: expected.routinesCompleted,
					routinesOverdue: expected.routinesOverdue,
					matchSources: expected.matchSources,
					matchingRoutineIds: expected.matchingRoutineIds,
					isScreeningDerived: expected.isScreeningDerived,
					isActive: true,
					activatedAt: now,
					createdBy: performedBy,
					updatedBy: performedBy,
				})
				.returning({ id: applicationControls.id })

			await db.insert(applicationControlHistory).values({
				applicationControlId: inserted.id,
				action: "activated",
				newStatus: expected.status,
				reason: "Control became applicable",
				performedBy,
				performedAt: now,
			})

			result.activated++
		} else if (!existing.isActive) {
			// Previously deactivated — reactivate (preserve comment!)
			await db
				.update(applicationControls)
				.set({
					status: expected.status,
					autoReason: expected.autoReason,
					establishment: expected.establishment,
					routineCompliance: expected.routineCompliance,
					routinesEstablished: expected.routinesEstablished,
					routinesCompleted: expected.routinesCompleted,
					routinesOverdue: expected.routinesOverdue,
					matchSources: expected.matchSources,
					matchingRoutineIds: expected.matchingRoutineIds,
					isScreeningDerived: expected.isScreeningDerived,
					isActive: true,
					activatedAt: now,
					deactivatedAt: null,
					deactivatedReason: null,
					updatedAt: now,
					updatedBy: performedBy,
				})
				.where(eq(applicationControls.id, existing.id))

			await db.insert(applicationControlHistory).values({
				applicationControlId: existing.id,
				action: "activated",
				previousStatus: existing.status as ComplianceStatus | null,
				newStatus: expected.status,
				reason: "Control became applicable again",
				performedBy,
				performedAt: now,
			})

			result.reactivated++
		} else if (existing.status !== expected.status) {
			// Active but status changed
			await db
				.update(applicationControls)
				.set({
					status: expected.status,
					autoReason: expected.autoReason,
					establishment: expected.establishment,
					routineCompliance: expected.routineCompliance,
					routinesEstablished: expected.routinesEstablished,
					routinesCompleted: expected.routinesCompleted,
					routinesOverdue: expected.routinesOverdue,
					matchSources: expected.matchSources,
					matchingRoutineIds: expected.matchingRoutineIds,
					isScreeningDerived: expected.isScreeningDerived,
					updatedAt: now,
					updatedBy: performedBy,
				})
				.where(eq(applicationControls.id, existing.id))

			await db.insert(applicationControlHistory).values({
				applicationControlId: existing.id,
				action: "status_changed",
				previousStatus: existing.status as ComplianceStatus | null,
				newStatus: expected.status,
				reason: "Auto-compliance status recalculated",
				performedBy,
				performedAt: now,
			})

			result.statusChanged++
		} else {
			// Update metadata fields even when status hasn't changed
			await db
				.update(applicationControls)
				.set({
					autoReason: expected.autoReason,
					establishment: expected.establishment,
					routineCompliance: expected.routineCompliance,
					routinesEstablished: expected.routinesEstablished,
					routinesCompleted: expected.routinesCompleted,
					routinesOverdue: expected.routinesOverdue,
					matchSources: expected.matchSources,
					matchingRoutineIds: expected.matchingRoutineIds,
					isScreeningDerived: expected.isScreeningDerived,
					updatedAt: now,
					updatedBy: performedBy,
				})
				.where(eq(applicationControls.id, existing.id))

			result.unchanged++
		}
	}

	// Deactivate rows that are currently active but no longer expected
	for (const [key, existing] of existingByKey) {
		if (!expectedRows.has(key) && existing.isActive) {
			await db
				.update(applicationControls)
				.set({
					isActive: false,
					deactivatedAt: now,
					deactivatedReason: "Control no longer applicable",
					updatedAt: now,
					updatedBy: performedBy,
				})
				.where(eq(applicationControls.id, existing.id))

			await db.insert(applicationControlHistory).values({
				applicationControlId: existing.id,
				action: "deactivated",
				previousStatus: existing.status as ComplianceStatus | null,
				reason: "Control no longer applicable",
				performedBy,
				performedAt: now,
			})

			result.deactivated++
		}
	}

	return result
}

// ─── Batch sync ──────────────────────────────────────────────────────────

/**
 * Sync all monitored applications. Uses advisory lock to prevent
 * concurrent runs across pods.
 */
export async function syncAllApplicationControls(performedBy = "system"): Promise<{
	synced: number
	errors: number
}> {
	const { withAdvisoryLock } = await import("~/lib/lock.server")

	const lockResult = await withAdvisoryLock("sync-all-application-controls", async () => {
		const apps = await db
			.select({ id: monitoredApplications.id })
			.from(monitoredApplications)
			.where(isNull(monitoredApplications.primaryApplicationId))

		let synced = 0
		let errors = 0

		for (const app of apps) {
			try {
				await syncApplicationControls(app.id, performedBy)
				synced++
			} catch (_err) {
				errors++
			}
		}

		return { synced, errors }
	})

	return lockResult ?? { synced: 0, errors: 0 }
}

// ─── Comment CRUD ────────────────────────────────────────────────────────

/** Update the user comment on an application control. */
export async function updateControlComment(
	applicationControlId: string,
	comment: string | null,
	performedBy: string,
): Promise<void> {
	const [existing] = await db
		.select({
			id: applicationControls.id,
			comment: applicationControls.comment,
		})
		.from(applicationControls)
		.where(eq(applicationControls.id, applicationControlId))
		.limit(1)

	if (!existing) return

	const now = new Date()
	await db
		.update(applicationControls)
		.set({
			comment,
			commentUpdatedAt: now,
			commentUpdatedBy: performedBy,
			updatedAt: now,
			updatedBy: performedBy,
		})
		.where(eq(applicationControls.id, applicationControlId))

	await db.insert(applicationControlHistory).values({
		applicationControlId,
		action: "comment_changed",
		previousComment: existing.comment,
		newComment: comment,
		performedBy,
		performedAt: now,
	})
}

// ─── History ─────────────────────────────────────────────────────────────

/** Get change history for an application control. */
export async function getControlHistory(applicationControlId: string) {
	return db
		.select()
		.from(applicationControlHistory)
		.where(eq(applicationControlHistory.applicationControlId, applicationControlId))
		.orderBy(sql`${applicationControlHistory.performedAt} DESC`)
}

// ─── Aggregation queries ─────────────────────────────────────────────────

export interface ComplianceStats {
	implemented: number
	partial: number
	notImplemented: number
	notRelevant: number
}

/**
 * Get compliance status counts per app from the materialized application_controls table.
 *
 * Callers are responsible for passing the correct app IDs — linked apps should
 * resolve via `primaryApplicationId` before calling this function.
 */
export async function getBatchComplianceStats(appIds: string[]): Promise<Map<string, ComplianceStats>> {
	const result = new Map<string, ComplianceStats>()
	if (appIds.length === 0) return result

	for (const id of appIds) {
		result.set(id, { implemented: 0, partial: 0, notImplemented: 0, notRelevant: 0 })
	}

	const rows = await db
		.select({
			applicationId: applicationControls.applicationId,
			status: applicationControls.status,
			cnt: sql<number>`count(*)::int`,
		})
		.from(applicationControls)
		.where(and(inArray(applicationControls.applicationId, appIds), eq(applicationControls.isActive, true)))
		.groupBy(applicationControls.applicationId, applicationControls.status)

	for (const row of rows) {
		const stats = result.get(row.applicationId)
		if (!stats) continue
		switch (row.status) {
			case "implemented":
				stats.implemented += row.cnt
				break
			case "partially_implemented":
				stats.partial += row.cnt
				break
			case "not_implemented":
				stats.notImplemented += row.cnt
				break
			case "not_relevant":
				stats.notRelevant += row.cnt
				break
		}
	}

	return result
}

export interface ComplianceSummary extends ComplianceStats {
	total: number
}

/**
 * Get a complete compliance summary per app: status counts + total.
 *
 * Uses a single SQL query against the materialized `application_controls` table.
 * The total is the count of all active rows (each row represents one expected
 * assessment item, already expanded by technology element matching during sync).
 */
export async function getComplianceSummaries(appIds: string[]): Promise<Map<string, ComplianceSummary>> {
	const result = new Map<string, ComplianceSummary>()
	if (appIds.length === 0) return result
	for (const id of appIds) {
		result.set(id, { implemented: 0, partial: 0, notImplemented: 0, notRelevant: 0, total: 0 })
	}

	const rows = await db
		.select({
			applicationId: applicationControls.applicationId,
			total: sql<number>`count(*)::int`,
			implemented: sql<number>`count(*) filter (where ${applicationControls.status} = 'implemented')::int`,
			partial: sql<number>`count(*) filter (where ${applicationControls.status} = 'partially_implemented')::int`,
			notImplemented: sql<number>`count(*) filter (where ${applicationControls.status} = 'not_implemented')::int`,
			notRelevant: sql<number>`count(*) filter (where ${applicationControls.status} = 'not_relevant')::int`,
		})
		.from(applicationControls)
		.where(and(inArray(applicationControls.applicationId, appIds), eq(applicationControls.isActive, true)))
		.groupBy(applicationControls.applicationId)

	for (const row of rows) {
		result.set(row.applicationId, {
			implemented: row.implemented,
			partial: row.partial,
			notImplemented: row.notImplemented,
			notRelevant: row.notRelevant,
			total: row.total,
		})
	}

	return result
}

// ─── Read helpers ────────────────────────────────────────────────────────

/** Get all active application controls for an app. */
export async function getActiveApplicationControls(appId: string) {
	return db
		.select()
		.from(applicationControls)
		.where(and(eq(applicationControls.applicationId, appId), eq(applicationControls.isActive, true)))
}
