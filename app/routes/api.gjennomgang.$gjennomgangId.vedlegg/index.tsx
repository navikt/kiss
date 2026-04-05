import type { ActionFunctionArgs } from "react-router"
import { saveBucketObject } from "~/db/queries/buckets.server"
import { addReviewAttachment, getReview } from "~/db/queries/routines.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { getStorageProvider } from "~/lib/storage/index.server"

const MAX_SIZE_BYTES = 50 * 1024 * 1024

export async function action({ request, params }: ActionFunctionArgs) {
	const { gjennomgangId } = params
	if (!gjennomgangId) {
		return Response.json({ success: false, error: "Mangler gjennomgang-ID" }, { status: 400 })
	}

	if (request.method !== "POST") {
		return Response.json({ success: false, error: "Ugyldig metode" }, { status: 405 })
	}

	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)

	const review = await getReview(gjennomgangId)
	if (!review) {
		return Response.json({ success: false, error: "Fant ikke gjennomgang" }, { status: 404 })
	}
	if (review.status === "completed") {
		return Response.json(
			{ success: false, error: "Kan ikke laste opp vedlegg til en fullført gjennomgang." },
			{ status: 400 },
		)
	}

	const formData = await request.formData()
	const file = formData.get("file")

	if (!file || !(file instanceof File) || file.size === 0) {
		return Response.json({ success: false, error: "Ingen fil mottatt." }, { status: 400 })
	}

	if (file.size > MAX_SIZE_BYTES) {
		return Response.json({ success: false, error: "Filen er for stor. Maks 50 MB." }, { status: 400 })
	}

	try {
		const arrayBuffer = await file.arrayBuffer()
		const buffer = Buffer.from(arrayBuffer)
		const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
		const bucketPath = `routines/${review.routineId}/reviews/${gjennomgangId}/${Date.now()}-${sanitizedName}`
		const contentType = file.type || "application/octet-stream"

		const storage = getStorageProvider()
		const uploadResult = await storage.upload(bucketPath, buffer, { contentType })

		const bucketName = process.env.GCS_BUCKET_NAME ?? "kiss-data-local"
		await saveBucketObject({
			bucketName,
			objectPath: uploadResult.path,
			contentType: uploadResult.contentType,
			sizeBytes: uploadResult.sizeBytes,
			objectType: "routine-review-attachment",
			uploadedBy: authedUser.navIdent,
			metadata: { originalFileName: file.name, reviewId: gjennomgangId },
		})

		await addReviewAttachment({
			reviewId: gjennomgangId,
			fileName: file.name,
			bucketPath: uploadResult.path,
			contentType: uploadResult.contentType,
			sizeBytes: uploadResult.sizeBytes,
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
