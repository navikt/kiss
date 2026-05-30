import type { ActionFunctionArgs } from "react-router"
import { redirect } from "react-router"
import { linkAppToTeam, unlinkAppFromTeam } from "~/db/queries/applications.server"
import {
	configureOracleInstance,
	removeOracleInstance,
	saveAuditEvidenceSnapshot,
	setIncludeInReport,
} from "~/db/queries/audit-evidence.server"
import {
	archiveApplication,
	linkApplication,
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
import { requireAdmin } from "~/lib/authorization.server"
import { getAuditEvidence, getAuditEvidenceExcel } from "~/lib/oracle-revisjon.server"

export async function action({ params, request }: ActionFunctionArgs) {
	const appId = params.appId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })

	const url = new URL(request.url)
	const marker = `/applikasjoner/${appId}`
	const idx = url.pathname.indexOf(marker)
	const appBase = idx !== -1 ? url.pathname.slice(0, idx + marker.length) : `/applikasjoner/${appId}`

	const authedUser = await requireAuthenticatedUser(request)
	requireAdmin(authedUser)

	const formData = await request.formData()
	const intent = formData.get("intent") as string
	// Audit-handlinger fra denne ruten skal alltid spores på innlogget admin
	// (ikke "system"), siden alle intents her er manuelle bruker-mutasjoner.
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
		await promoteToPrimary(newPrimaryId, appId, performer)
		return redirect(`/applikasjoner/${newPrimaryId}/rediger`)
	} else if (intent === "promoteThis") {
		const currentPrimaryId = formData.get("currentPrimaryId") as string
		if (!currentPrimaryId) throw new Response("Mangler currentPrimaryId", { status: 400 })
		await promoteToPrimary(appId, currentPrimaryId, performer)
	} else if (intent === "link") {
		const linkedId = formData.get("linkedId") as string
		if (!linkedId) throw new Response("Mangler linkedId", { status: 400 })
		await linkApplication(linkedId, appId, performer)
	} else if (intent === "unlink") {
		const unlinkId = formData.get("unlinkId") as string
		if (!unlinkId) throw new Response("Mangler unlinkId", { status: 400 })
		await unlinkApplication(unlinkId, performer)
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
		await confirmApplicationElement(linkId, performer)
	} else if (intent === "rejectElement") {
		const linkId = formData.get("linkId") as string
		const reason = (formData.get("reason") as string)?.trim()
		if (!linkId) throw new Response("Mangler linkId", { status: 400 })
		if (!reason) throw new Response("Begrunnelse er påkrevd", { status: 400 })
		await rejectApplicationElement(linkId, reason, performer)
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
		await configureOracleInstance(appId, instanceId, authedUser.navIdent)
	} else if (intent === "removeOracleInstance") {
		const instanceId = formData.get("instanceId") as string
		if (!instanceId) throw new Response("Mangler instanceId", { status: 400 })
		await removeOracleInstance(appId, instanceId, performer)
	} else if (intent === "toggleOracleReport") {
		const instanceId = formData.get("instanceId") as string
		const include = formData.get("include") as string
		if (!instanceId) throw new Response("Mangler instanceId", { status: 400 })
		await setIncludeInReport(appId, instanceId, include === "true")
	} else if (intent === "fetchEvidence") {
		const instanceId = formData.get("instanceId") as string
		if (!instanceId) throw new Response("Mangler instanceId", { status: 400 })
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
		const { linkPersistenceToOracleInstance } = await import("~/db/queries/nais.server")
		await linkPersistenceToOracleInstance(persistenceId, oracleInstanceId)
	} else {
		throw new Response("Ugyldig handling", { status: 400 })
	}

	return redirect(`${appBase}/rediger`)
}
