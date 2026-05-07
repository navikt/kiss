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
import {
	type DataClassification,
	type GroupCriticality,
	groupCriticalityEnum,
	persistenceTypeEnum,
} from "~/db/schema/applications"
import type { NavUser } from "~/lib/auth.server"

/**
 * Handles app-level compliance intents (persistence, groups, oracle, economy).
 * Shared between the compliance route action and screening session action.
 * Returns a Response if handled, or null if the intent is not recognized.
 */
export async function handleComplianceIntent(
	intent: string,
	formData: FormData,
	appId: string,
	authedUser: NavUser,
): Promise<unknown | null> {
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

	if (intent === "save-economy-classification") {
		const isEconomySystemValue = formData.get("isEconomySystem") as string
		if (isEconomySystemValue !== "ja" && isEconomySystemValue !== "nei") {
			throw new Response("Ugyldig verdi for isEconomySystem – forventet 'ja' eller 'nei'", { status: 400 })
		}
		const isEconomySystem = isEconomySystemValue === "ja"
		const economySystemType = (formData.get("economySystemType") as string) || null
		const justification = (formData.get("justification") as string)?.trim()
		const questionId = formData.get("questionId") as string

		if (!justification) throw new Response("Begrunnelse er påkrevd", { status: 400 })
		if (!questionId) throw new Response("Mangler spørsmål-ID", { status: 400 })
		if (isEconomySystem && !economySystemType) throw new Response("Type er påkrevd for økonomisystem", { status: 400 })

		const { getScreeningQuestion } = await import("~/db/queries/screening.server")
		const question = await getScreeningQuestion(questionId)
		if (
			!question ||
			question.answerType !== "economy_system" ||
			question.archivedAt ||
			question.status !== "approved"
		) {
			throw new Response("Ugyldig spørsmål – må være et aktivt, godkjent spørsmål av typen 'economy_system'", {
				status: 400,
			})
		}

		if (question.sectionId) {
			const { getScreeningDataForApp } = await import("~/db/queries/screening.server")
			const screeningData = await getScreeningDataForApp(appId)
			const questionBelongsToApp = screeningData.questions.some((q) => q.id === questionId)
			if (!questionBelongsToApp) {
				throw new Response("Spørsmålet tilhører en seksjon applikasjonen ikke er del av", { status: 403 })
			}
		}

		const { economySystemTypeEnum } = await import("~/db/schema/applications")
		if (
			isEconomySystem &&
			!economySystemTypeEnum.includes(economySystemType as (typeof economySystemTypeEnum)[number])
		) {
			throw new Response("Ugyldig økonomisystem-type", { status: 400 })
		}

		const { saveEconomyClassification } = await import("~/db/queries/economy-classification.server")
		await saveEconomyClassification({
			applicationId: appId,
			isEconomySystem,
			economySystemType: isEconomySystem ? (economySystemType as (typeof economySystemTypeEnum)[number]) : null,
			justification,
			performedBy: authedUser.navIdent,
			questionId,
		})

		const { syncApplicationControls } = await import("~/db/queries/application-controls.server")
		await syncApplicationControls(appId, authedUser.navIdent)

		return data({ success: true, controlId: "screening", screening: true })
	}

	return null
}
