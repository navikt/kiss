/**
 * @deprecated Legacy compliance-skrivere som bruker `complianceAssessments`-tabellen.
 *
 * Disse funksjonene skal IKKE brukes i ny produksjonskode. Compliance-status
 * skal utledes fra screening-spørsmål, regelsett og rutiner via
 * `application_controls`-tabellen (se `application-controls.server.ts`).
 *
 * Funksjonene er flyttet hit fra `applications.server.ts` for å gjøre det
 * tydelig at de er legacy. De beholdes kun inntil videre fordi
 * integrasjonstester (`compliance.integration.test.ts`) verifiserer at
 * eksisterende historikk i `complianceAssessments`/`complianceAssessmentHistory`
 * ikke ødelegges.
 */
import { eq, sql } from "drizzle-orm"
import { db } from "../connection.server"
import { type ComplianceStatus, complianceAssessmentHistory, complianceAssessments } from "../schema/compliance"

/** @deprecated Bruker `complianceAssessments`. Compliance skal utledes fra screening/rutiner/regelsett. */
export async function saveAssessment(
	appId: string,
	controlUuid: string,
	status: string,
	comment: string,
	performedBy: string,
	technologyElementId?: string | null,
) {
	const conditions = [
		sql`${complianceAssessments.applicationId} = ${appId}`,
		sql`${complianceAssessments.controlId} = ${controlUuid}`,
	]
	if (technologyElementId) {
		conditions.push(sql`${complianceAssessments.technologyElementId} = ${technologyElementId}`)
	} else {
		conditions.push(sql`${complianceAssessments.technologyElementId} IS NULL`)
	}

	const [existing] = await db.select().from(complianceAssessments).where(sql.join(conditions, sql` AND `)).limit(1)

	if (existing) {
		await db.insert(complianceAssessmentHistory).values({
			assessmentId: existing.id,
			previousStatus: existing.status,
			newStatus: status as ComplianceStatus,
			previousComment: existing.comment,
			newComment: comment || null,
			changedBy: performedBy,
		})

		await db
			.update(complianceAssessments)
			.set({
				status: status as ComplianceStatus,
				comment: comment || null,
				assessedBy: performedBy,
				assessedAt: new Date(),
				updatedBy: performedBy,
				updatedAt: new Date(),
			})
			.where(eq(complianceAssessments.id, existing.id))
	} else {
		const [newAssessment] = await db
			.insert(complianceAssessments)
			.values({
				applicationId: appId,
				controlId: controlUuid,
				technologyElementId: technologyElementId ?? null,
				status: status as ComplianceStatus,
				comment: comment || null,
				assessedBy: performedBy,
				createdBy: performedBy,
				updatedBy: performedBy,
			})
			.returning()

		await db.insert(complianceAssessmentHistory).values({
			assessmentId: newAssessment.id,
			previousStatus: null,
			newStatus: status as ComplianceStatus,
			previousComment: null,
			newComment: comment || null,
			changedBy: performedBy,
		})
	}
}
