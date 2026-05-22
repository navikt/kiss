import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"
import { monitoredApplications } from "./applications"

/**
 * GitHub-team som har tilgang til et repositorium.
 * Synkroniseres daglig fra GitHub API.
 */
export const githubRepoTeams = pgTable(
	"github_repo_teams",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		applicationId: uuid("application_id")
			.notNull()
			.references(() => monitoredApplications.id, { onDelete: "restrict" }),
		teamSlug: text("team_slug").notNull(),
		teamName: text("team_name").notNull(),
		permission: text("permission").notNull(), // admin, maintain, push, triage, pull
		syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		unique("uq_github_repo_teams_app_team").on(t.applicationId, t.teamSlug),
		index("idx_github_repo_teams_app").on(t.applicationId),
	],
)

/**
 * Medlemmer av GitHub-team (hentet transitivt).
 * Oppdateres ved hver synkronisering.
 */
export const githubRepoTeamMembers = pgTable(
	"github_repo_team_members",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		repoTeamId: uuid("repo_team_id")
			.notNull()
			.references(() => githubRepoTeams.id, { onDelete: "cascade" }),
		username: text("username").notNull(),
		role: text("role").notNull(), // maintainer, member
		syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		unique("uq_github_repo_team_members_team_user").on(t.repoTeamId, t.username),
		index("idx_github_repo_team_members_team").on(t.repoTeamId),
	],
)

/**
 * Individuelle collaborators med direkte tilgang til repoet (uten team).
 * Synkroniseres daglig fra GitHub API.
 */
export const githubRepoCollaborators = pgTable(
	"github_repo_collaborators",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		applicationId: uuid("application_id")
			.notNull()
			.references(() => monitoredApplications.id, { onDelete: "restrict" }),
		username: text("username").notNull(),
		permission: text("permission").notNull(), // admin, maintain, write, triage, read
		syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		unique("uq_github_repo_collaborators_app_user").on(t.applicationId, t.username),
		index("idx_github_repo_collaborators_app").on(t.applicationId),
	],
)
