import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"
import { monitoredApplications } from "./applications"

// ─── Deployment Verification Status Enum ────────────────────────────────────

export const deploymentVerificationStatusEnum = ["synced", "not_monitored", "error"] as const
export type DeploymentVerificationStatus = (typeof deploymentVerificationStatusEnum)[number]

// ─── Deployment Verification Summaries ──────────────────────────────────────
// Cacher verifiseringsstatus fra pensjon-deployment-audit per app per miljø.
// Oppdateres periodisk av bakgrunnssynk-jobben.

export interface FourEyesCoverage {
	total: number
	approved: number
	unapproved: number
	pending: number
	coveragePercent: number
}

export interface ChangeOriginCoverage {
	total: number
	linked: number
	dependabot: number
	coveragePercent: number
}

export interface LastDeployment {
	createdAt: string
	deployer: string | null
	commitSha: string | null
	fourEyesStatus: string
	hasChangeOrigin: boolean
}

export interface VerificationSummaryResponse {
	app: {
		team: string
		environment: string
		name: string
		isActive: boolean
	}
	period: {
		from: string
		to: string
	}
	fourEyesCoverage: FourEyesCoverage
	changeOriginCoverage: ChangeOriginCoverage
	lastDeployment: LastDeployment | null
}

export const deploymentVerificationSummaries = pgTable(
	"deployment_verification_summaries",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		applicationId: uuid("application_id")
			.notNull()
			.references(() => monitoredApplications.id, { onDelete: "restrict" }),
		environment: text("environment").notNull(),
		teamSlug: text("team_slug").notNull(),
		appName: text("app_name").notNull(),
		periodFrom: timestamp("period_from", { withTimezone: true }).notNull(),
		periodTo: timestamp("period_to", { withTimezone: true }).notNull(),
		fourEyesCoveragePercent: integer("four_eyes_coverage_percent"),
		fourEyesTotal: integer("four_eyes_total"),
		fourEyesApproved: integer("four_eyes_approved"),
		changeOriginCoveragePercent: integer("change_origin_coverage_percent"),
		changeOriginTotal: integer("change_origin_total"),
		changeOriginLinked: integer("change_origin_linked"),
		lastDeploymentAt: timestamp("last_deployment_at", { withTimezone: true }),
		rawSummary: jsonb("raw_summary").$type<VerificationSummaryResponse>().notNull(),
		status: text("status", { enum: deploymentVerificationStatusEnum }).notNull(),
		fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
		lastSyncAttemptedAt: timestamp("last_sync_attempted_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		createdBy: text("created_by").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
		updatedBy: text("updated_by").notNull(),
	},
	(t) => [
		unique("uq_dvs_app_env").on(t.applicationId, t.environment),
		index("idx_dvs_status").on(t.status),
		index("idx_dvs_fetched_at").on(t.fetchedAt),
		index("idx_dvs_four_eyes_pct").on(t.fourEyesCoveragePercent),
	],
)
