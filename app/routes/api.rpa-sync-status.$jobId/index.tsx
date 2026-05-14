import type { LoaderFunctionArgs } from "react-router"
import { data } from "react-router"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"
import { getRpaSyncJob } from "~/lib/rpa-sync-jobs.server"
import { isValidUuid } from "~/lib/utils"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
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
