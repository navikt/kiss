import type { LoaderFunctionArgs } from "react-router"
import { data } from "react-router"
import { getRecentAuditLog } from "~/db/queries/audit.server"
import { getFrameworkVersionHistory, getPendingFrameworkImport } from "~/db/queries/framework.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"

export async function loader({ request }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const [versions, auditEntries, pendingImport] = await Promise.all([
		getFrameworkVersionHistory(),
		getRecentAuditLog(50),
		getPendingFrameworkImport(),
	])

	return data({ versions, auditEntries, pendingImport })
}
