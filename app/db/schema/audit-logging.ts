import { sql } from "drizzle-orm"
import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { applicationPersistence } from "./applications"

// ─── Audit Conclusion Enum ──────────────────────────────────────────────────

export const auditConclusionEnum = ["FULLSTENDIG", "MANGELFULL", "AV", "UKJENT"] as const
export type AuditConclusion = (typeof auditConclusionEnum)[number]

// ─── Persistence Audit Summaries ────────────────────────────────────────────
// Persisterer Oracle audit-oppsummeringer hentet fra pensjon-oracle-revisjon.
// Oppdateres periodisk av bakgrunnssynk-jobben.

export const persistenceAuditSummaries = pgTable(
	"persistence_audit_summaries",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		persistenceId: uuid("persistence_id")
			.notNull()
			.unique()
			.references(() => applicationPersistence.id),
		conclusion: text("conclusion", { enum: auditConclusionEnum }).notNull(),
		reason: text("reason"),
		unifiedAuditingEnabled: boolean("unified_auditing_enabled"),
		activePolicyCount: integer("active_policy_count"),
		auditedObjectCount: integer("audited_object_count"),
		unauditedTableCount: integer("unaudited_table_count"),
		excludedUserCount: integer("excluded_user_count"),
		policiesWithoutFailureAudit: integer("policies_without_failure_audit"),
		hasAuditTrailData: boolean("has_audit_trail_data"),
		findings: jsonb("findings").$type<Array<{ severity: string; message: string }>>(),
		fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
		lastSyncAttemptedAt: timestamp("last_sync_attempted_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		createdBy: text("created_by").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
		updatedBy: text("updated_by").notNull(),
	},
	(t) => [index("idx_pas_conclusion").on(t.conclusion), index("idx_pas_fetched_at").on(t.fetchedAt)],
)

// ─── Persistence Audit Confirmations ────────────────────────────────────────
// Manuell bekreftelse av audit logging for databaser uten automatisk deteksjon.

export const persistenceAuditConfirmations = pgTable(
	"persistence_audit_confirmations",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		persistenceId: uuid("persistence_id")
			.notNull()
			.references(() => applicationPersistence.id),
		enabledAt: date("enabled_at", { mode: "string" }).notNull(),
		description: text("description").notNull(),
		evidenceUrl: text("evidence_url").notNull(),
		confirmedBy: text("confirmed_by").notNull(),
		confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		revokedBy: text("revoked_by"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		createdBy: text("created_by").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
		updatedBy: text("updated_by").notNull(),
	},
	(t) => [
		// Partial unique: kun én aktiv (ikke tilbakekalt) bekreftelse per persistence-entry.
		// Tillater historikk: tilbakekalte rader beholder persistence_id uten å blokkere nye.
		uniqueIndex("idx_pac_active_unique").on(t.persistenceId).where(sql`revoked_at IS NULL`),
	],
)
