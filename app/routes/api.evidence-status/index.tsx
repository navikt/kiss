import type { LoaderFunctionArgs } from "react-router"
import { data } from "react-router"
import { getActivityContext } from "~/db/queries/evidence-downloads.server"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { requireAnySectionRole } from "~/lib/authorization.server"
import { getEvidenceProvider, isEvidenceProviderType } from "~/lib/evidence-providers/index.server"
import { extractProviderParams, validateProviderAccess } from "~/lib/evidence-providers/validation.server"
import { logger } from "~/lib/logger.server"
import { isValidUuid } from "~/lib/utils"

export async function loader({ request, url }: LoaderFunctionArgs) {
	const authedUser = await requireAuthenticatedUser(request)

	const providerType = url.searchParams.get("providerType")
	const activityId = url.searchParams.get("activityId")

	if (!providerType) {
		return data({ error: "providerType er påkrevd" }, { status: 400 })
	}
	if (!isEvidenceProviderType(providerType)) {
		return data({ error: `Ugyldig providerType: ${providerType}` }, { status: 400 })
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

	const providerParams = extractProviderParams(providerType, url.searchParams)
	try {
		await validateProviderAccess(providerType, providerParams, ctx)
	} catch (err) {
		if (err instanceof Response) return err
		throw err
	}

	const provider = await getEvidenceProvider(providerType)
	try {
		const status = await provider.getStatus(providerParams)
		if (!status) {
			return data({ error: "Kunne ikke hente status fra leverandøren" }, { status: 502 })
		}
		return data(status)
	} catch (err) {
		logger.error(
			`Evidence status loader failed [providerType=${providerType}, activityId=${activityId}]`,
			err instanceof Error ? err : new Error(String(err)),
		)
		return data({ error: "Kunne ikke hente status fra leverandøren" }, { status: 502 })
	}
}
