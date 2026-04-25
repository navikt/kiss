import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

/**
 * Enumerasjon av alle handlinger som kan skrives til `audit_log`.
 *
 * Konvensjon: `<entitet>_<verb>` (typisk preteritum, f.eks. `_created`,
 * `_updated`, `_deleted`, `_added`, `_removed`, `_synced`).
 *
 * NB: Verdier som ikke lenger brukes i kode kan fortsatt finnes i historiske
 * audit-rader. Fjern derfor ikke verdier uten en samtidig datamigrering.
 * Se PR-historikk for F8a for kjente inkonsistenser som bør ryddes opp i en
 * fremtidig migrering (f.eks. `app_team_*` → `application_team_*`,
 * `review_activity_entra_change` → `review_activity_entra_changed`).
 */
export const auditLogActionEnum = [
	// Rammeverk (framework)
	"framework_imported",
	"framework_activated",
	"framework_archived",

	// Domener
	"domain_created",
	"domain_updated",
	"domain_deleted",

	// Risikoer og kontroller (innholdsendringer i rammeverket)
	"risk_short_title_updated",
	"risk_domain_changed",
	"control_short_title_updated",
	"control_field_updated",
	"control_dependency_added",
	"control_dependency_removed",

	// Teknologielementer og kontrollers tilknytning til disse
	"technology_element_created",
	"technology_element_updated",
	"technology_element_deleted",
	"technology_element_archived",
	"technology_element_unarchived",
	"technology_element_confirmed",
	"technology_element_rejected",
	"control_element_added",
	"control_element_removed",

	// Seksjoner og team
	"section_created",
	"section_updated",
	"section_deleted",
	"section_archived",
	"section_unarchived",
	"team_created",
	"team_updated",
	"team_deleted",
	"team_archived",
	"team_unarchived",
	"dev_team_nais_team_linked",
	"dev_team_nais_team_unlinked",

	// Nais-team og synkronisering
	"nais_team_status_updated",
	"nais_team_section_linked",
	"nais_team_section_unlinked",
	"nais_sync_completed",
	// nais_persistence_synced: deklarert for historisk/forventet bruk – ikke
	// referert i nåværende kode (vurder fjerning ved fremtidig migrering).
	"nais_persistence_synced",

	// Applikasjoner (kobling, identitet og livssyklus)
	"app_team_linked",
	"app_team_unlinked",
	"application_linked",
	"application_unlinked",
	"application_renamed",
	"application_primary_changed",
	"application_deleted",
	"application_archived",
	"application_unarchived",

	// Seksjon ↔ applikasjon/miljø
	"section_app_ignored",
	"section_app_unignored",
	"section_environment_excluded",
	"section_environment_included",

	// Persistenslag (databaser, buckets, kafka osv.)
	"persistence_added",
	"persistence_updated",
	"persistence_deleted",

	// Manuelle grupperinger og kritikalitet/klassifisering
	"manual_group_added",
	"manual_group_removed",
	"group_criticality_updated",
	"group_classification_updated",
	"oracle_role_criticality_updated",

	// Screening (spørsmål, svar og predefinerte svar)
	"predefined_answer_created",
	"predefined_answer_updated",
	"predefined_answer_deleted",
	"screening_question_created",
	"screening_question_updated",
	"screening_question_deleted",
	"screening_question_archived",
	"screening_question_unarchived",
	"screening_choice_archived",
	"screening_choice_unarchived",
	"screening_choice_effect_archived",
	"screening_choice_effect_unarchived",
	"screening_answer_saved",
	"screening_routine_selected",

	// Rutiner og rutinegjennomganger
	"routine_created",
	"routine_updated",
	"routine_deleted",
	"routine_archived",
	"routine_unarchived",
	"routine_approved",
	"routine_copied",
	"routine_replaced",
	"routine_attachment_uploaded",
	"routine_review_created",
	"routine_review_updated",
	"routine_review_completed",
	"routine_review_discarded",
	"routine_review_confirmed",
	"review_link_added",
	"review_link_deleted",
	"review_activity_created",
	"review_activity_completed",
	"review_activity_entra_change",

	// Dokumenter
	"document_uploaded",
	"document_deleted",
	"document_archived",
	"document_unarchived",

	// Regelsett
	"ruleset_archived",
	"ruleset_unarchived",

	// Revisjonsbevis og automatiske synkroniseringer
	"audit_confirmation_created",
	"audit_confirmation_updated",
	"audit_confirmation_revoked",
	"audit_summary_synced",
	"deployment_verification_synced",

	// Rapporter
	"report_generated",
] as const

export type AuditLogAction = (typeof auditLogActionEnum)[number]

export const auditLog = pgTable("audit_log", {
	id: uuid("id").primaryKey().defaultRandom(),
	action: text("action", { enum: auditLogActionEnum }).notNull(),
	entityType: text("entity_type").notNull(),
	entityId: text("entity_id").notNull(),
	previousValue: text("previous_value"),
	newValue: text("new_value"),
	metadata: text("metadata"),
	performedBy: text("performed_by").notNull(),
	performedAt: timestamp("performed_at", { withTimezone: true }).notNull().defaultNow(),
})
