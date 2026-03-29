import { count, eq, sql } from "drizzle-orm"
import { db } from "../connection.server"
import { applicationTeamMappings, monitoredApplications } from "../schema/applications"
import { complianceAssessments } from "../schema/compliance"
import { frameworkControls } from "../schema/framework"
import { devTeams } from "../schema/organization"
import { getActiveFrameworkVersion } from "./framework.server"

/** Get all monitored applications with compliance summary. */
export async function getApplications() {
	const version = await getActiveFrameworkVersion()
	const apps = await db.select().from(monitoredApplications).orderBy(monitoredApplications.name)

	const [totalControlsRow] = version
		? await db.select({ count: count() }).from(frameworkControls).where(eq(frameworkControls.versionId, version.id))
		: [{ count: 0 }]

	const totalControls = totalControlsRow?.count ?? 0

	const result = []
	for (const app of apps) {
		// Get teams for this app
		const teamMappings = await db
			.select({ teamSlug: devTeams.slug })
			.from(applicationTeamMappings)
			.innerJoin(devTeams, eq(applicationTeamMappings.devTeamId, devTeams.id))
			.where(eq(applicationTeamMappings.applicationId, app.id))

		let implemented = 0
		let partial = 0

		if (version) {
			const [implRow] = await db
				.select({ count: count() })
				.from(complianceAssessments)
				.where(
					sql`${complianceAssessments.applicationId} = ${app.id} AND ${complianceAssessments.status} = 'implemented'`,
				)
			implemented = implRow?.count ?? 0

			const [partialRow] = await db
				.select({ count: count() })
				.from(complianceAssessments)
				.where(
					sql`${complianceAssessments.applicationId} = ${app.id} AND ${complianceAssessments.status} = 'partially_implemented'`,
				)
			partial = partialRow?.count ?? 0
		}

		result.push({
			id: app.id,
			name: app.name,
			teams: teamMappings.map((t) => t.teamSlug),
			controlsImplemented: implemented,
			controlsPartial: partial,
			controlsTotal: totalControls,
		})
	}

	return result
}

/** Get compliance assessments for an application. */
export async function getAppAssessments(appId: string) {
	const [app] = await db.select().from(monitoredApplications).where(eq(monitoredApplications.id, appId)).limit(1)
	if (!app) return null

	const version = await getActiveFrameworkVersion()
	if (!version) {
		return { app, assessments: [] }
	}

	const controls = await db
		.select()
		.from(frameworkControls)
		.where(eq(frameworkControls.versionId, version.id))
		.orderBy(frameworkControls.controlId)

	const assessments = []
	for (const ctrl of controls) {
		const [assessment] = await db
			.select()
			.from(complianceAssessments)
			.where(sql`${complianceAssessments.applicationId} = ${appId} AND ${complianceAssessments.controlId} = ${ctrl.id}`)
			.limit(1)

		assessments.push({
			controlId: ctrl.controlId,
			controlName: ctrl.controlId,
			domain: ctrl.domainId,
			status: assessment?.status ?? null,
			comment: assessment?.comment ?? null,
			assessedBy: assessment?.assessedBy ?? null,
			assessedAt: assessment?.assessedAt?.toISOString() ?? null,
		})
	}

	return { app, assessments }
}
