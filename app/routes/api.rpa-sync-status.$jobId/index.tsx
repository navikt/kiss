import { data } from "react-router"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"
import { getRpaSyncJob } from "~/lib/rpa-sync-jobs.server"
import { isValidUuid } from "~/lib/utils"
import type { Route } from "./+types/index"

export async function loader({ request, params }: Route.LoaderArgs) {
	const authedUser = await requireAuthenticatedUser(request)
	requireAdmin(authedUser)

	const jobId = params.jobId
	if (!jobId) {
		return data({ error: "Mangler jobId" }, { status: 400 })
	}
	if (!isValidUuid(jobId)) {
		return data({ error: "Ugyldig jobId-format" }, { status: 400 })
	}

	const job = await getRpaSyncJob(jobId)
	if (!job) {
		return data({ error: "Synkroniseringsjobb ikke funnet" }, { status: 404 })
	}

	return data(job)
}
