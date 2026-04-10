import { and, eq, inArray, isNotNull } from "drizzle-orm"
import { getVerificationSummary } from "../../lib/deployment-audit.server"
import { logger } from "../../lib/logger.server"
import { db } from "../connection.server"
import { applicationEnvironments, monitoredApplications, naisTeams } from "../schema/applications"
import type { VerificationSummaryResponse } from "../schema/deployment-audit"
import { deploymentVerificationSummaries } from "../schema/deployment-audit"

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
			and(
				isNotNull(applicationEnvironments.naisTeamId),
				// Only production clusters
				eq(applicationEnvironments.cluster, "prod-gcp"),
			),
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
				eq(applicationEnvironments.cluster, "prod-gcp"),
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

		logger.info("Deployment verification: no prod-gcp environments with naisTeamId found", {
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
