import { and, asc, eq, inArray, isNotNull, isNull, notExists, sql } from "drizzle-orm"
import { getVerificationSummary } from "../../lib/deployment-audit.server"
import { logger } from "../../lib/logger.server"
import { db } from "../connection.server"
import { applicationEnvironments, monitoredApplications, naisTeams } from "../schema/applications"
import type { VerificationSummaryResponse } from "../schema/deployment-audit"
import { deploymentVerificationSummaries } from "../schema/deployment-audit"
import { sectionEnvironments } from "../schema/organization"

/**
 * An environment counts as "production" here when `naisTeams.sectionId` is set and the section
 * has not excluded the cluster (`section_environments.included = false`). Environments whose team
 * has no resolvable section are filtered out, since there is no section config to check exclusions against.
 */
function notExcludedBySectionCondition() {
	return notExists(
		db
			.select({ cluster: sectionEnvironments.cluster })
			.from(sectionEnvironments)
			.where(
				and(
					eq(sectionEnvironments.sectionId, naisTeams.sectionId),
					eq(sectionEnvironments.cluster, applicationEnvironments.cluster),
					eq(sectionEnvironments.included, false),
				),
			),
	)
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AppProdEnvironment {
	applicationId: string
	appName: string
	cluster: string
	namespace: string
	teamSlug: string
}

// ─── Queries ────────────────────────────────────────────────────────────────

/** Get all apps with production environments (for background sync). */
export async function getAppsWithProdEnvironments(): Promise<AppProdEnvironment[]> {
	const rows = await db
		.select({
			applicationId: applicationEnvironments.applicationId,
			appName: monitoredApplications.name,
			cluster: applicationEnvironments.cluster,
			namespace: applicationEnvironments.namespace,
			teamSlug: naisTeams.slug,
		})
		.from(applicationEnvironments)
		.innerJoin(monitoredApplications, eq(applicationEnvironments.applicationId, monitoredApplications.id))
		.innerJoin(naisTeams, eq(applicationEnvironments.naisTeamId, naisTeams.id))
		.where(
			and(isNotNull(naisTeams.sectionId), isNull(applicationEnvironments.archivedAt), notExcludedBySectionCondition()),
		)

	return rows.map((r) => ({
		applicationId: r.applicationId,
		appName: r.appName,
		cluster: r.cluster,
		namespace: r.namespace,
		teamSlug: r.teamSlug ?? "",
	}))
}

/** Get cached deployment verification data for an app. */
export async function getDeploymentVerificationForApp(applicationId: string) {
	return db
		.select()
		.from(deploymentVerificationSummaries)
		.where(eq(deploymentVerificationSummaries.applicationId, applicationId))
		.orderBy(deploymentVerificationSummaries.environment)
}

/** Get cached deployment verification data, fetching on-demand if missing. */
export async function getDeploymentVerificationForAppWithFetch(applicationId: string) {
	const cached = await getDeploymentVerificationForApp(applicationId)
	if (cached.length > 0) {
		logger.debug("Deployment verification: returning cached data", { applicationId, count: cached.length })
		return cached
	}

	// No cached data — try on-demand fetch
	const envs = await db
		.select({
			cluster: applicationEnvironments.cluster,
			namespace: applicationEnvironments.namespace,
			teamSlug: naisTeams.slug,
			appName: monitoredApplications.name,
		})
		.from(applicationEnvironments)
		.innerJoin(monitoredApplications, eq(applicationEnvironments.applicationId, monitoredApplications.id))
		.innerJoin(naisTeams, eq(applicationEnvironments.naisTeamId, naisTeams.id))
		.where(
			and(
				eq(applicationEnvironments.applicationId, applicationId),
				isNotNull(naisTeams.sectionId),
				isNull(applicationEnvironments.archivedAt),
				notExcludedBySectionCondition(),
			),
		)

	if (envs.length === 0) {
		// Log all environments for debugging
		const allEnvs = await db
			.select({
				cluster: applicationEnvironments.cluster,
				namespace: applicationEnvironments.namespace,
				naisTeamId: applicationEnvironments.naisTeamId,
			})
			.from(applicationEnvironments)
			.where(eq(applicationEnvironments.applicationId, applicationId))

		logger.info("Deployment verification: no eligible production environments found", {
			applicationId,
			allEnvironments: allEnvs.map((e) => ({
				cluster: e.cluster,
				namespace: e.namespace,
				hasNaisTeamId: !!e.naisTeamId,
			})),
		})
		return []
	}

	logger.info("Deployment verification: on-demand fetching", {
		applicationId,
		environments: envs.map((e) => `${e.teamSlug}/${e.cluster}/${e.appName}`),
	})

	const results = []
	for (const env of envs) {
		if (!env.teamSlug) continue
		const result = await getVerificationSummary(env.teamSlug, env.cluster, env.appName)

		if (result.data) {
			const upserted = await upsertDeploymentVerification({
				applicationId,
				environment: env.cluster,
				teamSlug: env.teamSlug,
				appName: env.appName,
				summary: result.data,
				status: "synced",
				performedBy: "on-demand-fetch",
			})
			results.push(upserted)
		} else if (result.notMonitored) {
			const upserted = await upsertDeploymentVerification({
				applicationId,
				environment: env.cluster,
				teamSlug: env.teamSlug,
				appName: env.appName,
				summary: null,
				status: "not_monitored",
				performedBy: "on-demand-fetch",
			})
			results.push(upserted)
		}
	}

	return results
}

/** Upsert a deployment verification summary. */
export async function upsertDeploymentVerification(params: {
	applicationId: string
	environment: string
	teamSlug: string
	appName: string
	summary: VerificationSummaryResponse | null
	status: "synced" | "not_monitored" | "error"
	performedBy: string
}) {
	const now = new Date()
	const { applicationId, environment, teamSlug, appName, summary, status, performedBy } = params

	const values = {
		applicationId,
		environment,
		teamSlug,
		appName,
		periodFrom: summary ? new Date(summary.period.from) : new Date(new Date().getFullYear(), 0, 1),
		periodTo: summary ? new Date(summary.period.to) : now,
		fourEyesCoveragePercent: summary ? Math.round(summary.fourEyesCoverage.coveragePercent) : null,
		fourEyesTotal: summary?.fourEyesCoverage.total ?? null,
		fourEyesApproved: summary?.fourEyesCoverage.approved ?? null,
		changeOriginCoveragePercent: summary ? Math.round(summary.changeOriginCoverage.coveragePercent) : null,
		changeOriginTotal: summary?.changeOriginCoverage.total ?? null,
		changeOriginLinked: summary?.changeOriginCoverage.linked ?? null,
		lastDeploymentAt: summary?.lastDeployment ? new Date(summary.lastDeployment.createdAt) : null,
		rawSummary: summary ?? {
			app: { team: teamSlug, environment, name: appName, isActive: false },
			period: {
				from: new Date(new Date().getFullYear(), 0, 1).toISOString(),
				to: now.toISOString(),
			},
			fourEyesCoverage: { total: 0, approved: 0, unapproved: 0, pending: 0, coveragePercent: 0 },
			changeOriginCoverage: { total: 0, linked: 0, dependabot: 0, coveragePercent: 0 },
			lastDeployment: null,
		},
		status,
		fetchedAt: now,
		lastSyncAttemptedAt: now,
		createdBy: performedBy,
		updatedBy: performedBy,
	}

	const [result] = await db
		.insert(deploymentVerificationSummaries)
		.values(values)
		.onConflictDoUpdate({
			target: [deploymentVerificationSummaries.applicationId, deploymentVerificationSummaries.environment],
			set: {
				teamSlug: values.teamSlug,
				appName: values.appName,
				periodFrom: values.periodFrom,
				periodTo: values.periodTo,
				fourEyesCoveragePercent: values.fourEyesCoveragePercent,
				fourEyesTotal: values.fourEyesTotal,
				fourEyesApproved: values.fourEyesApproved,
				changeOriginCoveragePercent: values.changeOriginCoveragePercent,
				changeOriginTotal: values.changeOriginTotal,
				changeOriginLinked: values.changeOriginLinked,
				lastDeploymentAt: values.lastDeploymentAt,
				rawSummary: values.rawSummary,
				status: values.status,
				fetchedAt: values.fetchedAt,
				lastSyncAttemptedAt: values.lastSyncAttemptedAt,
				updatedAt: now,
				updatedBy: performedBy,
			},
		})
		.returning()

	return result
}

/** Update only the lastSyncAttemptedAt timestamp (on failure, preserve existing data). */
export async function touchSyncAttempt(applicationId: string, environment: string, performedBy: string) {
	const now = new Date()
	await db
		.update(deploymentVerificationSummaries)
		.set({ lastSyncAttemptedAt: now, updatedAt: now, updatedBy: performedBy })
		.where(
			and(
				eq(deploymentVerificationSummaries.applicationId, applicationId),
				eq(deploymentVerificationSummaries.environment, environment),
			),
		)
}

/** Get all deployment verifications for apps in a set of app IDs. */
export async function getDeploymentVerificationsForApps(applicationIds: string[]) {
	if (applicationIds.length === 0) return []
	return db
		.select()
		.from(deploymentVerificationSummaries)
		.where(inArray(deploymentVerificationSummaries.applicationId, applicationIds))
}

/** Aggregate deployment verification stats across all synced summaries. */
export async function getDeploymentVerificationAggregate(applicationIds?: string[]) {
	// An explicitly provided empty list means no apps in scope → return zero stats
	if (applicationIds && applicationIds.length === 0) {
		return {
			appsWithData: 0,
			fourEyesPercent: null,
			fourEyesTotal: 0,
			fourEyesApproved: 0,
			changeOriginPercent: null,
			changeOriginTotal: 0,
			changeOriginLinked: 0,
		}
	}

	const conditions = [eq(deploymentVerificationSummaries.status, "synced")]
	if (applicationIds && applicationIds.length > 0) {
		conditions.push(inArray(deploymentVerificationSummaries.applicationId, applicationIds))
	}

	const rows = await db
		.select({
			fourEyesTotal: deploymentVerificationSummaries.fourEyesTotal,
			fourEyesApproved: deploymentVerificationSummaries.fourEyesApproved,
			changeOriginTotal: deploymentVerificationSummaries.changeOriginTotal,
			changeOriginLinked: deploymentVerificationSummaries.changeOriginLinked,
		})
		.from(deploymentVerificationSummaries)
		.where(and(...conditions))

	let totalDeployments = 0
	let totalApproved = 0
	let changeTotal = 0
	let changeLinked = 0

	for (const row of rows) {
		totalDeployments += row.fourEyesTotal ?? 0
		totalApproved += row.fourEyesApproved ?? 0
		changeTotal += row.changeOriginTotal ?? 0
		changeLinked += row.changeOriginLinked ?? 0
	}

	return {
		appsWithData: rows.length,
		fourEyesPercent: totalDeployments > 0 ? Math.round((totalApproved / totalDeployments) * 100) : null,
		fourEyesTotal: totalDeployments,
		fourEyesApproved: totalApproved,
		changeOriginPercent: changeTotal > 0 ? Math.round((changeLinked / changeTotal) * 100) : null,
		changeOriginTotal: changeTotal,
		changeOriginLinked: changeLinked,
	}
}

// ─── NDA App Params ─────────────────────────────────────────────────────────

/** Parameters needed to call the NDA audit-reports API for an application */
export interface NdaAppParams {
	team: string
	environment: string
	appName: string
	/** Section the resolved production environment belongs to — used to enforce that a linked
	 * application's data is only exposed to users authorized for that application's own section,
	 * since `linkApplication()` does not require linked apps to share a section. */
	sectionId: string
}

/** NDA params for one member of a linked-application group, tagged with its own application id */
export interface NdaAppParamsGroupEntry extends NdaAppParams {
	applicationId: string
}

/**
 * Resolve NDA API parameters for a monitored application.
 *
 * Finds the application's primary production environment — an environment whose cluster
 * has not been excluded by the application's section in `section_environments`. An application
 * can have production environments spanning multiple sections (e.g. deployed by nais teams in
 * different sections); when `preferredSectionId` is given, an environment belonging to that
 * section is preferred over alphabetical-by-cluster ordering, so the review's own section isn't
 * dropped just because another of the app's sections sorts first. Falls back to alphabetical
 * ordering when no environment matches `preferredSectionId` (or none is given), returning
 * whichever section that environment actually belongs to.
 *
 * @returns NdaAppParams or null if no production environment is found
 */
export async function getNdaAppParams(
	applicationId: string,
	preferredSectionId?: string,
): Promise<NdaAppParams | null> {
	const rows = await db
		.select({
			appName: monitoredApplications.name,
			cluster: applicationEnvironments.cluster,
			teamSlug: naisTeams.slug,
			sectionId: naisTeams.sectionId,
		})
		.from(applicationEnvironments)
		.innerJoin(monitoredApplications, eq(applicationEnvironments.applicationId, monitoredApplications.id))
		.innerJoin(naisTeams, eq(applicationEnvironments.naisTeamId, naisTeams.id))
		.where(
			and(
				eq(applicationEnvironments.applicationId, applicationId),
				isNotNull(naisTeams.sectionId),
				isNull(applicationEnvironments.archivedAt),
				notExcludedBySectionCondition(),
			),
		)
		.orderBy(
			sql`(case when ${naisTeams.sectionId} = ${preferredSectionId ?? null} then 0 else 1 end)`,
			asc(applicationEnvironments.cluster),
		)
		.limit(1)

	if (rows.length === 0) return null

	const row = rows[0]
	// sectionId can't be null here — filtered by isNotNull(naisTeams.sectionId) above
	if (!row.sectionId) return null

	return {
		team: row.teamSlug ?? "",
		environment: row.cluster,
		appName: row.appName,
		sectionId: row.sectionId,
	}
}

/**
 * Resolve NDA API parameters for every member of an application's linked group.
 *
 * KISS's "linked applications" feature (`primaryApplicationId`) only means the apps share a
 * single compliance assessment — it says nothing about whether they are the same deployable
 * unit in NDA. Each member may or may not have its own production environment, independent of
 * the others. This resolves the group (the primary application plus all applications linked to
 * it) and returns NDA params for each member that has its own production environment, so each
 * can be reported on separately instead of merging or guessing which member's data applies.
 *
 * `preferredSectionId` (typically the review's own section) is forwarded to `getNdaAppParams()`
 * for each member, so a member with environments in multiple sections resolves to its
 * environment in that section rather than an arbitrary alphabetical pick.
 *
 * @returns one entry per group member with its own production environment (may be empty)
 */
export async function getNdaAppParamsGroup(
	applicationId: string,
	preferredSectionId?: string,
): Promise<NdaAppParamsGroupEntry[]> {
	// Resolve the group primary and all active members in a single statement so group
	// membership can't shift between two separate reads — e.g. if promoteToPrimary() commits
	// between resolving groupPrimaryId and querying its children, a two-query approach could
	// see a stale primary whose children have already been reassigned to a new primary,
	// silently dropping members (and reports) the completion guard should have required.
	const result = await db.execute(sql`
		WITH root AS (
			SELECT COALESCE(primary_application_id, id) AS primary_id
			FROM ${monitoredApplications}
			WHERE id = ${applicationId}
		)
		SELECT m.id
		FROM ${monitoredApplications} m, root
		WHERE m.archived_at IS NULL
		AND (m.id = root.primary_id OR m.primary_application_id = root.primary_id)
		ORDER BY m.name
	`)
	const memberIds = (result.rows as Array<{ id: string }>).map((row) => row.id)

	const results = await Promise.all(
		memberIds.map(async (id) => {
			const params = await getNdaAppParams(id, preferredSectionId)
			return params ? { applicationId: id, ...params } : null
		}),
	)

	return results.filter((r): r is NdaAppParamsGroupEntry => r !== null)
}
