import type { ActionFunctionArgs } from "react-router"
import { data, redirect } from "react-router"
import {
	completeScreeningSession,
	getScreeningSession,
	saveScreeningSessionAnswer,
	stageOperation,
	updateScreeningSessionParticipants,
} from "~/db/queries/screening-sessions.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
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
])

export async function action({ request, params }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
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
			console.error("[screening-complete] Failed:", message, e)
			if (e instanceof Error && e.message.includes("ikke funnet")) throw new Response(e.message, { status: 404 })
			if (e instanceof Error && e.message.includes("allerede fullført")) throw new Response(e.message, { status: 409 })
			// Throw as Error so React Router serializes message + stack to the error boundary
			if (e instanceof Error) throw e
			throw new Error(message)
		}

		// Sync application controls after completing screening
		const { syncApplicationControls } = await import("~/db/queries/application-controls.server")
		await syncApplicationControls(appId, authedUser.navIdent)

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
		const payload = Object.fromEntries(formData.entries())
		await stageOperation({
			sessionId,
			intent,
			payload,
			performedBy: authedUser.navIdent,
		})

		// Auto-confirm the screening answer only when economy classification is complete
		if (intent === "save-economy-classification") {
			const questionId = formData.get("questionId") as string
			const isEconomySystem = formData.get("isEconomySystem") as string
			const justification = (formData.get("justification") as string)?.trim()
			const economySystemType = formData.get("economySystemType") as string
			const isComplete = isEconomySystem && justification && (isEconomySystem !== "ja" || economySystemType)
			if (questionId && isComplete) {
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

		return data({ success: true, controlId: "screening", screening: true })
	}

	throw new Response("Ukjent handling", { status: 400 })
}
