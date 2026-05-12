import type { LoaderFunctionArgs } from "react-router"
import { data } from "react-router"
import { getActivityContext, isInstanceConfiguredForApp } from "~/db/queries/evidence-downloads.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAnySectionRole } from "~/lib/authorization.server"
import { getEvidenceStatus } from "~/lib/oracle-revisjon.server"
import { isValidUuid } from "~/lib/utils"

export async function loader({ request }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)

	const url = new URL(request.url)
	const instanceId = url.searchParams.get("instanceId")
	const activityId = url.searchParams.get("activityId")
	if (!instanceId) {
		return data({ error: "instanceId er påkrevd" }, { status: 400 })
	}
	if (!activityId) {
		return data({ error: "activityId er påkrevd" }, { status: 400 })
	}
	if (!isValidUuid(activityId)) {
		return data({ error: "Ugyldig activityId-format" }, { status: 400 })
	}

	const ctx = await getActivityContext(activityId)
	if (!ctx) return data({ error: "Aktivitet ikke funnet" }, { status: 404 })
	requireAnySectionRole(authedUser, ctx.sectionId)

	if (!ctx.applicationId) {
		return data({ error: "Gjennomgangen mangler applikasjonstilknytning" }, { status: 400 })
	}
	const configured = await isInstanceConfiguredForApp(ctx.applicationId, instanceId)
	if (!configured) {
		return data({ error: "Oracle-instansen er ikke konfigurert for denne applikasjonen" }, { status: 403 })
	}

	const fromUtc = url.searchParams.get("fromUtc") ?? undefined
	const toUtc = url.searchParams.get("toUtc") ?? undefined

	const datePattern = /^\d{4}-\d{2}-\d{2}$/
	if ((fromUtc && !datePattern.test(fromUtc)) || (toUtc && !datePattern.test(toUtc))) {
		return data({ error: "Ugyldig datoformat. Forventet YYYY-MM-DD." }, { status: 400 })
	}
	if (fromUtc && toUtc && fromUtc > toUtc) {
		return data({ error: "Fra-dato kan ikke være etter til-dato" }, { status: 400 })
	}

	const status = await getEvidenceStatus(instanceId, fromUtc, toUtc)
	if (!status) {
		return data({ error: "Kunne ikke hente status for instans" }, { status: 502 })
	}

	return data(status)
}
