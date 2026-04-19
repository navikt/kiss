import type { ActionFunctionArgs } from "react-router"
import { redirect } from "react-router"
import { getAllControlsForSelection } from "~/db/queries/framework.server"
import { approveRoutine, deleteRoutine, getRoutine, replaceRoutine, updateRoutine } from "~/db/queries/routines.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import type { DataClassification, GroupAccessClassification, PersistenceType } from "~/db/schema/applications"
import {
	ROUTINE_ACTIVITY_TYPES,
	type RoutineActivityType,
	type RoutineStatus,
	routineStatusEnum,
} from "~/db/schema/routines"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { canApproveRoutine, requireAdmin } from "~/lib/authorization.server"
import {
	frequencyLabels,
	getStrictestFrequency,
	isFrequencyAtLeastAsOften,
	isRoutineFrequency,
} from "~/lib/routine-frequencies"

export async function action({ request, params }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const { seksjon, rutineId } = params
	if (!seksjon || !rutineId) throw new Response("Mangler parametere", { status: 400 })

	// Block editing of approved routines
	const existingRoutine = await getRoutine(rutineId)
	if (existingRoutine?.status === "approved") {
		throw new Response("Godkjente rutiner kan ikke redigeres. Lag en kopi for å gjøre endringer.", { status: 403 })
	}

	const formData = await request.formData()
	const intent = formData.get("intent") as string

	if (intent === "update") {
		const name = (formData.get("name") as string)?.trim()
		const description = (formData.get("description") as string)?.trim() || null
		const frequency = formData.get("frequency") as string
		const responsibleRole = (formData.get("responsibleRole") as string)?.trim() || null
		const appliesToAllInSection = formData.get("appliesToAllInSection") === "on"
		const activityTypeRaw = (formData.get("activityType") as string)?.trim() || null
		const activityType =
			activityTypeRaw && ROUTINE_ACTIVITY_TYPES.includes(activityTypeRaw as RoutineActivityType)
				? (activityTypeRaw as RoutineActivityType)
				: null
		const technologyElementIds = formData.getAll("technologyElementIds") as string[]
		const controlIds = formData.getAll("controlIds") as string[]
		const groupClassifications = formData.getAll("groupClassifications") as string[]
		const statusRaw = formData.get("status") as string | null
		const status =
			statusRaw && routineStatusEnum.includes(statusRaw as RoutineStatus) ? (statusRaw as RoutineStatus) : undefined

		// Parse persistence links from form
		const plTypes = formData.getAll("plPersistenceType") as string[]
		const plClassifications = formData.getAll("plDataClassification") as string[]
		const persistenceLinks = plTypes
			.map((t, i) => ({
				persistenceType: (t.trim() || null) as PersistenceType | null,
				dataClassification: (plClassifications[i]?.trim() || null) as DataClassification | null,
			}))
			.filter((l) => l.persistenceType || l.dataClassification)

		if (!name) throw new Response("Navn er påkrevd", { status: 400 })
		if (!isRoutineFrequency(frequency)) throw new Response("Ugyldig frekvens", { status: 400 })

		// Validate frequency is at least as often as the strictest control requirement
		if (controlIds.length > 0) {
			const allControls = await getAllControlsForSelection()
			const selectedControls = allControls.filter((c) => controlIds.includes(c.id))
			const minFreq = getStrictestFrequency(selectedControls.map((c) => c.frequency))
			if (minFreq && !isFrequencyAtLeastAsOften(frequency, minFreq)) {
				throw new Response(`Frekvensen kan ikke være sjeldnere enn kravet (${frequencyLabels[minFreq]})`, {
					status: 400,
				})
			}
		}

		// Parse multiple question links from form
		const questionIds = formData.getAll("questionId") as string[]
		const choiceValues = formData.getAll("choiceValue") as string[]
		const screeningQuestionLinks = questionIds
			.map((qId, i) => ({ questionId: qId, choiceValue: choiceValues[i] ?? "" }))
			.filter((l) => l.questionId)

		// Keep first link as legacy single field for backward compat
		const firstLink = screeningQuestionLinks[0]

		await updateRoutine({
			id: rutineId,
			name,
			description,
			frequency,
			responsibleRole,
			appliesToAllInSection,
			activityType,
			persistenceLinks,
			screeningQuestionId: firstLink?.questionId ?? null,
			screeningChoiceValue: firstLink?.choiceValue ?? null,
			screeningQuestionLinks,
			technologyElementIds,
			controlIds,
			groupClassifications: groupClassifications.filter(Boolean) as GroupAccessClassification[],
			status,
			updatedBy: authedUser.navIdent,
		})

		return redirect(`/seksjoner/${seksjon}/rutiner/${rutineId}`)
	}

	if (intent === "delete") {
		await deleteRoutine(rutineId, authedUser.navIdent)
		return redirect(`/seksjoner/${seksjon}/rutiner`)
	}

	if (intent === "approve-replace") {
		const section = await getSectionBySlug(seksjon)
		if (!section) throw new Response("Seksjon ikke funnet", { status: 404 })
		const routine = await getRoutine(rutineId)
		if (!routine) throw new Response("Rutine ikke funnet", { status: 404 })

		const effectiveRole = routine.responsibleRole || routine.controls.find((c) => c.responsible)?.responsible || null
		if (!canApproveRoutine(authedUser, effectiveRole, section.id)) {
			throw new Response("Du har ikke riktig rolle til å godkjenne denne rutinen", { status: 403 })
		}

		const deadlinePolicy = formData.get("deadlinePolicy") as "reset" | "continue"
		if (!deadlinePolicy || !["reset", "continue"].includes(deadlinePolicy)) {
			throw new Response("Ugyldig fristpolicy", { status: 400 })
		}

		if (!routine.sourceRoutineId) {
			throw new Response("Rutinen har ikke et opphav å erstatte", { status: 400 })
		}

		await replaceRoutine(rutineId, routine.sourceRoutineId, deadlinePolicy, authedUser.navIdent)
		return redirect(`/seksjoner/${seksjon}/rutiner/${rutineId}`)
	}

	if (intent === "approve-as-new") {
		const section = await getSectionBySlug(seksjon)
		if (!section) throw new Response("Seksjon ikke funnet", { status: 404 })
		const routine = await getRoutine(rutineId)
		if (!routine) throw new Response("Rutine ikke funnet", { status: 404 })

		const effectiveRole = routine.responsibleRole || routine.controls.find((c) => c.responsible)?.responsible || null
		if (!canApproveRoutine(authedUser, effectiveRole, section.id)) {
			throw new Response("Du har ikke riktig rolle til å godkjenne denne rutinen", { status: 403 })
		}

		await approveRoutine(rutineId, authedUser.navIdent)
		return redirect(`/seksjoner/${seksjon}/rutiner/${rutineId}`)
	}

	throw new Response("Ugyldig handling", { status: 400 })
}
