import { redirect } from "react-router"
import { linkAppToTeam, unlinkAppFromTeam } from "~/db/queries/applications.server"
import {
	configureOracleInstance,
	getOracleInstancesForApp,
	removeOracleInstance,
	saveAuditEvidenceSnapshot,
	setIncludeInReport,
} from "~/db/queries/audit-evidence.server"
import {
	archiveApplication,
	getApplicationDetail,
	linkApplication,
	linkPersistenceToOracleInstance,
	promoteToPrimary,
	renameApplication,
	unarchiveApplication,
	unlinkApplication,
} from "~/db/queries/nais.server"
import {
	addApplicationElement,
	confirmApplicationElement,
	rejectApplicationElement,
	removeApplicationElement,
} from "~/db/queries/technology-elements.server"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { requireApplicationManagementAccess } from "~/lib/authorization.server"
import { canUserSeeInstance } from "~/lib/oracle-access.server"
import { getAuditEvidence, getAuditEvidenceExcel, getOracleInstances } from "~/lib/oracle-revisjon.server"
import type { Route } from "./+types/index"

async function requireAccessibleOracleInstance(instanceId: string, userGroups: string[], allowMissing = false) {
	const instances = await getOracleInstances()
	const instance = instances.find((candidate) => candidate.id === instanceId)
	if (!instance && allowMissing) return
	if (!instance || !canUserSeeInstance(instance, userGroups)) {
		throw new Response("Ikke autorisert til Oracle-instansen", { status: 403 })
	}
}

async function requireConfiguredOracleInstance(
	appId: string,
	instanceId: string,
	userGroups: string[],
	allowMissing = false,
) {
	const configuredInstances = await getOracleInstancesForApp(appId)
	if (!configuredInstances.some((instance) => instance.instanceId === instanceId)) {
		throw new Response("Oracle-instansen er ikke konfigurert for applikasjonen", { status: 403 })
	}
	await requireAccessibleOracleInstance(instanceId, userGroups, allowMissing)
}

export async function action({ params, request, url }: Route.ActionArgs) {
	const appId = params.appId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })

	const marker = `/applikasjoner/${appId}`
	const idx = url.pathname.indexOf(marker)
	const appBase = idx !== -1 ? url.pathname.slice(0, idx + marker.length) : `/applikasjoner/${appId}`

	const authedUser = await requireAuthenticatedUser(request)
	await requireApplicationManagementAccess(authedUser, appId)

	const formData = await request.formData()
	const intent = formData.get("intent") as string
	const performer = authedUser.navIdent

	if (intent === "archive") {
		await archiveApplication(appId, authedUser.navIdent)
		return redirect("/dashboard")
	} else if (intent === "unarchive") {
		await unarchiveApplication(appId, authedUser.navIdent)
	} else if (intent === "rename") {
		const newName = (formData.get("name") as string)?.trim()
		if (!newName) throw new Response("Navn kan ikke være tomt", { status: 400 })
		await renameApplication(appId, newName, performer)
	} else if (intent === "promoteToPrimary") {
		const newPrimaryId = formData.get("newPrimaryId") as string
		if (!newPrimaryId) throw new Response("Mangler newPrimaryId", { status: 400 })
		const detail = await getApplicationDetail(appId)
		if (!detail?.linkedApps.some((app) => app.id === newPrimaryId)) {
			throw new Response("Applikasjonen er ikke lenket til denne hovedapplikasjonen", { status: 403 })
		}
		for (const linkedApp of detail.linkedApps) {
			await requireApplicationManagementAccess(authedUser, linkedApp.id)
		}
		await promoteToPrimary(newPrimaryId, appId, performer, [
			appId,
			...detail.linkedApps.map((linkedApp) => linkedApp.id),
		])
		return redirect(`/applikasjoner/${newPrimaryId}/rediger`)
	} else if (intent === "promoteThis") {
		const currentPrimaryId = formData.get("currentPrimaryId") as string
		if (!currentPrimaryId) throw new Response("Mangler currentPrimaryId", { status: 400 })
		const detail = await getApplicationDetail(appId)
		if (detail?.primaryApp?.id !== currentPrimaryId) {
			throw new Response("Applikasjonen er ikke lenket til denne hovedapplikasjonen", { status: 403 })
		}
		const primaryDetail = await getApplicationDetail(currentPrimaryId)
		if (!primaryDetail?.linkedApps.some((app) => app.id === appId)) {
			throw new Response("Applikasjonen er ikke lenket til denne hovedapplikasjonen", { status: 403 })
		}
		await requireApplicationManagementAccess(authedUser, currentPrimaryId)
		for (const linkedApp of primaryDetail.linkedApps) {
			await requireApplicationManagementAccess(authedUser, linkedApp.id)
		}
		await promoteToPrimary(appId, currentPrimaryId, performer, [
			currentPrimaryId,
			...primaryDetail.linkedApps.map((linkedApp) => linkedApp.id),
		])
	} else if (intent === "link") {
		const linkedId = formData.get("linkedId") as string
		if (!linkedId) throw new Response("Mangler linkedId", { status: 400 })
		if (linkedId === appId) throw new Response("En applikasjon kan ikke lenkes til seg selv", { status: 400 })
		await requireApplicationManagementAccess(authedUser, linkedId)
		await linkApplication(linkedId, appId, performer)
	} else if (intent === "unlink") {
		const unlinkId = formData.get("unlinkId") as string
		if (!unlinkId) throw new Response("Mangler unlinkId", { status: 400 })
		const detail = await getApplicationDetail(appId)
		if (!detail?.linkedApps.some((app) => app.id === unlinkId)) {
			throw new Response("Applikasjonen er ikke lenket til denne hovedapplikasjonen", { status: 403 })
		}
		await requireApplicationManagementAccess(authedUser, unlinkId)
		await unlinkApplication(unlinkId, appId, performer)
	} else if (intent === "addElement") {
		const elementId = formData.get("elementId") as string
		if (!elementId) throw new Response("Mangler elementId", { status: 400 })
		await addApplicationElement(appId, elementId, performer)
	} else if (intent === "removeElement") {
		const elementId = formData.get("elementId") as string
		if (!elementId) throw new Response("Mangler elementId", { status: 400 })
		await removeApplicationElement(appId, elementId, performer)
	} else if (intent === "confirmElement") {
		const linkId = formData.get("linkId") as string
		if (!linkId) throw new Response("Mangler linkId", { status: 400 })
		await confirmApplicationElement(appId, linkId, performer)
	} else if (intent === "rejectElement") {
		const linkId = formData.get("linkId") as string
		const reason = (formData.get("reason") as string)?.trim()
		if (!linkId) throw new Response("Mangler linkId", { status: 400 })
		if (!reason) throw new Response("Begrunnelse er påkrevd", { status: 400 })
		await rejectApplicationElement(appId, linkId, reason, performer)
	} else if (intent === "link-team") {
		const devTeamId = formData.get("devTeamId") as string
		if (!devTeamId) throw new Response("Mangler devTeamId", { status: 400 })
		await linkAppToTeam(appId, devTeamId, performer)
	} else if (intent === "unlink-team") {
		const devTeamId = formData.get("devTeamId") as string
		if (!devTeamId) throw new Response("Mangler devTeamId", { status: 400 })
		await unlinkAppFromTeam(appId, devTeamId, performer)
	} else if (intent === "addOracleInstance") {
		const instanceId = formData.get("instanceId") as string
		if (!instanceId) throw new Response("Mangler instanceId", { status: 400 })
		await requireAccessibleOracleInstance(instanceId, authedUser.groups)
		await configureOracleInstance(appId, instanceId, authedUser.navIdent)
	} else if (intent === "removeOracleInstance") {
		const instanceId = formData.get("instanceId") as string
		if (!instanceId) throw new Response("Mangler instanceId", { status: 400 })
		await requireConfiguredOracleInstance(appId, instanceId, authedUser.groups, true)
		await removeOracleInstance(appId, instanceId, performer)
	} else if (intent === "toggleOracleReport") {
		const instanceId = formData.get("instanceId") as string
		const include = formData.get("include") as string
		if (!instanceId) throw new Response("Mangler instanceId", { status: 400 })
		await requireConfiguredOracleInstance(appId, instanceId, authedUser.groups)
		await setIncludeInReport(appId, instanceId, include === "true", performer)
	} else if (intent === "fetchEvidence") {
		const instanceId = formData.get("instanceId") as string
		if (!instanceId) throw new Response("Mangler instanceId", { status: 400 })
		await requireConfiguredOracleInstance(appId, instanceId, authedUser.groups)
		const [evidence, excel] = await Promise.all([getAuditEvidence(instanceId), getAuditEvidenceExcel(instanceId)])
		await saveAuditEvidenceSnapshot(
			appId,
			instanceId,
			evidence.overallStatus,
			evidence.collectedAt,
			excel,
			authedUser.navIdent,
		)
	} else if (intent === "linkPersistenceToOracle") {
		const persistenceId = formData.get("persistenceId") as string
		const oracleInstanceId = (formData.get("oracleInstanceId") as string) || null
		if (!persistenceId) throw new Response("Mangler persistenceId", { status: 400 })
		const detail = await getApplicationDetail(appId)
		const persistence = detail?.persistence.find((entry) => entry.id === persistenceId && entry.type === "oracle")
		if (!persistence) {
			throw new Response("Oracle-persistensoppføringen tilhører ikke applikasjonen", { status: 403 })
		}
		const activeOracleInstances = await getOracleInstancesForApp(appId)
		if (
			persistence.oracleInstanceId &&
			activeOracleInstances.some((instance) => instance.instanceId === persistence.oracleInstanceId)
		) {
			await requireConfiguredOracleInstance(appId, persistence.oracleInstanceId, authedUser.groups)
		}
		if (oracleInstanceId) {
			await requireConfiguredOracleInstance(appId, oracleInstanceId, authedUser.groups)
		}
		await linkPersistenceToOracleInstance(persistenceId, oracleInstanceId, performer)
	} else {
		throw new Response("Ugyldig handling", { status: 400 })
	}

	return redirect(`${appBase}/rediger`)
}
