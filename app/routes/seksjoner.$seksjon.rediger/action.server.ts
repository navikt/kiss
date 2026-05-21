import type { ActionFunctionArgs } from "react-router"
import { redirect } from "react-router"
import { linkAppToTeam } from "~/db/queries/applications.server"
import {
	excludeEnvironment,
	includeEnvironment,
	linkNaisTeamToSection,
	unignoreAppForSection,
	unlinkNaisTeamFromSection,
} from "~/db/queries/nais.server"
import { createTeam, getSectionDetail, updateSection } from "~/db/queries/sections.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"

function redirectToTab(seksjon: string, tab: string) {
	return redirect(`/seksjoner/${seksjon}/rediger?fane=${tab}`)
}

export async function action({ request, params }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })

	const result = await getSectionDetail(seksjon)
	if (!result) throw new Response("Seksjon ikke funnet", { status: 404 })

	const formData = await request.formData()
	const intent = formData.get("intent") as string
	const userId = authedUser.navIdent

	if (intent === "update-section") {
		const name = (formData.get("name") as string)?.trim()
		const description = (formData.get("description") as string)?.trim() || null
		if (!name) throw new Response("Navn er påkrevd", { status: 400 })
		const updated = await updateSection(result.section.id, name, description, userId)
		return redirectToTab(updated.slug, "seksjon")
	}

	if (intent === "create-team") {
		const name = (formData.get("name") as string)?.trim()
		const description = (formData.get("description") as string)?.trim() || null
		if (!name) throw new Response("Teamnavn er påkrevd", { status: 400 })
		await createTeam(result.section.id, name, description, userId)
		return redirectToTab(seksjon, "team")
	}

	if (intent === "link-nais-team") {
		const naisTeamSlug = formData.get("naisTeamSlug") as string
		if (!naisTeamSlug) throw new Response("Mangler Nais-team", { status: 400 })
		await linkNaisTeamToSection(naisTeamSlug, result.section.id, userId)
		return redirectToTab(seksjon, "nais")
	}

	if (intent === "unlink-nais-team") {
		const naisTeamSlug = formData.get("naisTeamSlug") as string
		if (!naisTeamSlug) throw new Response("Mangler Nais-team", { status: 400 })
		await unlinkNaisTeamFromSection(naisTeamSlug, userId)
		return redirectToTab(seksjon, "nais")
	}

	if (intent === "link-team") {
		const applicationId = formData.get("applicationId") as string
		const devTeamId = formData.get("devTeamId") as string
		if (!applicationId || !devTeamId) throw new Response("Velg et team.", { status: 400 })
		await linkAppToTeam(applicationId, devTeamId, userId)
		return redirectToTab(seksjon, "alle-applikasjoner")
	}

	if (intent === "unignore-app") {
		const applicationId = formData.get("applicationId") as string
		if (!applicationId) throw new Response("Mangler applikasjon", { status: 400 })
		await unignoreAppForSection(result.section.id, applicationId, userId)
		return redirectToTab(seksjon, "alle-applikasjoner")
	}

	if (intent === "toggle-environment") {
		const cluster = formData.get("cluster") as string
		const enabled = formData.get("enabled") === "true"
		if (!cluster) throw new Response("Mangler cluster", { status: 400 })
		if (enabled) {
			await includeEnvironment(result.section.id, cluster, userId)
		} else {
			await excludeEnvironment(result.section.id, cluster, userId)
		}
		return redirectToTab(seksjon, "nais")
	}

	throw new Response("Ugyldig handling", { status: 400 })
}
