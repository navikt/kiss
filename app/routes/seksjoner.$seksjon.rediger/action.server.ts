import { redirect } from "react-router"
import {
	excludeEnvironment,
	linkNaisTeamToSection,
	unlinkNaisTeamFromSection,
	upsertAndIncludeEnvironment,
} from "~/db/queries/nais.server"
import { createTeam, getSectionBySlug, updateSection } from "~/db/queries/sections.server"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { requireSectionAccess } from "~/lib/authorization.server"
import type { Route } from "./+types/index"

function redirectToTab(seksjon: string, tab: string) {
	return redirect(`/seksjoner/${seksjon}/rediger?fane=${tab}`)
}

export async function action({ request, params }: Route.ActionArgs) {
	const authedUser = await requireAuthenticatedUser(request)

	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })

	const section = await getSectionBySlug(seksjon)
	if (!section) throw new Response("Seksjon ikke funnet", { status: 404 })

	requireSectionAccess(authedUser, section.id)

	const formData = await request.formData()
	const intent = formData.get("intent") as string
	const userId = authedUser.navIdent

	if (intent === "update-section") {
		const name = (formData.get("name") as string)?.trim()
		const description = (formData.get("description") as string)?.trim() || null
		if (!name) throw new Response("Navn er påkrevd", { status: 400 })
		const updated = await updateSection(section.id, name, description, userId)
		return redirectToTab(updated.slug, "seksjon")
	}

	if (intent === "create-team") {
		const name = (formData.get("name") as string)?.trim()
		const description = (formData.get("description") as string)?.trim() || null
		if (!name) throw new Response("Teamnavn er påkrevd", { status: 400 })
		await createTeam(section.id, name, description, userId)
		return redirectToTab(seksjon, "team")
	}

	if (intent === "link-nais-team") {
		const naisTeamSlug = formData.get("naisTeamSlug") as string
		if (!naisTeamSlug) throw new Response("Mangler Nais-team", { status: 400 })
		await linkNaisTeamToSection(naisTeamSlug, section.id, userId)
		return redirectToTab(seksjon, "nais")
	}

	if (intent === "unlink-nais-team") {
		const naisTeamSlug = formData.get("naisTeamSlug") as string
		if (!naisTeamSlug) throw new Response("Mangler Nais-team", { status: 400 })
		await unlinkNaisTeamFromSection(naisTeamSlug, userId, section.id)
		return redirectToTab(seksjon, "nais")
	}

	if (intent === "toggle-environment") {
		const cluster = formData.get("cluster") as string
		const enabled = formData.get("enabled") === "true"
		if (!cluster) throw new Response("Mangler cluster", { status: 400 })
		if (enabled) {
			try {
				await upsertAndIncludeEnvironment(section.id, cluster, userId)
			} catch (err) {
				if (err instanceof Error && err.message.startsWith("Ukjent cluster")) {
					throw new Response(err.message, { status: 400 })
				}
				throw err
			}
		} else {
			await excludeEnvironment(section.id, cluster, userId)
		}
		return redirectToTab(seksjon, "nais")
	}

	throw new Response("Ugyldig handling", { status: 400 })
}
