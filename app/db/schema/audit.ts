import { foreignKey, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { syncJobs } from "./sync-jobs"

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
	"application_technology_element_added",
	"application_technology_element_removed",

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
	"nais_discovered_app_added",
	"nais_discovered_app_archived",
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
	"app_environment_archived",
	"app_environment_reactivated",

	// Seksjon ↔ applikasjon/miljø
	// Deprecated: section_app_ignored og section_app_unignored skrives ikke lenger,
	// men beholdes i enumen for å ikke bryte eksisterende rader i audit_log.
	"section_app_ignored",
	"section_app_unignored",
	"section_environment_excluded",
	"section_environment_included",

	// Persistenslag (databaser, buckets, kafka osv.)
	"persistence_added",
	"persistence_updated",
	"persistence_deleted",
	"persistence_archived",
	"persistence_unarchived",

	// Autentiserings-integrasjoner (Entra ID, TokenX, ID-porten, Maskinporten)
	"auth_integration_added",
	"auth_integration_updated",

	// Manuelle grupperinger og kritikalitet/klassifisering
	"manual_group_added",
	"manual_group_removed",
	"ghost_group_archived",
	"group_criticality_updated",
	"group_classification_updated",
	"oracle_role_criticality_updated",

	// Oracle-instans-konfigurasjon (revisjonsbevis-kilder)
	"oracle_instance_configured",
	"oracle_instance_removed",

	// Entra-gruppe-klassifisering (logisk arkivering)
	"entra_group_classification_created",
	"entra_group_classification_archived",

	// Access policy-regler (Nais inbound/outbound)
	"access_policy_rule_added",
	"access_policy_rule_removed",
	"access_policy_rules_synced",

	// Brukerroller (rolletildeling og -inndragelse)
	"user_role_granted",
	"user_role_revoked",

	// Screening (spørsmål, svar og predefinerte svar)
	"predefined_answer_created",
	"predefined_answer_updated",
	"predefined_answer_deleted",
	"predefined_answer_archived",
	"predefined_answer_unarchived",
	"screening_question_created",
	"screening_question_updated",
	"screening_question_deleted",
	"screening_question_archived",
	"screening_question_unarchived",
	"screening_question_status_changed",
	"screening_choice_archived",
	"screening_choice_unarchived",
	"screening_choice_effect_archived",
	"screening_choice_effect_unarchived",
	"screening_choice_effect_updated",
	"screening_answer_saved",
	"screening_routine_selected",
	"screening_routine_cleared",
	"screening_routine_selection_migrated",
	"screening_preset_routine_migrated",
	"screening_question_technology_element_added",
	"screening_question_technology_element_removed",

	// Rutiner og rutinegjennomganger
	"routine_created",
	"routine_updated",
	"routine_deleted",
	"routine_archived",
	"routine_unarchived",
	"routine_approved",
	"routine_copied",
	"routine_replaced",
	"routine_priority_changed",
	"routine_attachment_uploaded",
	"routine_review_created",
	"routine_review_updated",
	"routine_review_completed",
	"routine_review_discarded",
	"routine_review_confirmed",
	"routine_review_inherited",
	"routine_review_participant_added",
	"routine_review_participant_removed",
	"review_link_added",
	"review_link_deleted",
	"review_follow_up_added",
	"review_follow_up_updated",
	"review_follow_up_description_updated",
	"review_follow_up_status_changed",
	"review_follow_up_resolution_updated",
	"review_follow_up_deleted",
	"review_follow_up_attachment_uploaded",
	"review_activity_created",
	"review_activity_completed",
	"review_activity_seeded",
	"review_activity_entra_change",
	"review_activity_rpa_patched",
	"review_activity_oracle_role_criticality_patched",
	"review_activity_checklist_step_toggled",
	"routine_checklist_step_created",
	"routine_checklist_step_updated",
	"routine_checklist_step_archived",
	"routine_technology_element_added",
	"routine_technology_element_removed",
	"routine_control_added",
	"routine_control_removed",
	"routine_persistence_link_added",
	"routine_persistence_link_removed",
	"routine_group_classification_link_added",
	"routine_group_classification_link_removed",
	"routine_oracle_role_criticality_link_added",
	"routine_oracle_role_criticality_link_removed",
	"routine_screening_question_added",
	"routine_screening_question_removed",

	// Dokumenter
	"document_uploaded",
	"document_deleted",
	"document_archived",
	"document_unarchived",

	// Regelsett
	"ruleset_archived",
	"ruleset_unarchived",
	"ruleset_updated",
	"ruleset_control_added",
	"ruleset_control_removed",
	"ruleset_routine_added",
	"ruleset_routine_removed",

	// Revisjonsbevis og automatiske synkroniseringer
	"audit_confirmation_created",
	"audit_confirmation_updated",
	"audit_confirmation_revoked",
	"audit_summary_synced",
	"deployment_verification_synced",

	// Oracle evidence downloads
	"evidence_downloaded",
	"evidence_uploaded",
	"evidence_force_downloaded",

	// Rapporter
	"report_generated",
	"report_generation_requested",

	// Økonomisystem-klassifisering
	"economy_classification_created",
	"economy_classification_archived",

	// Screening-sesjoner
	"screening_session_created",
	"screening_session_completed",
	"screening_session_archived",
	"screening_session_restored",
	"screening_session_participant_added",
	"screening_session_participant_removed",

	// RPA-grupper
	"rpa_group_added",
	"rpa_group_removed",
	"rpa_group_members_synced",

	// GitHub-repo-tilganger
	"github_access_team_added",
	"github_access_team_removed",
	"github_access_team_permission_changed",
	"github_access_team_updated",
	"github_access_collaborator_added",
	"github_access_collaborator_removed",
	"github_access_collaborator_permission_changed",
	"github_access_team_member_added",
	"github_access_team_member_removed",
	"github_access_team_member_role_changed",
	// RPA-brukervurderinger
	"rpa_user_assessment_saved",
] as const

export type AuditLogAction = (typeof auditLogActionEnum)[number]

export const auditLog = pgTable(
	"audit_log",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		action: text("action", { enum: auditLogActionEnum }).notNull(),
		entityType: text("entity_type").notNull(),
		entityId: text("entity_id").notNull(),
		previousValue: text("previous_value"),
		newValue: text("new_value"),
		metadata: text("metadata"),
		performedBy: text("performed_by").notNull(),
		performedAt: timestamp("performed_at", { withTimezone: true }).notNull().defaultNow(),
		syncJobId: uuid("sync_job_id"),
	},
	(table) => [
		index("idx_audit_log_action_performed_at").on(table.action, table.performedAt.desc()),
		index("idx_audit_log_entity_performed_at").on(table.entityType, table.entityId, table.performedAt.desc()),
		index("idx_audit_log_entity_type_performed_at").on(table.entityType, table.performedAt.desc()),
		index("idx_audit_log_sync_job_id").on(table.syncJobId, table.performedAt.desc()),
		index("idx_audit_log_performed_at").on(table.performedAt.desc()),
		foreignKey({
			columns: [table.syncJobId],
			foreignColumns: [syncJobs.id],
			name: "fk_audit_log_sync_job_id",
		}).onDelete("set null"),
	],
)
