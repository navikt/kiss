import { count, eq, sql } from "drizzle-orm"
import { db } from "../connection.server"
import { applicationTeamMappings, monitoredApplications } from "../schema/applications"
import { complianceAssessments } from "../schema/compliance"
import { frameworkControls } from "../schema/framework"
import { devTeams, sections } from "../schema/organization"
import { getActiveFrameworkVersion } from "./framework.server"

/** Get all sections. */
export async function getSections() {
	return db.select().from(sections).orderBy(sections.name)
}

/** Get section detail with team compliance stats. */
export async function getSectionDetail(seksjonSlug: string) {
	const [section] = await db.select().from(sections).where(eq(sections.slug, seksjonSlug)).limit(1)
	if (!section) return null

	const version = await getActiveFrameworkVersion()
	const teams = await db.select().from(devTeams).where(eq(devTeams.sectionId, section.id)).orderBy(devTeams.name)

	const [totalControlsRow] = version
		? await db.select({ count: count() }).from(frameworkControls).where(eq(frameworkControls.versionId, version.id))
		: [{ count: 0 }]
	const totalControls = totalControlsRow?.count ?? 0

	const teamStats = []
	for (const team of teams) {
		const [appCountRow] = await db
			.select({ count: count() })
			.from(applicationTeamMappings)
			.where(eq(applicationTeamMappings.devTeamId, team.id))

		let implemented = 0
		let partial = 0
		let notImplemented = 0

		if (version) {
			const appMappings = await db
				.select({ applicationId: applicationTeamMappings.applicationId })
				.from(applicationTeamMappings)
				.where(eq(applicationTeamMappings.devTeamId, team.id))

			for (const mapping of appMappings) {
				const [implRow] = await db
					.select({ count: count() })
					.from(complianceAssessments)
					.where(
						sql`${complianceAssessments.applicationId} = ${mapping.applicationId} AND ${complianceAssessments.status} = 'implemented'`,
					)
				implemented += implRow?.count ?? 0

				const [partialRow] = await db
					.select({ count: count() })
					.from(complianceAssessments)
					.where(
						sql`${complianceAssessments.applicationId} = ${mapping.applicationId} AND ${complianceAssessments.status} = 'partially_implemented'`,
					)
				partial += partialRow?.count ?? 0

				const [notImplRow] = await db
					.select({ count: count() })
					.from(complianceAssessments)
					.where(
						sql`${complianceAssessments.applicationId} = ${mapping.applicationId} AND ${complianceAssessments.status} = 'not_implemented'`,
					)
				notImplemented += notImplRow?.count ?? 0
			}
		}

		teamStats.push({
			slug: team.slug,
			name: team.name,
			apps: appCountRow?.count ?? 0,
			implemented,
			partial,
			notImplemented,
			total: totalControls * (appCountRow?.count ?? 0),
		})
	}

	return { section, teams: teamStats }
}

/** Get apps for a specific dev team. */
export async function getTeamApps(teamSlug: string) {
	const [team] = await db.select().from(devTeams).where(eq(devTeams.slug, teamSlug)).limit(1)
	if (!team) return null

	const version = await getActiveFrameworkVersion()
	const [totalControlsRow] = version
		? await db.select({ count: count() }).from(frameworkControls).where(eq(frameworkControls.versionId, version.id))
		: [{ count: 0 }]
	const totalControls = totalControlsRow?.count ?? 0

	const mappings = await db
		.select({ applicationId: applicationTeamMappings.applicationId })
		.from(applicationTeamMappings)
		.where(eq(applicationTeamMappings.devTeamId, team.id))

	const apps = []
	for (const mapping of mappings) {
		const [app] = await db
			.select()
			.from(monitoredApplications)
			.where(eq(monitoredApplications.id, mapping.applicationId))

		if (!app) continue

		let implemented = 0
		let partial = 0
		let notImplemented = 0

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

			const [notImplRow] = await db
				.select({ count: count() })
				.from(complianceAssessments)
				.where(
					sql`${complianceAssessments.applicationId} = ${app.id} AND ${complianceAssessments.status} = 'not_implemented'`,
				)
			notImplemented = notImplRow?.count ?? 0
		}

		apps.push({
			appId: app.id,
			appName: app.name,
			implemented,
			partial,
			notImplemented,
			total: totalControls,
		})
	}

	return { team, apps }
}
