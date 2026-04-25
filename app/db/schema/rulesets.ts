import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { ROUTINE_FREQUENCIES } from "../../lib/routine-frequencies"
import { frameworkControls } from "./framework"
import { sections } from "./organization"
import { routines as routinesRef } from "./routines"

// ─── Rulesets ─────────────────────────────────────────────────────────────

export const rulesetStatusEnum = ["draft", "active", "archived"] as const
export type RulesetStatus = (typeof rulesetStatusEnum)[number]

export const rulesets = pgTable("rulesets", {
	id: uuid("id").primaryKey().defaultRandom(),
	sectionId: uuid("section_id")
		.notNull()
		.references(() => sections.id, { onDelete: "restrict" }),
	code: text("code"),
	name: text("name").notNull(),
	description: text("description"),
	responsibleIdent: text("responsible_ident"),
	responsibleName: text("responsible_name"),
	responsibleRole: text("responsible_role"),
	frequency: text("frequency", { enum: ROUTINE_FREQUENCIES }).notNull(),
	status: text("status", { enum: rulesetStatusEnum }).notNull().default("draft"),
	archivedAt: timestamp("archived_at", { withTimezone: true }),
	archivedBy: text("archived_by"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	createdBy: text("created_by").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	updatedBy: text("updated_by").notNull(),
})

// ─── Ruleset Approvals ───────────────────────────────────────────────────

export const rulesetApprovals = pgTable("ruleset_approvals", {
	id: uuid("id").primaryKey().defaultRandom(),
	rulesetId: uuid("ruleset_id")
		.notNull()
		.references(() => rulesets.id, { onDelete: "cascade" }),
	approvedBy: text("approved_by").notNull(),
	approvedByName: text("approved_by_name").notNull(),
	comment: text("comment"),
	validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
	validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

// ─── Ruleset ↔ Control linking ───────────────────────────────────────────

export const rulesetControls = pgTable("ruleset_controls", {
	id: uuid("id").primaryKey().defaultRandom(),
	rulesetId: uuid("ruleset_id")
		.notNull()
		.references(() => rulesets.id, { onDelete: "cascade" }),
	controlId: uuid("control_id")
		.notNull()
		.references(() => frameworkControls.id, { onDelete: "cascade" }),
})

// ─── Ruleset ↔ Routine linking ────────────────────────────────────────────

export const rulesetRoutines = pgTable("ruleset_routines", {
	id: uuid("id").primaryKey().defaultRandom(),
	rulesetId: uuid("ruleset_id")
		.notNull()
		.references(() => rulesets.id, { onDelete: "cascade" }),
	routineId: uuid("routine_id")
		.notNull()
		.references(() => routinesRef.id, { onDelete: "restrict" }),
	createdBy: text("created_by").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

// ─── Ruleset Attachments ─────────────────────────────────────────────────

export const rulesetAttachments = pgTable("ruleset_attachments", {
	id: uuid("id").primaryKey().defaultRandom(),
	rulesetId: uuid("ruleset_id")
		.notNull()
		.references(() => rulesets.id, { onDelete: "cascade" }),
	fileName: text("file_name").notNull(),
	bucketPath: text("bucket_path").notNull(),
	contentType: text("content_type").notNull(),
	sizeBytes: integer("size_bytes"),
	uploadedBy: text("uploaded_by").notNull(),
	uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
})
