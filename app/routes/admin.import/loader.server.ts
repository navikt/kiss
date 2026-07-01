import { data } from "react-router"
import { getRecentAuditLog } from "~/db/queries/audit.server"
import { getFrameworkVersionHistory, getPendingFrameworkImport } from "~/db/queries/framework.server"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"
import type { Route } from "./+types/index"

export async function loader({ request }: Route.LoaderArgs) {
	const authedUser = await requireAuthenticatedUser(request)
	requireAdmin(authedUser)

	const [versions, auditEntries, pendingImport] = await Promise.all([
		getFrameworkVersionHistory(),
		getRecentAuditLog(50),
		getPendingFrameworkImport(),
	])

	return data({ versions, auditEntries, pendingImport })
}
