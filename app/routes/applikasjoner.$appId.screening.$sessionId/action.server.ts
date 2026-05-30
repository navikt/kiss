import type { ActionFunctionArgs } from "react-router"
import { data, redirect } from "react-router"
import {
	completeScreeningSession,
	getScreeningSession,
	saveScreeningSessionAnswer,
	stageOperation,
	updateScreeningSessionParticipants,
} from "~/db/queries/screening-sessions.server"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { logger } from "~/lib/logger.server"
import { parseParticipantsFormValue } from "~/lib/participants"

const STAGED_INTENTS = new Set([
	"add-persistence",
	"update-persistence-classification",
	"archive-persistence",
	"unarchive-persistence",
	"add-manual-group",
	"remove-manual-group",
	"set-group-criticality",
	"set-oracle-role-criticality",
	"save-economy-classification",
	"selectRoutine",
])

export async function action({ request, params }: ActionFunctionArgs) {
	const authedUser = await requireAuthenticatedUser(request)
	const appId = params.appId
	const sessionId = params.sessionId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })
	if (!sessionId) throw new Response("Mangler sesjon-ID", { status: 400 })

	// Verify session belongs to this application
	const session = await getScreeningSession(sessionId)
	if (!session) throw new Response("Screening-sesjon ikke funnet", { status: 404 })
	if (session.applicationId !== appId) throw new Response("Sesjon tilhører ikke denne applikasjonen", { status: 403 })

	const formData = await request.formData()
	const intent = formData.get("intent") as string

	if (intent === "screening") {
		const questionId = formData.get("questionId") as string
		const answerValue = formData.get("answer") as string
		const answerComment = formData.get("answerComment") as string | null
		const answerLink = formData.get("answerLink") as string | null
		if (!questionId) throw new Response("Mangler spørsmål-ID", { status: 400 })

		// Validate that questionId belongs to this app's screening questions
		const { getScreeningDataForApp } = await import("~/db/queries/screening.server")
		const screeningData = await getScreeningDataForApp(appId)
		const validQuestionIds = new Set(screeningData.questions.map((q) => q.id))
		if (!validQuestionIds.has(questionId)) {
			throw new Response("Spørsmålet tilhører ikke denne applikasjonens screening", { status: 403 })
		}

		try {
			await saveScreeningSessionAnswer({
				sessionId,
				questionId,
				answer: answerValue || null,
				comment: answerComment || null,
				link: answerLink || null,
				performedBy: authedUser.navIdent,
			})
		} catch (e) {
			if (e instanceof Error && e.message.includes("ikke funnet")) throw new Response(e.message, { status: 404 })
			if (e instanceof Error && e.message.includes("fullført")) throw new Response(e.message, { status: 409 })
			if (e instanceof Error && e.message.includes("violates foreign key"))
				throw new Response("Ugyldig spørsmål-ID", { status: 400 })
			throw e
		}

		return data({ success: true, controlId: "screening", screening: true })
	}

	if (intent === "complete") {
		try {
			await completeScreeningSession(sessionId, authedUser)
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e)
			logger.error("[screening-complete] Failed", { message, error: e })
			if (e instanceof Error && e.message.includes("ikke funnet")) throw new Response(e.message, { status: 404 })
			if (e instanceof Error && e.message.includes("allerede fullført")) throw new Response(e.message, { status: 409 })
			if (e instanceof Error && e.message.includes("samtidig")) throw new Response(e.message, { status: 409 })
			// Throw as Error so React Router serializes message + stack to the error boundary
			if (e instanceof Error) throw e
			throw new Error(message)
		}

		// Sync application controls — non-blocking so a sync failure doesn't hide the successful completion
		try {
			const { syncApplicationControls } = await import("~/db/queries/application-controls.server")
			await syncApplicationControls(appId, authedUser.navIdent)
		} catch (syncError) {
			logger.error("[screening-complete] syncApplicationControls failed (non-blocking)", {
				appId,
				sessionId,
				error: syncError,
			})
		}

		// Redirect to detaljer page with screeninger tab
		const url = new URL(request.url)
		const screeningSegment = `/screening/${sessionId}`
		const idx = url.pathname.indexOf(screeningSegment)
		const appBasePath = idx !== -1 ? url.pathname.slice(0, idx) : `/applikasjoner/${appId}`
		return redirect(`${appBasePath}/detaljer?fane=screeninger`)
	}

	if (intent === "update-participants") {
		const participants = parseParticipantsFormValue(formData.get("participants"))
		try {
			await updateScreeningSessionParticipants(sessionId, participants, authedUser.navIdent)
		} catch (e) {
			if (e instanceof Error && e.message.includes("ikke funnet")) throw new Response(e.message, { status: 404 })
			if (e instanceof Error && e.message.includes("fullført")) throw new Response(e.message, { status: 409 })
			throw e
		}
		return data({ success: true })
	}

	// Stage app-level intents instead of executing them immediately
	if (session.status === "completed") {
		throw new Response("Kan ikke endre data i en fullført screening-sesjon", { status: 409 })
	}

	if (STAGED_INTENTS.has(intent)) {
		// Validate auth for privileged intents before staging
		if (intent === "set-oracle-role-criticality") {
			const { isAdmin } = await import("~/lib/authorization.server")
			if (!isAdmin(authedUser)) {
				throw new Response("Kun administratorer kan endre Oracle-rollekritikalitet", { status: 403 })
			}
			const instanceId = (formData.get("instanceId") as string)?.trim()
			if (instanceId) {
				const { getOracleInstances } = await import("~/lib/oracle-revisjon.server")
				const { canUserSeeInstance } = await import("~/lib/oracle-access.server")
				const allInstances = await getOracleInstances()
				const instance = allInstances.find((i) => i.id === instanceId)
				if (!instance || !canUserSeeInstance(instance, authedUser.groups)) {
					throw new Response("Du har ikke tilgang til denne Oracle-instansen", { status: 403 })
				}
			}
		}

		// Validate required fields before staging
		if (intent === "add-persistence") {
			const type = formData.get("persistenceType") as string
			const name = (formData.get("persistenceName") as string)?.trim()
			if (!type || !name) {
				return data({ success: false, error: "Type og navn er påkrevd for å legge til database" })
			}
		}

		const payload = Object.fromEntries(formData.entries())
		try {
			await stageOperation({
				sessionId,
				intent,
				payload,
				performedBy: authedUser.navIdent,
			})
		} catch (e) {
			if (e instanceof Error) {
				if (e.message.includes("ikke funnet")) {
					throw new Response(e.message, { status: 404 })
				}
				if (e.message.includes("fullført")) {
					throw new Response(e.message, { status: 409 })
				}
			}
			throw e
		}

		// Auto-confirm the screening answer only when economy classification is complete
		if (intent === "save-economy-classification") {
			const questionId = formData.get("questionId") as string
			const isEconomySystem = formData.get("isEconomySystem") as string
			const justification = (formData.get("justification") as string)?.trim()
			const economySystemType = formData.get("economySystemType") as string
			const isComplete = isEconomySystem && justification && (isEconomySystem !== "ja" || economySystemType)
			if (questionId && isComplete) {
				// Validate questionId belongs to this app's screening before auto-confirming
				const { getScreeningDataForApp } = await import("~/db/queries/screening.server")
				const screeningData = await getScreeningDataForApp(appId)
				const validQuestionIds = new Set(screeningData.questions.map((q) => q.id))
				if (validQuestionIds.has(questionId)) {
					try {
						await saveScreeningSessionAnswer({
							sessionId,
							questionId,
							answer: "confirmed",
							comment: null,
							link: null,
							performedBy: authedUser.navIdent,
						})
					} catch {
						// Ignore — question might not exist in this session
					}
				}
			}
		}

		return data({ success: true, controlId: "screening", screening: true })
	}

	throw new Response("Ukjent handling", { status: 400 })
}
