import { and, eq, inArray, isNull, lt } from "drizzle-orm"
import { db } from "../connection.server"
import { hasPostgresCode, PgErrorCode } from "../pg-errors.server"
import { applicationEconomyClassifications, type EconomySystemType } from "../schema/applications"
import { screeningAnswers } from "../schema/screening"
import { writeAuditLog } from "./audit.server"
import { getFilteredSectionAppIds } from "./nais.server"

export type EconomyClassification = typeof applicationEconomyClassifications.$inferSelect

/** Get the active (non-archived) economy classification for an application. */
export async function getEconomyClassification(applicationId: string): Promise<EconomyClassification | undefined> {
	const [row] = await db
		.select()
		.from(applicationEconomyClassifications)
		.where(
			and(
				eq(applicationEconomyClassifications.applicationId, applicationId),
				isNull(applicationEconomyClassifications.archivedAt),
			),
		)
		.limit(1)
	return row
}

/** Get economy classifications for multiple applications (batch). */
export async function getEconomyClassifications(applicationIds: string[]): Promise<Map<string, EconomyClassification>> {
	if (applicationIds.length === 0) return new Map()

	const rows = await db
		.select()
		.from(applicationEconomyClassifications)
		.where(
			and(
				inArray(applicationEconomyClassifications.applicationId, applicationIds),
				isNull(applicationEconomyClassifications.archivedAt),
			),
		)

	const map = new Map<string, EconomyClassification>()
	for (const row of rows) {
		map.set(row.applicationId, row)
	}
	return map
}

/**
 * Count economy-system applications in a section. Uses getFilteredSectionAppIds
 * — the same shared filtering path as the /okonomisystemer page — so the card
 * count and the list cannot diverge.
 *
 * Returns both the total count and how many have an expired classification
 * (validUntil < now). Both counts include expired classifications.
 */
export async function countSectionEconomySystems(
	sectionId: string,
): Promise<{ totalCount: number; expiredCount: number }> {
	const filteredIds = await getFilteredSectionAppIds(sectionId)
	if (filteredIds.length === 0) return { totalCount: 0, expiredCount: 0 }

	const now = new Date()

	const [allRows, expiredRows] = await Promise.all([
		db
			.select({ applicationId: applicationEconomyClassifications.applicationId })
			.from(applicationEconomyClassifications)
			.where(
				and(
					inArray(applicationEconomyClassifications.applicationId, filteredIds),
					isNull(applicationEconomyClassifications.archivedAt),
					eq(applicationEconomyClassifications.isEconomySystem, true),
				),
			),
		db
			.select({ applicationId: applicationEconomyClassifications.applicationId })
			.from(applicationEconomyClassifications)
			.where(
				and(
					inArray(applicationEconomyClassifications.applicationId, filteredIds),
					isNull(applicationEconomyClassifications.archivedAt),
					eq(applicationEconomyClassifications.isEconomySystem, true),
					lt(applicationEconomyClassifications.validUntil, now),
				),
			),
	])

	return { totalCount: allRows.length, expiredCount: expiredRows.length }
}

/** Get all active economy classifications (for admin overview). */
export async function getAllEconomyClassifications() {
	return db
		.select()
		.from(applicationEconomyClassifications)
		.where(isNull(applicationEconomyClassifications.archivedAt))
		.orderBy(applicationEconomyClassifications.createdAt)
}

/** Save (create or update) an economy classification for an application. */
export async function saveEconomyClassification(
	params: {
		applicationId: string
		isEconomySystem: boolean
		economySystemType: EconomySystemType | null
		justification: string
		performedBy: string
		questionId?: string
	},
	retryCount = 0,
): Promise<EconomyClassification> {
	const { applicationId, isEconomySystem, economySystemType, justification, performedBy, questionId } = params

	const now = new Date()
	const validUntil = new Date(now)
	validUntil.setFullYear(validUntil.getFullYear() + 1)

	try {
		return await db.transaction(async (tx) => {
			// Lock existing active row to prevent concurrent modifications
			const [existing] = await tx
				.select()
				.from(applicationEconomyClassifications)
				.where(
					and(
						eq(applicationEconomyClassifications.applicationId, applicationId),
						isNull(applicationEconomyClassifications.archivedAt),
					),
				)
				.limit(1)
				.for("update")

			if (existing) {
				await tx
					.update(applicationEconomyClassifications)
					.set({ archivedAt: now, archivedBy: performedBy, updatedAt: now, updatedBy: performedBy })
					.where(eq(applicationEconomyClassifications.id, existing.id))

				await writeAuditLog(
					{
						action: "economy_classification_archived",
						entityType: "application_economy_classification",
						entityId: existing.id,
						previousValue: JSON.stringify({
							isEconomySystem: existing.isEconomySystem,
							economySystemType: existing.economySystemType,
							justification: existing.justification,
						}),
						metadata: { applicationId, reason: "replaced_by_new_classification" },
						performedBy,
					},
					tx,
				)
			}

			// Create new classification
			const [created] = await tx
				.insert(applicationEconomyClassifications)
				.values({
					applicationId,
					isEconomySystem,
					economySystemType: isEconomySystem ? economySystemType : null,
					justification,
					validFrom: now,
					validUntil,
					createdBy: performedBy,
					updatedBy: performedBy,
				})
				.returning()

			await writeAuditLog(
				{
					action: "economy_classification_created",
					entityType: "application_economy_classification",
					entityId: created.id,
					newValue: JSON.stringify({
						isEconomySystem,
						economySystemType: isEconomySystem ? economySystemType : null,
						justification,
						validUntil: validUntil.toISOString(),
					}),
					metadata: { applicationId },
					performedBy,
				},
				tx,
			)

			// Atomically confirm the screening answer within the same transaction
			if (questionId) {
				await tx
					.insert(screeningAnswers)
					.values({
						applicationId,
						questionId,
						answer: "confirmed",
						answeredBy: performedBy,
						answeredAt: now,
					})
					.onConflictDoUpdate({
						target: [screeningAnswers.applicationId, screeningAnswers.questionId],
						set: {
							answer: "confirmed",
							answeredBy: performedBy,
							answeredAt: now,
						},
					})

				await writeAuditLog(
					{
						action: "screening_answer_saved",
						entityType: "screening_answer",
						entityId: `${applicationId}/${questionId}`,
						newValue: "confirmed",
						performedBy,
					},
					tx,
				)
			}

			return created
		})
	} catch (error: unknown) {
		// Handle unique constraint violation from concurrent first-time inserts:
		// retry once — the winner's row now exists and will be locked by FOR UPDATE
		const isUniqueViolation = hasPostgresCode(error, PgErrorCode.UNIQUE_VIOLATION)
		if (isUniqueViolation && retryCount < 1) {
			return saveEconomyClassification(params, retryCount + 1)
		}
		throw error
	}
}
