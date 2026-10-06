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

/**
 * Husker hvilke brukernavn som hadde GitHub-tilgang til en applikasjon ved forrige fullførte
 * periodiske gjennomgang (`github_access_maintenance`-aktiviteten). Brukes utelukkende til å
 * beregne `isNew`/`isGone` ved seeding av neste runde — lagrer ikke lenger begrunnelse eller
 * andre vurderinger (gjennomgangen bekreftes nå samlet, se `confirmedAt` i staged_data).
 *
 * Rader for personer som ikke lenger har tilgang arkiveres (`archivedAt`) ved commit av
 * aktiviteten der de først oppdages som borte — de vises som «fjernet siden forrige
 * gjennomgang» KUN i den ene aktiviteten, ikke i alle påfølgende runder. Dette gir sporbarhet
 * på hvem som tidligere hadde tilgang uten å forurense senere rundes isNew/isGone-beregning.
 * Returnerer tilgangen personen igjen, reaktiveres samme rad (archivedAt settes til null) i
 * stedet for å opprette en ny — den unike nøkkelen (applicationId, username) tillater kun én
 * rad per person uansett.
 */
export const githubAccessAssessments = pgTable(
	"github_access_assessments",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		applicationId: uuid("application_id")
			.notNull()
			.references(() => monitoredApplications.id, { onDelete: "restrict" }),
		username: text("username").notNull(),
		/** Siste kjente tilgangsnivå — brukes til å vise «siste kjente tilgang» etter at personen er fjernet. */
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
