import { and, asc, eq, inArray, isNotNull } from "drizzle-orm"
import { getVerificationSummary } from "../../lib/deployment-audit.server"
import { logger } from "../../lib/logger.server"
import { db } from "../connection.server"
import { applicationEnvironments, monitoredApplications, naisTeams } from "../schema/applications"
import type { VerificationSummaryResponse } from "../schema/deployment-audit"
import { deploymentVerificationSummaries } from "../schema/deployment-audit"

// Production clusters that deployment-audit monitors
const PROD_CLUSTERS = ["prod-gcp", "prod-fss"]

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
		.where(and(isNotNull(applicationEnvironments.naisTeamId), inArray(applicationEnvironments.cluster, PROD_CLUSTERS)))

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
				inArray(applicationEnvironments.cluster, PROD_CLUSTERS),
				isNotNull(applicationEnvironments.naisTeamId),
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

		logger.info("Deployment verification: no production environments with naisTeamId found", {
			applicationId,
			prodClusters: PROD_CLUSTERS,
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
}

/**
 * Resolve NDA API parameters for a monitored application.
 *
 * Finds the application's primary production environment using alphabetical
 * ordering on cluster name (prod-fss before prod-gcp) and returns the
 * team/environment/appName needed by the NDA audit-reports API.
 *
 * @returns NdaAppParams or null if no production environment is found
 */
export async function getNdaAppParams(applicationId: string): Promise<NdaAppParams | null> {
	const rows = await db
		.select({
			appName: monitoredApplications.name,
			cluster: applicationEnvironments.cluster,
			teamSlug: naisTeams.slug,
		})
		.from(applicationEnvironments)
		.innerJoin(monitoredApplications, eq(applicationEnvironments.applicationId, monitoredApplications.id))
		.innerJoin(naisTeams, eq(applicationEnvironments.naisTeamId, naisTeams.id))
		.where(
			and(
				eq(applicationEnvironments.applicationId, applicationId),
				isNotNull(applicationEnvironments.naisTeamId),
				inArray(applicationEnvironments.cluster, PROD_CLUSTERS),
			),
		)
		.orderBy(asc(applicationEnvironments.cluster))
		.limit(1)

	if (rows.length === 0) return null

	const row = rows[0]
	return {
		team: row.teamSlug ?? "",
		environment: row.cluster,
		appName: row.appName,
	}
}
