import type { ActionFunctionArgs } from "react-router"
import { data, redirect } from "react-router"
import { getAppScopeIds } from "~/db/queries/applications.server"
import {
	acknowledgeUnknownApp,
	addManualPersistence,
	archiveManualPersistence,
	revokeAcknowledgment,
	unarchiveManualPersistence,
	updatePersistenceClassification,
} from "~/db/queries/nais.server"
import { generateAppComplianceReport } from "~/db/queries/reports.server"
import { type DataClassification, persistenceTypeEnum } from "~/db/schema/applications"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { canAccessAppReports, isAdmin, requireAppMembership } from "~/lib/authorization.server"
import { createDraftReview } from "~/lib/create-draft-review.server"
import { logger } from "~/lib/logger.server"

export async function action({ request, params }: ActionFunctionArgs) {
	const appId = params.appId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })

	const authedUser = await requireAuthenticatedUser(request)

	const formData = await request.formData()
	const intent = formData.get("intent")

	if (intent === "create-draft") {
		await requireAppMembership(authedUser, appId)
		const routineId = formData.get("routineId") as string | null
		const sectionSlug = formData.get("sectionSlug") as string | null
		const result = await createDraftReview({
			routineId,
			sectionSlug,
			applicationId: appId,
			navIdent: authedUser.navIdent,
		})
		if (!result.ok) {
			return data(
				{ success: false, message: null, error: result.error, intent: "create-draft" },
				{ status: result.status },
			)
		}
		return redirect(`/seksjoner/${result.sectionSlug}/rutiner/${result.routineId}/gjennomgang/${result.reviewId}`)
	}

	if (intent === "discard-review") {
		await requireAppMembership(authedUser, appId)
		const reviewId = formData.get("reviewId") as string
		if (!reviewId) {
			return data({ success: false, message: null, error: "Mangler gjennomgang-ID" })
		}
		const { discardReview } = await import("~/db/queries/routines.server")
		const result = await discardReview(reviewId, authedUser.navIdent)
		if (!result) {
			return data({ success: false, message: null, error: "Kun gjennomganger med status utkast kan forkastes." })
		}
		return data({ success: true, message: "Gjennomgangen ble forkastet.", error: null })
	}

	if (intent === "generate-report") {
		const { devTeamIds, sectionIds } = await getAppScopeIds(appId)
		if (!canAccessAppReports(authedUser, sectionIds, devTeamIds)) {
			return data({ success: false, message: null, error: "Ikke autorisert til å generere rapport." }, { status: 403 })
		}
		const includeReviews = formData.get("includeReviews") === "true"
		const includeAttachments = formData.get("includeAttachments") === "true"
		const includeRoutineDescription = formData.get("includeRoutineDescription") === "true"
		const reviewIdsRaw = formData.get("reviewIds")
		const reviewIds = reviewIdsRaw != null ? String(reviewIdsRaw).split(",").filter(Boolean) : undefined
		try {
			await generateAppComplianceReport({
				applicationId: appId,
				createdBy: authedUser.navIdent,
				includeReviews,
				includeAttachments,
				includeRoutineDescription,
				reviewIds: includeReviews ? reviewIds : undefined,
			})
			return data({ success: true, message: "Rapport generert.", error: null })
		} catch (err) {
			return data({
				success: false,
				message: null,
				error: err instanceof Error ? err.message : "Feil ved generering av rapport.",
			})
		}
	}

	if (intent === "acknowledge-app") {
		await requireAppMembership(authedUser, appId)
		const ruleApplication = formData.get("ruleApplication") as string
		const comment = (formData.get("comment") as string)?.trim()
		if (!ruleApplication) throw new Response("Mangler applikasjonsnavn", { status: 400 })
		if (!comment) return data({ success: false, message: null, error: "Kommentar er obligatorisk" })
		await acknowledgeUnknownApp(appId, ruleApplication, comment, authedUser.navIdent)
		return data({ success: true, message: `${ruleApplication} er kvittert ut.`, error: null })
	}

	if (intent === "revoke-acknowledgment") {
		await requireAppMembership(authedUser, appId)
		const ruleApplication = formData.get("ruleApplication") as string
		if (!ruleApplication) throw new Response("Mangler applikasjonsnavn", { status: 400 })
		await revokeAcknowledgment(appId, ruleApplication, authedUser.navIdent)
		return data({ success: true, message: `Kvittering for ${ruleApplication} er trukket tilbake.`, error: null })
	}

	if (intent === "add-persistence") {
		await requireAppMembership(authedUser, appId)
		const type = formData.get("persistenceType") as string
		const name = (formData.get("persistenceName") as string)?.trim()
		const classification = (formData.get("dataClassification") as string) || null

		if (!type || !name) {
			return data({ success: false, message: null, error: "Type og navn er påkrevd" })
		}
		if (!persistenceTypeEnum.includes(type as (typeof persistenceTypeEnum)[number])) {
			return data({ success: false, message: null, error: "Ugyldig type" })
		}
		const validClassification =
			classification && ["not_critical", "critical", "financial_regulation"].includes(classification)
				? (classification as DataClassification)
				: null

		try {
			await addManualPersistence(
				appId,
				type as (typeof persistenceTypeEnum)[number],
				name,
				validClassification,
				authedUser.navIdent,
			)
		} catch (err) {
			logger.error("addManualPersistence failed", { error: err })
			return data({
				success: false,
				message: null,
				error: "Kunne ikke legge til database. Sjekk at navnet ikke allerede er i bruk.",
			})
		}
		const { syncApplicationControls } = await import("~/db/queries/application-controls.server")
		await syncApplicationControls(appId, authedUser.navIdent)
		return data({ success: true, message: `Database "${name}" lagt til.`, error: null })
	}

	if (intent === "update-classification") {
		await requireAppMembership(authedUser, appId)
		const persistenceId = formData.get("persistenceId") as string
		const classification = (formData.get("dataClassification") as string) || null
		if (!persistenceId) throw new Response("Mangler persistens-ID", { status: 400 })

		const validClassification =
			classification && ["not_critical", "critical", "financial_regulation"].includes(classification)
				? (classification as DataClassification)
				: null

		await updatePersistenceClassification(persistenceId, validClassification, authedUser.navIdent)
		const { syncApplicationControls } = await import("~/db/queries/application-controls.server")
		await syncApplicationControls(appId, authedUser.navIdent)
		return data({ success: true, message: "Klassifisering oppdatert.", error: null })
	}

	if (intent === "archive-persistence") {
		await requireAppMembership(authedUser, appId)
		const persistenceId = (formData.get("persistenceId") as string)?.trim()
		if (!persistenceId) throw new Response("Mangler persistens-ID", { status: 400 })
		await archiveManualPersistence(persistenceId, authedUser.navIdent)
		const { syncApplicationControls } = await import("~/db/queries/application-controls.server")
		await syncApplicationControls(appId, authedUser.navIdent)
		return data({ success: true, message: "Database arkivert.", error: null })
	}

	if (intent === "unarchive-persistence") {
		await requireAppMembership(authedUser, appId)
		const persistenceId = (formData.get("persistenceId") as string)?.trim()
		if (!persistenceId) throw new Response("Mangler persistens-ID", { status: 400 })
		await unarchiveManualPersistence(persistenceId, authedUser.navIdent)
		const { syncApplicationControls } = await import("~/db/queries/application-controls.server")
		await syncApplicationControls(appId, authedUser.navIdent)
		return data({ success: true, message: "Database reaktivert.", error: null })
	}

	if (intent === "save-control-comment") {
		await requireAppMembership(authedUser, appId)
		const applicationControlId = formData.get("applicationControlId") as string
		if (!applicationControlId) return data({ success: false, message: null, error: "Mangler kontroll-ID" })
		const comment = (formData.get("comment") as string)?.trim() || null
		const { updateControlComment } = await import("~/db/queries/application-controls.server")
		await updateControlComment(applicationControlId, comment, authedUser.navIdent)
		return data({ success: true, message: "Kommentar lagret.", error: null })
	}

	if (intent === "create-screening-session") {
		await requireAppMembership(authedUser, appId)
		const { createScreeningSession, captureStateSnapshot, getScreeningSessionsForApp } = await import(
			"~/db/queries/screening-sessions.server"
		)

		const existingSessions = await getScreeningSessionsForApp(appId)
		const hasActiveDraft = existingSessions.some((s) => s.status === "draft" && !s.archivedAt)
		if (hasActiveDraft) {
			return data(
				{
					success: false,
					message: null,
					error: "Det finnes allerede en påbegynt screening. Fullfør eller fjern den før du starter en ny.",
				},
				{ status: 409 },
			)
		}

		const title = `Screening ${new Date().toLocaleDateString("nb-NO")}`

		const stateSnapshot = await captureStateSnapshot(appId, authedUser.groups ?? [])

		const session = await createScreeningSession({
			applicationId: appId,
			title,
			participants: [{ userIdent: authedUser.navIdent, userName: authedUser.name }],
			stateSnapshot,
			performedBy: authedUser.navIdent,
		})

		const pathname = new URL(request.url).pathname
		const basePath = pathname.replace(/\/detaljer.*$/, "")
		return redirect(`${basePath}/screening/${session.id}`)
	}

	if (intent === "archive-screening-session") {
		if (!isAdmin(authedUser)) {
			return data({ success: false, message: null, error: "Kun administratorer kan fjerne screeninger" })
		}
		const { archiveScreeningSession, getScreeningSessionForAdmin } = await import(
			"~/db/queries/screening-sessions.server"
		)
		const sessionId = formData.get("sessionId") as string
		const reason = (formData.get("reason") as string)?.trim()
		if (!sessionId) return data({ success: false, message: null, error: "Mangler sesjon-ID" })
		if (!reason) return data({ success: false, message: null, error: "Begrunnelse er påkrevd" })
		const session = await getScreeningSessionForAdmin(sessionId)
		if (!session || session.applicationId !== appId) {
			return data({ success: false, message: null, error: "Screening-sesjon ikke funnet" })
		}
		if (session.archivedAt) {
			return data({ success: false, message: null, error: "Screeningen er allerede fjernet" })
		}
		await archiveScreeningSession(sessionId, authedUser.navIdent, reason)
		return data({ success: true, message: "Screening fjernet.", error: null })
	}

	if (intent === "restore-screening-session") {
		if (!isAdmin(authedUser)) {
			return data({ success: false, message: null, error: "Kun administratorer kan gjenopprette screeninger" })
		}
		const { restoreScreeningSession, getScreeningSessionForAdmin } = await import(
			"~/db/queries/screening-sessions.server"
		)
		const sessionId = formData.get("sessionId") as string
		if (!sessionId) return data({ success: false, message: null, error: "Mangler sesjon-ID" })
		const session = await getScreeningSessionForAdmin(sessionId)
		if (!session || session.applicationId !== appId) {
			return data({ success: false, message: null, error: "Screening-sesjon ikke funnet" })
		}
		if (!session.archivedAt) {
			return data({ success: false, message: null, error: "Screeningen er ikke fjernet" })
		}
		await restoreScreeningSession(sessionId, authedUser.navIdent)
		return data({ success: true, message: "Screening gjenopprettet.", error: null })
	}

	return data({ success: false, message: null, error: "Ukjent handling" })
}
