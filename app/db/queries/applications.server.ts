import { and, count, eq, sql } from "drizzle-orm"
import { db } from "../connection.server"
import { applicationTeamMappings, monitoredApplications } from "../schema/applications"
import { complianceAssessments } from "../schema/compliance"
import { frameworkControls } from "../schema/framework"
import { devTeams } from "../schema/organization"
import { writeAuditLog } from "./audit.server"
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

/** Link an application to a dev team. */
export async function linkAppToTeam(applicationId: string, devTeamId: string, performedBy: string) {
	const [mapping] = await db
		.insert(applicationTeamMappings)
		.values({ applicationId, devTeamId, createdBy: performedBy })
		.returning()

	const [app] = await db.select().from(monitoredApplications).where(eq(monitoredApplications.id, applicationId))
	const [team] = await db.select().from(devTeams).where(eq(devTeams.id, devTeamId))

	await writeAuditLog({
		action: "app_team_linked",
		entityType: "application_team_mapping",
		entityId: mapping.id,
		newValue: `${app?.name ?? applicationId} ↔ ${team?.name ?? devTeamId}`,
		metadata: { applicationId, devTeamId },
		performedBy,
	})

	return mapping
}

/** Unlink an application from a dev team. */
export async function unlinkAppFromTeam(applicationId: string, devTeamId: string, performedBy: string) {
	const [app] = await db.select().from(monitoredApplications).where(eq(monitoredApplications.id, applicationId))
	const [team] = await db.select().from(devTeams).where(eq(devTeams.id, devTeamId))

	await db
		.delete(applicationTeamMappings)
		.where(
			and(eq(applicationTeamMappings.applicationId, applicationId), eq(applicationTeamMappings.devTeamId, devTeamId)),
		)

	await writeAuditLog({
		action: "app_team_unlinked",
		entityType: "application_team_mapping",
		entityId: `${applicationId}_${devTeamId}`,
		previousValue: `${app?.name ?? applicationId} ↔ ${team?.name ?? devTeamId}`,
		metadata: { applicationId, devTeamId },
		performedBy,
	})
}

/** Get applications NOT yet linked to a specific team. */
export async function getAvailableAppsForTeam(devTeamId: string) {
	const linkedAppIds = db
		.select({ applicationId: applicationTeamMappings.applicationId })
		.from(applicationTeamMappings)
		.where(eq(applicationTeamMappings.devTeamId, devTeamId))

	return db
		.select({ id: monitoredApplications.id, name: monitoredApplications.name })
		.from(monitoredApplications)
		.where(sql`${monitoredApplications.id} NOT IN (${linkedAppIds})`)
		.orderBy(monitoredApplications.name)
}

/** Get teams NOT yet linked to a specific application. */
export async function getAvailableTeamsForApp(applicationId: string) {
	const linkedTeamIds = db
		.select({ devTeamId: applicationTeamMappings.devTeamId })
		.from(applicationTeamMappings)
		.where(eq(applicationTeamMappings.applicationId, applicationId))

	return db
		.select({ id: devTeams.id, name: devTeams.name })
		.from(devTeams)
		.where(sql`${devTeams.id} NOT IN (${linkedTeamIds})`)
		.orderBy(devTeams.name)
}

/** Get all dev teams. */
export async function getAllTeams() {
	return db.select({ id: devTeams.id, name: devTeams.name, slug: devTeams.slug }).from(devTeams).orderBy(devTeams.name)
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
