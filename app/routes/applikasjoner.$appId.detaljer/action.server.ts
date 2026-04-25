import type { ActionFunctionArgs } from "react-router"
import { data, redirect } from "react-router"
import {
	acknowledgeUnknownApp,
	addManualGroup,
	addManualPersistence,
	archiveManualPersistence,
	removeManualGroup,
	revokeAcknowledgment,
	unarchiveManualPersistence,
	updatePersistenceClassification,
	upsertGroupCriticality,
} from "~/db/queries/nais.server"
import { isInstanceLinkedToApp, upsertOracleRoleCriticality } from "~/db/queries/oracle-roles.server"
import { generateAppComplianceReport } from "~/db/queries/reports.server"
import { createReview } from "~/db/queries/routines.server"
import {
	type DataClassification,
	type GroupCriticality,
	groupCriticalityEnum,
	persistenceTypeEnum,
} from "~/db/schema/applications"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { isAdmin } from "~/lib/authorization.server"

export async function action({ request, params }: ActionFunctionArgs) {
	const appId = params.appId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })

	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)

	const formData = await request.formData()
	const intent = formData.get("intent")

	if (intent === "create-draft") {
		const routineId = formData.get("routineId") as string
		const sectionSlug = formData.get("sectionSlug") as string
		if (!routineId) {
			return data({ success: false, message: null, error: "Mangler rutine-ID" })
		}
		if (!sectionSlug) {
			return data({ success: false, message: null, error: "Mangler seksjons-slug" })
		}
		const { getRoutine } = await import("~/db/queries/routines.server")
		const routine = await getRoutine(routineId)
		if (!routine) {
			return data({ success: false, message: null, error: "Fant ikke rutine" })
		}
		const now = new Date()
		const title = `${routine.name} — ${now.toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" })}`
		const review = await createReview({
			routineId,
			applicationId: appId,
			title,
			summary: null,
			routineSnapshotPath: null,
			reviewedAt: now,
			createdBy: authedUser.navIdent,
			participants: [],
		})
		return redirect(`/seksjoner/${sectionSlug}/rutiner/${routineId}/gjennomgang/${review.id}`)
	}

	if (intent === "discard-review") {
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
		const ruleApplication = formData.get("ruleApplication") as string
		const comment = (formData.get("comment") as string)?.trim()
		if (!ruleApplication) throw new Response("Mangler applikasjonsnavn", { status: 400 })
		if (!comment) return data({ success: false, message: null, error: "Kommentar er obligatorisk" })
		await acknowledgeUnknownApp(appId, ruleApplication, comment, authedUser.navIdent)
		return data({ success: true, message: `${ruleApplication} er kvittert ut.`, error: null })
	}

	if (intent === "revoke-acknowledgment") {
		const ruleApplication = formData.get("ruleApplication") as string
		if (!ruleApplication) throw new Response("Mangler applikasjonsnavn", { status: 400 })
		await revokeAcknowledgment(appId, ruleApplication, authedUser.navIdent)
		return data({ success: true, message: `Kvittering for ${ruleApplication} er trukket tilbake.`, error: null })
	}

	if (intent === "add-persistence") {
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
			console.error("addManualPersistence failed", err)
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
		const persistenceId = (formData.get("persistenceId") as string)?.trim()
		if (!persistenceId) throw new Response("Mangler persistens-ID", { status: 400 })
		await archiveManualPersistence(persistenceId, authedUser.navIdent)
		const { syncApplicationControls } = await import("~/db/queries/application-controls.server")
		await syncApplicationControls(appId, authedUser.navIdent)
		return data({ success: true, message: "Database arkivert.", error: null })
	}

	if (intent === "unarchive-persistence") {
		const persistenceId = (formData.get("persistenceId") as string)?.trim()
		if (!persistenceId) throw new Response("Mangler persistens-ID", { status: 400 })
		await unarchiveManualPersistence(persistenceId, authedUser.navIdent)
		const { syncApplicationControls } = await import("~/db/queries/application-controls.server")
		await syncApplicationControls(appId, authedUser.navIdent)
		return data({ success: true, message: "Database reaktivert.", error: null })
	}

	if (intent === "add-manual-group") {
		const groupId = (formData.get("groupId") as string)?.trim()
		const groupName = (formData.get("groupName") as string)?.trim() || null
		if (!groupId) return data({ success: false, message: null, error: "Mangler gruppe-ID" })
		const result = await addManualGroup(appId, groupId, groupName, authedUser.navIdent)
		if (!result) return data({ success: false, message: null, error: "Gruppen finnes allerede" })
		return data({ success: true, message: `Gruppe "${groupName || groupId}" lagt til.`, error: null })
	}

	if (intent === "remove-manual-group") {
		const manualGroupId = formData.get("manualGroupId") as string
		if (!manualGroupId) throw new Response("Mangler gruppe-ID", { status: 400 })
		await removeManualGroup(manualGroupId, appId, authedUser.navIdent)
		return data({ success: true, message: "Gruppe fjernet.", error: null })
	}

	if (intent === "set-group-criticality") {
		const groupId = (formData.get("groupId") as string)?.trim()
		const criticality = formData.get("criticality") as string
		if (!groupId) return data({ success: false, message: null, error: "Mangler gruppe-ID" })
		if (!groupCriticalityEnum.includes(criticality as GroupCriticality)) {
			return data({ success: false, message: null, error: "Ugyldig kritikalitet" })
		}
		await upsertGroupCriticality(appId, groupId, criticality as GroupCriticality, authedUser.navIdent)
		return data({ success: true, message: "Kritikalitet oppdatert.", error: null })
	}

	if (intent === "set-oracle-role-criticality") {
		if (!isAdmin(authedUser)) {
			return data({ success: false, message: null, error: "Ikke autorisert" })
		}
		const instanceId = (formData.get("instanceId") as string)?.trim()
		const roleName = (formData.get("roleName") as string)?.trim()
		const criticality = formData.get("criticality") as string
		if (!instanceId || !roleName) {
			return data({ success: false, message: null, error: "Mangler instans-ID eller rollenavn" })
		}
		if (!groupCriticalityEnum.includes(criticality as GroupCriticality)) {
			return data({ success: false, message: null, error: "Ugyldig kritikalitet" })
		}
		const linked = await isInstanceLinkedToApp(appId, instanceId)
		if (!linked) {
			return data({ success: false, message: null, error: "Instansen er ikke knyttet til denne applikasjonen" })
		}
		const { getOracleInstances } = await import("~/lib/oracle-revisjon.server")
		const { canUserSeeInstance } = await import("~/lib/oracle-access.server")
		const allInstances = await getOracleInstances()
		const instance = allInstances.find((i) => i.id === instanceId)
		if (!instance || !canUserSeeInstance(instance, authedUser.groups)) {
			return data({ success: false, message: null, error: "Ingen tilgang til denne instansen" })
		}
		await upsertOracleRoleCriticality(appId, instanceId, roleName, criticality as GroupCriticality, authedUser.navIdent)
		const { syncApplicationControls } = await import("~/db/queries/application-controls.server")
		await syncApplicationControls(appId, authedUser.navIdent)
		return data({ success: true, message: "Rollekritikalitet oppdatert.", error: null })
	}

	if (intent === "save-control-comment") {
		const applicationControlId = formData.get("applicationControlId") as string
		if (!applicationControlId) return data({ success: false, message: null, error: "Mangler kontroll-ID" })
		const comment = (formData.get("comment") as string)?.trim() || null
		const { updateControlComment } = await import("~/db/queries/application-controls.server")
		await updateControlComment(applicationControlId, comment, authedUser.navIdent)
		return data({ success: true, message: "Kommentar lagret.", error: null })
	}

	return data({ success: false, message: null, error: "Ukjent handling" })
}
