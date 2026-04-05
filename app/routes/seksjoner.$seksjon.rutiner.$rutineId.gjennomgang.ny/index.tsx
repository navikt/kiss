import type { FileObject, FileRejected, FileRejectionReason } from "@navikt/ds-react"
import {
	Alert,
	Button,
	FileUpload,
	Heading,
	HStack,
	Label,
	Select,
	Textarea,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Link, redirect, useActionData, useLoaderData, useNavigation, useRevalidator } from "react-router"
import { MarkdownHint } from "~/components/MarkdownHint"
import { MarkdownPreview } from "~/components/MarkdownPreview"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { saveBucketObject } from "~/db/queries/buckets.server"
import { addReviewAttachment, createReview, getAppsRequiringRoutine, getRoutine } from "~/db/queries/routines.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { getStorageProvider } from "~/lib/storage/index.server"

const MAX_SIZE_MB = 50
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024

type ActionResult = { success: true } | { success: false; error: string }

export async function loader({ params }: LoaderFunctionArgs) {
	const { seksjon, rutineId } = params
	if (!seksjon || !rutineId) {
		throw data({ message: "Mangler parametere" }, { status: 400 })
	}

	const section = await getSectionBySlug(seksjon)
	if (!section) {
		throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })
	}

	const routine = await getRoutine(rutineId)
	if (!routine) {
		throw data({ message: `Fant ikke rutine: ${rutineId}` }, { status: 404 })
	}

	const apps = await getAppsRequiringRoutine(rutineId)

	return data({
		section,
		routine,
		apps,
	})
}

export async function action({ request, params }: ActionFunctionArgs) {
	const { seksjon, rutineId } = params
	if (!seksjon || !rutineId) {
		throw data({ message: "Mangler parametere" }, { status: 400 })
	}

	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)

	const formData = await request.formData()
	const title = (formData.get("title") as string)?.trim()
	const applicationId = (formData.get("applicationId") as string) || null
	const reviewedAt = formData.get("reviewedAt") as string
	const reviewedTime = (formData.get("reviewedTime") as string) || "00:00"
	const summary = (formData.get("summary") as string)?.trim() || null
	const participantsRaw = (formData.get("participants") as string)?.trim() || ""

	if (!title) {
		return data<ActionResult>({ success: false, error: "Tittel er påkrevd" })
	}

	const participants = participantsRaw
		.split(",")
		.map((ident) => ident.trim())
		.filter(Boolean)
		.map((ident) => ({ userIdent: ident, userName: ident }))

	const review = await createReview({
		routineId: rutineId,
		applicationId,
		title,
		summary,
		routineSnapshotPath: null,
		reviewedAt: reviewedAt ? new Date(`${reviewedAt}T${reviewedTime}`) : new Date(),
		createdBy: authedUser.navIdent,
		participants,
	})

	// Handle file attachments
	const files = formData.getAll("attachments")
	const storage = getStorageProvider()
	const bucketName = process.env.GCS_BUCKET_NAME ?? "kiss-data-local"

	for (const file of files) {
		if (!(file instanceof File) || file.size === 0) continue
		if (file.size > MAX_SIZE_BYTES) continue

		const arrayBuffer = await file.arrayBuffer()
		const buffer = Buffer.from(arrayBuffer)
		const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
		const bucketPath = `routine-reviews/${review.id}/${Date.now()}-${sanitizedName}`
		const contentType = file.type || "application/octet-stream"

		const uploadResult = await storage.upload(bucketPath, buffer, { contentType })

		await saveBucketObject({
			bucketName,
			objectPath: uploadResult.path,
			contentType: uploadResult.contentType,
			sizeBytes: uploadResult.sizeBytes,
			objectType: "routine_review_attachment",
			uploadedBy: authedUser.navIdent,
			metadata: { reviewId: review.id, originalFileName: file.name },
		})

		await addReviewAttachment({
			reviewId: review.id,
			fileName: file.name,
			bucketPath: uploadResult.path,
			contentType,
			sizeBytes: file.size,
			uploadedBy: authedUser.navIdent,
		})
	}

	return redirect(`/seksjoner/${seksjon}/rutiner/${rutineId}`)
}

const rejectionErrors: Record<FileRejectionReason, string> = {
	fileType: "Filtypen støttes ikke",
	fileSize: `Filen er for stor (maks ${MAX_SIZE_MB} MB)`,
}

export default function NyGjennomgang() {
	const { routine, apps } = useLoaderData<typeof loader>()
	const actionData = useActionData<ActionResult>()
	const navigation = useNavigation()
	const revalidator = useRevalidator()
	const today = new Date().toISOString().split("T")[0]
	const defaultTitle = `${routine.name} — ${new Date().toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" })}`

	const [files, setFiles] = useState<(FileObject | FileRejected)[]>([])
	const [summaryPreview, setSummaryPreview] = useState("")
	const [submitting, setSubmitting] = useState(false)
	const acceptedFiles = files.filter((f) => !("reasons" in f)) as FileObject[]
	const rejectedFiles = files.filter((f) => "reasons" in f) as FileRejected[]
	const isSubmitting = submitting || navigation.state === "submitting"

	async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault()
		const form = event.currentTarget
		const formData = new FormData(form)
		const action = form.action || window.location.href
		for (const accepted of acceptedFiles) {
			formData.append("attachments", accepted.file)
		}
		setSubmitting(true)
		try {
			const response = await fetch(action, {
				method: "POST",
				body: formData,
			})
			if (response.redirected) {
				window.location.href = response.url
			} else {
				revalidator.revalidate()
			}
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<VStack gap="space-8">
			<div>
				<Link to="../..">← Tilbake til {routine.name}</Link>
				<Heading size="xlarge" level="2" spacing>
					Ny gjennomgang — {routine.name}
				</Heading>
			</div>

			{actionData && !actionData.success && <Alert variant="error">{actionData.error}</Alert>}

			<form method="post" onSubmit={handleSubmit}>
				<VStack gap="space-6">
					<TextField label="Tittel" name="title" size="small" autoComplete="off" defaultValue={defaultTitle} />

					<Select label="Applikasjon" name="applicationId" size="small">
						<option value="">Generell (ikke applikasjonsspesifikk)</option>
						{apps.map((app) => (
							<option key={app.id} value={app.id}>
								{app.name}
							</option>
						))}
					</Select>

					<HStack gap="space-6" align="end">
						<div>
							<Label size="small" htmlFor="reviewedAt">
								Dato for gjennomgang
							</Label>
							<input
								type="date"
								id="reviewedAt"
								name="reviewedAt"
								defaultValue={today}
								className="navds-text-field__input navds-body-short navds-body-short--small"
							/>
						</div>
						<div>
							<Label size="small" htmlFor="reviewedTime">
								Tidspunkt
							</Label>
							<input
								type="time"
								id="reviewedTime"
								name="reviewedTime"
								defaultValue={new Date().toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" })}
								className="navds-text-field__input navds-body-short navds-body-short--small"
							/>
						</div>
					</HStack>

					<HStack gap="space-8" align="start" style={{ flexWrap: "wrap" }}>
						<VStack style={{ flex: 1, minWidth: "20rem" }}>
							<Textarea
								label="Oppsummering/referat"
								name="summary"
								size="small"
								minRows={6}
								onChange={(e) => setSummaryPreview(e.target.value)}
							/>
						</VStack>
						<VStack style={{ flex: 1, minWidth: "20rem", alignSelf: "stretch" }}>
							<Label size="small" spacing>
								Forhåndsvisning
							</Label>
							<MarkdownPreview content={summaryPreview} />
						</VStack>
					</HStack>
					<MarkdownHint />

					<TextField
						label="Deltakere"
						name="participants"
						size="small"
						description="Kommaseparert liste med NAV-identer"
						autoComplete="off"
					/>

					<VStack gap="space-2">
						<FileUpload.Dropzone
							label="Vedlegg"
							description={`Last opp dokumentasjon (PDF, DOCX, XLSX o.l.). Maks ${MAX_SIZE_MB} MB per fil.`}
							accept=".pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.txt,.md"
							maxSizeInBytes={MAX_SIZE_BYTES}
							onSelect={(newFiles) => setFiles((prev) => [...prev, ...newFiles])}
							multiple
						/>

						{acceptedFiles.length > 0 && (
							<VStack gap="space-2">
								{acceptedFiles.map((file) => (
									<FileUpload.Item
										key={`${file.file.name}-${file.file.size}-${file.file.lastModified}`}
										file={file.file}
										button={{
											action: "delete",
											onClick: () => setFiles(files.filter((f) => f !== file)),
										}}
										status={isSubmitting ? "uploading" : "idle"}
									/>
								))}
							</VStack>
						)}

						{rejectedFiles.length > 0 && (
							<VStack gap="space-2">
								{rejectedFiles.map((rejected) => (
									<FileUpload.Item
										key={`${rejected.file.name}-${rejected.file.size}-${rejected.file.lastModified}`}
										file={rejected.file}
										error={
											rejected.reasons[0] in rejectionErrors
												? rejectionErrors[rejected.reasons[0] as FileRejectionReason]
												: rejected.reasons.join(", ")
										}
										button={{
											action: "delete",
											onClick: () => setFiles(files.filter((f) => f !== rejected)),
										}}
									/>
								))}
							</VStack>
						)}
					</VStack>

					<HStack gap="space-4">
						<Button type="submit" variant="primary" size="small" loading={isSubmitting}>
							Opprett gjennomgang
						</Button>
						<Button as={Link} to="../.." variant="tertiary" size="small">
							Avbryt
						</Button>
					</HStack>
				</VStack>
			</form>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
