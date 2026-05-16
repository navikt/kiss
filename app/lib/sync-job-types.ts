/**
 * Centralized definition of all sync job types.
 * Used across sync job wrappers, UI, and tests.
 */

export const SYNC_JOB_TYPES = {
	RPA_GROUP_MEMBER_SYNC: "rpa_group_member_sync",
	NAIS_FULL_SYNC: "nais_full_sync",
	NAIS_SYNC_TEAMS: "nais_sync_teams",
	NAIS_SYNC_APPS: "nais_sync_apps",
	AUDIT_SUMMARY_SYNC: "audit_summary_sync",
	COMPLIANCE_SYNC: "compliance_sync",
	DEPLOYMENT_AUDIT_SYNC: "deployment_audit_sync",
	SYNC_JOB_RETENTION_CLEANUP: "sync_job_retention_cleanup",
} as const

export type SyncJobType = (typeof SYNC_JOB_TYPES)[keyof typeof SYNC_JOB_TYPES]

/** All known job types, sorted for UI display */
export const ALL_SYNC_JOB_TYPES: SyncJobType[] = [
	SYNC_JOB_TYPES.AUDIT_SUMMARY_SYNC,
	SYNC_JOB_TYPES.COMPLIANCE_SYNC,
	SYNC_JOB_TYPES.DEPLOYMENT_AUDIT_SYNC,
	SYNC_JOB_TYPES.SYNC_JOB_RETENTION_CLEANUP,
	SYNC_JOB_TYPES.NAIS_FULL_SYNC,
	SYNC_JOB_TYPES.NAIS_SYNC_TEAMS,
	SYNC_JOB_TYPES.NAIS_SYNC_APPS,
	SYNC_JOB_TYPES.RPA_GROUP_MEMBER_SYNC,
]
