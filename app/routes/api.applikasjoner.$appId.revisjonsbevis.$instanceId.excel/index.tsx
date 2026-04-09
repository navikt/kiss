import type { LoaderFunctionArgs } from "react-router"
import { getLatestSnapshot } from "~/db/queries/audit-evidence.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAuditor } from "~/lib/authorization.server"
import { getStorageProvider } from "~/lib/storage/index.server"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAuditor(authedUser)

	const appId = params.appId
	const instanceId = params.instanceId
	if (!appId || !instanceId) {
		throw new Response("Mangler parametere", { status: 400 })
	}

	const snapshot = await getLatestSnapshot(appId, instanceId)
	if (!snapshot?.bucketPath) {
		throw new Response("Ingen Excel-fil tilgjengelig", { status: 404 })
	}

	const storage = getStorageProvider()
	const buffer = await storage.download(snapshot.bucketPath)

	return new Response(new Uint8Array(buffer), {
		headers: {
			"Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			"Content-Disposition": `attachment; filename="revisjonsbevis-${instanceId}-${snapshot.fetchedAt.toISOString().slice(0, 10)}.xlsx"`,
		},
	})
}
