import type { ActionFunctionArgs } from "react-router"
import { getFollowUpPointAttachmentContext } from "~/db/queries/routines.server"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import {
	FOLLOW_UP_POINT_ATTACHMENT_MAX_SIZE_BYTES,
	storeFollowUpPointAttachment,
} from "~/lib/follow-up-point-attachments.server"

export async function action({ request, params }: ActionFunctionArgs) {
	const { pointId } = params
	if (!pointId) {
		return Response.json({ success: false, error: "Mangler oppfølgingspunkt-ID" }, { status: 400 })
	}

	if (request.method !== "POST") {
		return Response.json({ success: false, error: "Ugyldig metode" }, { status: 405 })
	}

	const authedUser = await requireAuthenticatedUser(request)

	const ctx = await getFollowUpPointAttachmentContext(pointId)
	if (!ctx) {
		return Response.json({ success: false, error: "Fant ikke oppfølgingspunkt" }, { status: 404 })
	}

	if (ctx.routineArchivedAt) {
		return Response.json(
			{
				success: false,
				error: "Kan ikke laste opp vedlegg på en arkivert rutine. Reaktiver rutinen først.",
			},
			{ status: 403 },
		)
	}

	if (ctx.reviewStatus === "discarded") {
		return Response.json(
			{ success: false, error: "Kan ikke laste opp vedlegg på en kassert gjennomgang." },
			{ status: 409 },
		)
	}

	const formData = await request.formData()
	const file = formData.get("file")
	const kindRaw = (formData.get("kind") as string | null)?.trim() ?? "resolution"
	if (kindRaw !== "description" && kindRaw !== "resolution") {
		return Response.json({ success: false, error: "Ugyldig vedleggstype." }, { status: 400 })
	}
	const kind = kindRaw

	if (kind === "description" && ctx.reviewStatus !== "draft") {
		return Response.json(
			{ success: false, error: "Beskrivelse-vedlegg kan kun lastes opp mens gjennomgangen er utkast." },
			{ status: 409 },
		)
	}

	if (kind === "resolution" && ctx.reviewStatus !== "draft" && ctx.reviewStatus !== "needs_follow_up") {
		return Response.json(
			{
				success: false,
				error:
					"Vedlegg på oppfølging kan kun lastes opp mens gjennomgangen er utkast eller har punkter som må følges opp.",
			},
			{ status: 409 },
		)
	}

	if (!file || !(file instanceof File) || file.size === 0) {
		return Response.json({ success: false, error: "Ingen fil mottatt." }, { status: 400 })
	}

	if (file.size > FOLLOW_UP_POINT_ATTACHMENT_MAX_SIZE_BYTES) {
		return Response.json({ success: false, error: "Filen er for stor. Maks 50 MB." }, { status: 413 })
	}

	try {
		await storeFollowUpPointAttachment({
			file,
			pointId,
			routineId: ctx.routineId,
			reviewId: ctx.reviewId,
			kind,
			uploadedBy: authedUser.navIdent,
		})

		return Response.json({
			success: true,
			message: `Vedlegg "${file.name}" ble lastet opp.`,
		})
	} catch (err) {
		return Response.json(
			{ success: false, error: err instanceof Error ? err.message : "Ukjent feil ved opplasting." },
			{ status: 500 },
		)
	}
}
