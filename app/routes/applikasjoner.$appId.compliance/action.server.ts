import type { ActionFunctionArgs } from "react-router"
import { data } from "react-router"
import {
	addManualGroup,
	addManualPersistence,
	archiveManualPersistence,
	removeManualGroup,
	unarchiveManualPersistence,
	updatePersistenceClassification,
	upsertGroupCriticality,
} from "~/db/queries/nais.server"
import { saveRoutineSelection, saveScreeningAnswer } from "~/db/queries/screening.server"
import {
	type DataClassification,
	type GroupCriticality,
	groupCriticalityEnum,
	persistenceTypeEnum,
} from "~/db/schema/applications"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"

export async function action({ request, params }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	const appId = params.appId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })

	const formData = await request.formData()
	const intent = formData.get("intent") as string

	if (intent === "screening") {
		const questionId = formData.get("questionId") as string
		const answerValue = formData.get("answer") as string
		const answerComment = formData.get("answerComment") as string | null
		const answerLink = formData.get("answerLink") as string | null
		if (!questionId) throw new Response("Mangler spørsmål-ID", { status: 400 })

		const answer = answerValue || null
		await saveScreeningAnswer(appId, questionId, answer, authedUser.navIdent, answerComment, answerLink)

		const { syncApplicationControls } = await import("~/db/queries/application-controls.server")
		await syncApplicationControls(appId, authedUser.navIdent)

		return data({ success: true, controlId: "screening", screening: true })
	}

	if (intent === "selectRoutine") {
		const choiceEffectId = formData.get("choiceEffectId") as string
		const routineId = (formData.get("routineId") as string) || null
		if (!choiceEffectId) throw new Response("Mangler effekt-ID", { status: 400 })

		await saveRoutineSelection(appId, choiceEffectId, routineId, authedUser.navIdent)

		const { syncApplicationControls } = await import("~/db/queries/application-controls.server")
		await syncApplicationControls(appId, authedUser.navIdent)

		return data({ success: true, controlId: "screening", screening: true })
	}

	if (intent === "add-persistence") {
		const type = formData.get("persistenceType") as string
		const name = (formData.get("persistenceName") as string)?.trim()
		const classification = (formData.get("dataClassification") as string) || null

		if (!type || !name) {
			return data({ success: false, controlId: "screening", screening: true })
		}
		if (!persistenceTypeEnum.includes(type as (typeof persistenceTypeEnum)[number])) {
			return data({ success: false, controlId: "screening", screening: true })
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
			console.error("addManualPersistence failed", err)
			return data({
				success: false,
				controlId: "screening",
				screening: true,
				error: "Kunne ikke legge til database. Sjekk at navnet ikke allerede er i bruk.",
			})
		}

		const { syncApplicationControls } = await import("~/db/queries/application-controls.server")
		await syncApplicationControls(appId, authedUser.navIdent)

		return data({ success: true, controlId: "screening", screening: true })
	}

	if (intent === "update-persistence-classification") {
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

		return data({ success: true, controlId: "screening", screening: true })
	}

	if (intent === "archive-persistence") {
		const persistenceId = (formData.get("persistenceId") as string)?.trim()
		if (!persistenceId) throw new Response("Mangler persistens-ID", { status: 400 })
		await archiveManualPersistence(persistenceId, authedUser.navIdent)

		const { syncApplicationControls } = await import("~/db/queries/application-controls.server")
		await syncApplicationControls(appId, authedUser.navIdent)

		return data({ success: true, controlId: "screening", screening: true })
	}

	if (intent === "unarchive-persistence") {
		const persistenceId = (formData.get("persistenceId") as string)?.trim()
		if (!persistenceId) throw new Response("Mangler persistens-ID", { status: 400 })
		await unarchiveManualPersistence(persistenceId, authedUser.navIdent)

		const { syncApplicationControls } = await import("~/db/queries/application-controls.server")
		await syncApplicationControls(appId, authedUser.navIdent)

		return data({ success: true, controlId: "screening", screening: true })
	}

	if (intent === "add-manual-group") {
		const groupId = (formData.get("groupId") as string)?.trim()
		const groupName = (formData.get("groupName") as string)?.trim() || null
		if (!groupId) return data({ success: false, controlId: "screening", screening: true })
		await addManualGroup(appId, groupId, groupName, authedUser.navIdent)
		return data({ success: true, controlId: "screening", screening: true })
	}

	if (intent === "remove-manual-group") {
		const manualGroupId = formData.get("manualGroupId") as string
		if (!manualGroupId) throw new Response("Mangler gruppe-ID", { status: 400 })
		await removeManualGroup(manualGroupId, appId, authedUser.navIdent)
		return data({ success: true, controlId: "screening", screening: true })
	}

	if (intent === "set-group-criticality") {
		const groupId = (formData.get("groupId") as string)?.trim()
		const criticality = formData.get("criticality") as string
		if (!groupId) return data({ success: false, controlId: "screening", screening: true })
		if (!groupCriticalityEnum.includes(criticality as GroupCriticality)) {
			return data({ success: false, controlId: "screening", screening: true })
		}
		await upsertGroupCriticality(appId, groupId, criticality as GroupCriticality, authedUser.navIdent)
		return data({ success: true, controlId: "screening", screening: true })
	}

	if (intent === "set-oracle-role-criticality") {
		const { isAdmin } = await import("~/lib/authorization.server")
		if (!isAdmin(authedUser)) {
			return data({ success: false, controlId: "screening", screening: true })
		}
		const instanceId = (formData.get("instanceId") as string)?.trim()
		const roleName = (formData.get("roleName") as string)?.trim()
		const criticality = formData.get("criticality") as string
		if (!instanceId || !roleName) return data({ success: false, controlId: "screening", screening: true })
		if (!groupCriticalityEnum.includes(criticality as GroupCriticality)) {
			return data({ success: false, controlId: "screening", screening: true })
		}
		const { isInstanceLinkedToApp, upsertOracleRoleCriticality } = await import("~/db/queries/oracle-roles.server")
		const linked = await isInstanceLinkedToApp(appId, instanceId)
		if (!linked) return data({ success: false, controlId: "screening", screening: true })
		const { getOracleInstances } = await import("~/lib/oracle-revisjon.server")
		const { canUserSeeInstance } = await import("~/lib/oracle-access.server")
		const allInstances = await getOracleInstances()
		const instance = allInstances.find((i) => i.id === instanceId)
		if (!instance || !canUserSeeInstance(instance, authedUser.groups)) {
			return data({ success: false, controlId: "screening", screening: true })
		}
		await upsertOracleRoleCriticality(appId, instanceId, roleName, criticality as GroupCriticality, authedUser.navIdent)
		const { syncApplicationControls } = await import("~/db/queries/application-controls.server")
		await syncApplicationControls(appId, authedUser.navIdent)
		return data({ success: true, controlId: "screening", screening: true })
	}

	throw new Response("Ukjent handling", { status: 400 })
}
