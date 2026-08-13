import { data } from "react-router"
import { getRecentAuditLog } from "~/db/queries/audit.server"
import { getFrameworkVersionHistory, getPendingFrameworkImport } from "~/db/queries/framework.server"
import { getUserNamesByNavIdents } from "~/db/queries/users.server"
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

	const userNames = await getUserNamesByNavIdents([
		...versions.map((v) => v.createdBy),
		...(pendingImport ? [pendingImport.createdBy] : []),
	])
	const nameFor = (navIdent: string) => userNames.get(navIdent.trim().toUpperCase()) ?? null

	return data({
		versions: versions.map((v) => ({ ...v, createdByName: nameFor(v.createdBy) })),
		auditEntries,
		pendingImport: pendingImport ? { ...pendingImport, createdByName: nameFor(pendingImport.createdBy) } : null,
	})
}
