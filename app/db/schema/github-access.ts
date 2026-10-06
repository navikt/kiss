import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"
import { monitoredApplications } from "./applications"

export const githubRepoTeams = pgTable(
	"github_repo_teams",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		applicationId: uuid("application_id")
			.notNull()
			.references(() => monitoredApplications.id, { onDelete: "restrict" }),
		teamSlug: text("team_slug").notNull(),
		teamName: text("team_name").notNull(),
		permission: text("permission").notNull(),
		syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		unique("uq_github_repo_teams_app_team").on(t.applicationId, t.teamSlug),
		index("idx_github_repo_teams_app").on(t.applicationId),
	],
)

export const githubRepoTeamMembers = pgTable(
	"github_repo_team_members",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		repoTeamId: uuid("repo_team_id")
			.notNull()
			.references(() => githubRepoTeams.id, { onDelete: "cascade" }),
		username: text("username").notNull(),
		role: text("role").notNull(),
		syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		unique("uq_github_repo_team_members_team_user").on(t.repoTeamId, t.username),
		index("idx_github_repo_team_members_team").on(t.repoTeamId),
	],
)

export const githubRepoCollaborators = pgTable(
	"github_repo_collaborators",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		applicationId: uuid("application_id")
			.notNull()
			.references(() => monitoredApplications.id, { onDelete: "restrict" }),
		username: text("username").notNull(),
		permission: text("permission").notNull(),
		syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		unique("uq_github_repo_collaborators_app_user").on(t.applicationId, t.username),
		index("idx_github_repo_collaborators_app").on(t.applicationId),
	],
)

export const githubAccessAssessments = pgTable(
	"github_access_assessments",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		applicationId: uuid("application_id")
			.notNull()
			.references(() => monitoredApplications.id, { onDelete: "restrict" }),
		username: text("username").notNull(),
		lastKnownPermission: text("last_known_permission"),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		archivedBy: text("archived_by"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		createdBy: text("created_by").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
		updatedBy: text("updated_by").notNull(),
	},
	(t) => [
		unique("uq_github_access_assessments_app_user").on(t.applicationId, t.username),
		index("idx_github_access_assessments_app").on(t.applicationId),
	],
)
