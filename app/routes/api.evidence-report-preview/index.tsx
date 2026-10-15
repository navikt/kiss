import { data } from "react-router"
import { getNdaAppParamsGroup } from "~/db/queries/deployment-audit.server"
import { getActivityContext } from "~/db/queries/evidence-downloads.server"
import { isDeploymentEvidenceActivityType } from "~/lib/activity-types"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { requireReviewReadAccess } from "~/lib/authorization.server"
import {
	createInlinePdfResponse,
	createSpreadsheetPreviewResponse,
	isPdf,
	isSpreadsheet,
} from "~/lib/evidence-file-preview.server"
import { getEvidenceProvider } from "~/lib/evidence-providers/index.server"
import { validateProviderAccess } from "~/lib/evidence-providers/validation.server"
import { isValidUuid } from "~/lib/utils"
import type { Route } from "./+types/index"

export async function loader({ request }: Route.LoaderArgs) {
	const user = await requireAuthenticatedUser(request)
	const url = new URL(request.url)
	const activityId = url.searchParams.get("activityId")
	const applicationId = url.searchParams.get("applicationId")
	const attemptId = url.searchParams.get("attemptId")
	const reportId = url.searchParams.get("reportId")
	const requestedFormat = url.searchParams.get("format")?.toLowerCase()

	if (
		!activityId ||
		!isValidUuid(activityId) ||
		!applicationId ||
		!isValidUuid(applicationId) ||
		!attemptId ||
		!reportId ||
		!requestedFormat ||
		!["pdf", "excel", "xlsx"].includes(requestedFormat)
	) {
		throw data({ error: "Ugyldige parametere for rapportvisning" }, { status: 400 })
	}

	const context = await getActivityContext(activityId)
	if (!context) throw data({ error: "Aktivitet ikke funnet" }, { status: 404 })
	await requireReviewReadAccess(user, { applicationId: context.applicationId, sectionId: context.sectionId })

	if (
		!isDeploymentEvidenceActivityType(context.activityType) ||
		context.activityStatus !== "pending" ||
		context.reviewStatus !== "draft" ||
		!context.applicationId ||
		!context.periodConfig
	) {
		throw data({ error: "Rapporten er ikke tilgjengelig for visning" }, { status: 404 })
	}

	const reportState = context.periodConfig.reportGeneration?.apps.find((state) => state.applicationId === applicationId)
	if (
		reportState?.status !== "ready" ||
		reportState.attemptId !== attemptId ||
		reportState.report?.reportId !== reportId
	) {
		throw data({ error: "Rapporten er ikke lenger tilgjengelig for visning" }, { status: 404 })
	}

	const format = requestedFormat === "xlsx" ? "excel" : requestedFormat
	const hasFormat = reportState.report.availableFormats.some((available) => {
		const normalizedAvailable = available.toLowerCase() === "xlsx" ? "excel" : available.toLowerCase()
		return normalizedAvailable === format
	})
	if (!hasFormat) throw data({ error: "Formatet finnes ikke for denne rapporten" }, { status: 404 })

	const apps = await getNdaAppParamsGroup(context.applicationId, context.sectionId)
	const app = apps.find((entry) => entry.applicationId === applicationId)
	if (!app) throw data({ error: "Applikasjonen er ikke koblet til gjennomgangen" }, { status: 404 })

	const providerParams = {
		team: app.team,
		environment: app.environment,
		appName: app.appName,
		periodType: context.periodConfig.periodType,
		periodStart: context.periodConfig.periodStart,
	}
	await validateProviderAccess("deployments", providerParams, context)

	const provider = await getEvidenceProvider("deployments")
	const file = await provider.downloadFile(providerParams, reportId, format)
	if (isPdf(file.contentType, file.fileName)) return createInlinePdfResponse(file)
	if (isSpreadsheet(file.contentType, file.fileName)) return createSpreadsheetPreviewResponse(file)
	throw data({ error: "Filtypen kan ikke vises i nettleseren" }, { status: 415 })
}
