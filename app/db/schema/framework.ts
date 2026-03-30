import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

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
	domainId: uuid("domain_id")
		.notNull()
		.references(() => frameworkDomains.id),
	controlId: text("control_id").notNull().unique(),
	shortTitle: text("short_title"),
	technologyElement: text("technology_element"),
	requirement: text("requirement"),
	responsible: text("responsible"),
	routine: text("routine"),
	frequency: text("frequency"),
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
