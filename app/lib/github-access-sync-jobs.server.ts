import {
	createSyncJob,
	markSyncJobCompleted,
	markSyncJobFailed,
	markSyncJobRunning,
	markSyncJobSkipped,
} from "~/db/queries/sync-jobs.server"
import type { GitHubAccessSyncResult } from "~/lib/github-access-sync.server"
import { runGitHubAccessSync } from "~/lib/github-access-sync.server"
import { SYNC_JOB_TYPES } from "~/lib/sync-job-types"

function formatCompletedMessage(r: GitHubAccessSyncResult): string {
	return `Synkronisering fullført: ${r.appsProcessed} applikasjoner, +${r.teamsAdded}/-${r.teamsRemoved}/~${r.teamsUpdated} team, ${r.errors} feil`
}

export async function runTrackedGitHubAccessSync({
	performedBy,
	scopeType,
	scopeId,
}: {
	performedBy: string
	scopeType?: string
	scopeId?: string
}): Promise<{ jobId: string; state: "completed" | "skipped" | "not_configured" }> {
	const job = await createSyncJob({
		jobType: SYNC_JOB_TYPES.GITHUB_ACCESS_SYNC,
		performedBy,
		scopeType,
		scopeId,
		message: "Venter på start",
	})

	await markSyncJobRunning(job.id, performedBy, "Synkronisering pågår")

	const execution = await runGitHubAccessSync(performedBy).then(
		(outcome) => ({ ok: true as const, outcome }),
		(error) => ({ ok: false as const, error }),
	)

	if (!execution.ok) {
		const message = execution.error instanceof Error ? execution.error.message : String(execution.error)
		await markSyncJobFailed(job.id, message, performedBy, "Synkronisering feilet")
		throw execution.error
	}

	const { outcome } = execution

	if (outcome.status === "not_configured") {
		await markSyncJobSkipped(job.id, "GitHub App er ikke konfigurert.", performedBy)
		return { jobId: job.id, state: "not_configured" }
	}

	if (outcome.status === "lock_held") {
		await markSyncJobSkipped(job.id, "Synkronisering pågår allerede i en annen prosess.", performedBy)
		return { jobId: job.id, state: "skipped" }
	}

	await markSyncJobCompleted(
		job.id,
		outcome.result as unknown as Record<string, unknown>,
		performedBy,
		formatCompletedMessage(outcome.result),
	)
	return { jobId: job.id, state: "completed" }
}
