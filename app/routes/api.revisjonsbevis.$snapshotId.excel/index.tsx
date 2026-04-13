import type { LoaderFunctionArgs } from "react-router"
import { getSnapshot } from "~/db/queries/audit-evidence.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAuditor } from "~/lib/authorization.server"
import { canUserSeeInstance } from "~/lib/oracle-access.server"
import { getOracleInstances } from "~/lib/oracle-revisjon.server"
import { getStorageProvider } from "~/lib/storage/index.server"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAuditor(authedUser)

	const snapshotId = params.snapshotId
	if (!snapshotId) {
		throw new Response("Mangler snapshot-ID", { status: 400 })
	}

	const snapshot = await getSnapshot(snapshotId)
	if (!snapshot?.bucketPath) {
		throw new Response("Ingen Excel-fil tilgjengelig", { status: 404 })
	}

	// Check instance-level access
	const allInstances = await getOracleInstances()
	const instance = allInstances.find((i) => i.id === snapshot.instanceId)
	if (instance && !canUserSeeInstance(instance, authedUser.groups)) {
		throw new Response("Ingen tilgang til denne databaseinstansen", { status: 403 })
	}

	const storage = getStorageProvider()
	const buffer = await storage.download(snapshot.bucketPath)

	return new Response(new Uint8Array(buffer), {
		headers: {
			"Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			"Content-Disposition": `attachment; filename="revisjonsbevis-${snapshot.instanceId}-${snapshot.fetchedAt.toISOString().slice(0, 10)}.xlsx"`,
		},
	})
}
