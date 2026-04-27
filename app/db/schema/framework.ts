import { sql } from "drizzle-orm"
import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { monitoredApplications } from "./applications"

export const frameworkVersionStatusEnum = ["pending", "applied", "superseded"] as const
export type FrameworkVersionStatus = (typeof frameworkVersionStatusEnum)[number]

export const frameworkVersions = pgTable("framework_versions", {
	id: uuid("id").primaryKey().defaultRandom(),
	name: text("name").notNull(),
	description: text("description"),
	sourceFileName: text("source_file_name").notNull(),
	sourceBucketPath: text("source_bucket_path").notNull(),
	status: text("status", { enum: frameworkVersionStatusEnum }).notNull().default("pending"),
	activatedAt: timestamp("activated_at", { withTimezone: true }),
	activatedBy: text("activated_by"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	createdBy: text("created_by").notNull(),
})

export const frameworkDomains = pgTable("framework_domains", {
	id: uuid("id").primaryKey().defaultRandom(),
	code: text("code").notNull().unique(),
	name: text("name").notNull(),
	displayOrder: integer("display_order").notNull().default(0),
	archivedAt: timestamp("archived_at", { withTimezone: true }),
	lastImportId: uuid("last_import_id").references(() => frameworkVersions.id),
})

export const frameworkRisks = pgTable("framework_risks", {
	id: uuid("id").primaryKey().defaultRandom(),
	domainId: uuid("domain_id")
		.notNull()
		.references(() => frameworkDomains.id),
	riskId: text("risk_id").notNull().unique(),
	shortTitle: text("short_title"),
	description: text("description").notNull(),
	archivedAt: timestamp("archived_at", { withTimezone: true }),
	lastImportId: uuid("last_import_id").references(() => frameworkVersions.id),
})

export const frameworkControls = pgTable("framework_controls", {
	id: uuid("id").primaryKey().defaultRandom(),
	controlId: text("control_id").notNull().unique(),
	shortTitle: text("short_title"),
	technologyElement: text("technology_element"),
	requirement: text("requirement"),
	responsible: text("responsible"),
	routine: text("routine"),
	frequency: text("frequency"),
	cronFrequency: text("cron_frequency"),
	documentationRequirement: text("documentation_requirement"),
	testProcedure: text("test_procedure"),
	dependencies: text("dependencies"),
	references: text("references"),
	commonPitfalls: text("common_pitfalls"),
	archivedAt: timestamp("archived_at", { withTimezone: true }),
	lastImportId: uuid("last_import_id").references(() => frameworkVersions.id),
})

export const frameworkRiskControlMappings = pgTable("framework_risk_control_mappings", {
	id: uuid("id").primaryKey().defaultRandom(),
	riskId: uuid("risk_id")
		.notNull()
		.references(() => frameworkRisks.id),
	controlId: uuid("control_id")
		.notNull()
		.references(() => frameworkControls.id),
	archivedAt: timestamp("archived_at", { withTimezone: true }),
	archivedBy: text("archived_by"),
})

export const frameworkFieldHistory = pgTable("framework_field_history", {
	id: uuid("id").primaryKey().defaultRandom(),
	entityType: text("entity_type").notNull(),
	entityId: uuid("entity_id").notNull(),
	fieldName: text("field_name").notNull(),
	previousValue: text("previous_value"),
	newValue: text("new_value"),
	importId: uuid("import_id")
		.notNull()
		.references(() => frameworkVersions.id),
	changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
	changedBy: text("changed_by").notNull(),
})

export const controlPredefinedAnswers = pgTable("control_predefined_answers", {
	id: uuid("id").primaryKey().defaultRandom(),
	controlId: uuid("control_id")
		.notNull()
		.references(() => frameworkControls.id),
	label: text("label").notNull(),
	status: text("status").notNull(),
	comment: text("comment"),
	displayOrder: integer("display_order").notNull().default(0),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	createdBy: text("created_by").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	updatedBy: text("updated_by").notNull(),
	archivedAt: timestamp("archived_at", { withTimezone: true }),
	archivedBy: text("archived_by"),
})

// ─── Technology Elements ─────────────────────────────────────────────────

export const technologyElements = pgTable("technology_elements", {
	id: uuid("id").primaryKey().defaultRandom(),
	name: text("name").notNull().unique(),
	slug: text("slug").notNull().unique(),
	description: text("description"),
	displayOrder: integer("display_order").notNull().default(0),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	archivedAt: timestamp("archived_at", { withTimezone: true }),
	archivedBy: text("archived_by"),
})

export const controlTechnologyElements = pgTable(
	"control_technology_elements",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		controlId: uuid("control_id")
			.notNull()
			.references(() => frameworkControls.id, { onDelete: "restrict" }),
		elementId: uuid("element_id")
			.notNull()
			.references(() => technologyElements.id, { onDelete: "restrict" }),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		archivedBy: text("archived_by"),
	},
	(table) => [
		uniqueIndex("uq_control_tech_element_active")
			.on(table.controlId, table.elementId)
			.where(sql`${table.archivedAt} IS NULL`),
	],
)

export const applicationTechnologyElements = pgTable(
	"application_technology_elements",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		applicationId: uuid("application_id")
			.notNull()
			.references(() => monitoredApplications.id, { onDelete: "restrict" }),
		elementId: uuid("element_id")
			.notNull()
			.references(() => technologyElements.id, { onDelete: "restrict" }),
		source: text("source").notNull().default("manual"),
		confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
		confirmedBy: text("confirmed_by"),
		rejectedAt: timestamp("rejected_at", { withTimezone: true }),
		rejectedBy: text("rejected_by"),
		rejectionReason: text("rejection_reason"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		archivedBy: text("archived_by"),
	},
	(t) => [
		uniqueIndex("uq_app_tech_element_active").on(t.applicationId, t.elementId).where(sql`${t.archivedAt} IS NULL`),
	],
)

export const controlDependencies = pgTable(
	"control_dependencies",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		controlId: uuid("control_id")
			.notNull()
			.references(() => frameworkControls.id, { onDelete: "cascade" }),
		dependsOnControlId: uuid("depends_on_control_id")
			.notNull()
			.references(() => frameworkControls.id, { onDelete: "cascade" }),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		archivedBy: text("archived_by"),
	},
	(t) => [
		uniqueIndex("control_dependencies_active_unique_idx")
			.on(t.controlId, t.dependsOnControlId)
			.where(sql`${t.archivedAt} IS NULL`),
	],
)
