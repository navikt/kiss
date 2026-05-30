import type { FileObject } from "@navikt/ds-react"
import {
	Alert,
	BodyLong,
	Button,
	CopyButton,
	Heading,
	HStack,
	Table,
	Tag,
	Textarea,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { useEffect, useRef, useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, useActionData, useLoaderData, useNavigation, useSubmit } from "react-router"
import { AutoUploadDropzone } from "~/components/AutoUploadDropzone"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { saveBucketObject } from "~/db/queries/buckets.server"
import { archiveDocument, createDocument, getAllDocuments, unarchiveDocument } from "~/db/queries/documents.server"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { getStorageProvider } from "~/lib/storage/index.server"

export { RouteErrorBoundary as ErrorBoundary }

interface DocumentRow {
	id: string
	title: string
	originalFileName: string
	contentType: string
	sizeBytes: number
	uploadedAt: string
	description: string | null
	archivedAt: string | null
	archivedBy: string | null
}

type ActionResult = { success: true; message: string } | { success: false; error: string }

export async function loader({ request }: LoaderFunctionArgs) {
	await requireAuthenticatedUser(request)
	const docs = await getAllDocuments({ includeArchived: true })

	return data({
		documents: docs.map((d) => ({
			...d,
			uploadedAt: d.uploadedAt.toISOString(),
			archivedAt: d.archivedAt ? d.archivedAt.toISOString() : null,
		})),
	})
}

const MAX_SIZE_MB = 50
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024

export async function action({ request }: ActionFunctionArgs) {
	const user = await requireAuthenticatedUser(request)
	const formData = await request.formData()
	const intent = formData.get("intent")

	if (intent === "archive") {
		const documentId = formData.get("documentId")
		if (typeof documentId !== "string") {
			return data<ActionResult>({ success: false, error: "Mangler dokument-ID." })
		}

		const archived = await archiveDocument(documentId, user.navIdent)
		if (!archived) {
			return data<ActionResult>({ success: false, error: "Dokumentet ble ikke funnet." })
		}

		return data<ActionResult>({ success: true, message: "Dokumentet ble arkivert." })
	}

	if (intent === "unarchive") {
		const documentId = formData.get("documentId")
		if (typeof documentId !== "string") {
			return data<ActionResult>({ success: false, error: "Mangler dokument-ID." })
		}

		const unarchived = await unarchiveDocument(documentId, user.navIdent)
		if (!unarchived) {
			return data<ActionResult>({ success: false, error: "Dokumentet ble ikke funnet." })
		}

		return data<ActionResult>({ success: true, message: "Dokumentet ble reaktivert." })
	}

	const file = formData.get("file")
	const title = formData.get("title")
	const description = formData.get("description")

	if (!file || !(file instanceof File) || file.size === 0) {
		return data<ActionResult>({ success: false, error: "Ingen fil valgt." })
	}

	if (typeof title !== "string" || title.trim().length === 0) {
		return data<ActionResult>({ success: false, error: "Tittel er påkrevd." })
	}

	if (file.size > MAX_SIZE_BYTES) {
		return data<ActionResult>({ success: false, error: "Filen er for stor. Maks 50 MB." })
	}

	try {
		const arrayBuffer = await file.arrayBuffer()
		const buffer = Buffer.from(arrayBuffer)

		const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
		const bucketPath = `documents/${Date.now()}-${sanitizedName}`
		const contentType = file.type || "application/octet-stream"

		const storage = getStorageProvider()
		const uploadResult = await storage.upload(bucketPath, buffer, { contentType })

		const bucketName = process.env.GCS_BUCKET_NAME ?? "kiss-data-local"
		await saveBucketObject({
			bucketName,
			objectPath: uploadResult.path,
			contentType: uploadResult.contentType,
			sizeBytes: uploadResult.sizeBytes,
			objectType: "document",
			uploadedBy: user.navIdent,
			metadata: { originalFileName: file.name },
		})

		await createDocument({
			title: title.trim(),
			description: typeof description === "string" && description.trim() ? description.trim() : undefined,
			originalFileName: file.name,
			contentType,
			sizeBytes: file.size,
			bucketPath: uploadResult.path,
			uploadedBy: user.navIdent,
		})

		return data<ActionResult>({ success: true, message: "Dokumentet ble lastet opp." })
	} catch (err) {
		return data<ActionResult>({
			success: false,
			error: err instanceof Error ? err.message : "Ukjent feil ved opplasting.",
		})
	}
}

function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getFileTypeLabel(contentType: string): string {
	if (contentType === "application/pdf") return "PDF"
	if (contentType.includes("word") || contentType.includes(".document")) return "DOCX"
	if (contentType.includes("spreadsheet") || contentType.includes("excel")) return "XLSX"
	if (contentType.includes("presentation") || contentType.includes("powerpoint")) return "PPTX"
	if (contentType.startsWith("image/")) return "Bilde"
	if (contentType.startsWith("text/")) return "Tekst"
	return "Annet"
}

function getFileTypeVariant(contentType: string): "info" | "alt1" | "alt2" | "neutral" {
	if (contentType === "application/pdf") return "info"
	if (
		contentType.includes("word") ||
		contentType.includes("spreadsheet") ||
		contentType.includes("presentation") ||
		contentType.includes("excel") ||
		contentType.includes("powerpoint") ||
		contentType.includes(".document")
	) {
		return "alt1"
	}
	if (contentType.startsWith("image/")) return "alt2"
	return "neutral"
}

export default function Dokumenter() {
	const { documents } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const navigation = useNavigation()
	const submit = useSubmit()
	const isSubmitting = navigation.state === "submitting"

	const [files, setFiles] = useState<FileObject[]>([])
	const [title, setTitle] = useState("")
	const [description, setDescription] = useState("")
	const [titleMissing, setTitleMissing] = useState(false)

	const acceptedFiles = files.filter((f): f is Extract<FileObject, { error: false }> => !f.error)

	// Clear form state after successful upload
	const prevActionData = useRef(actionData)
	useEffect(() => {
		if (actionData !== prevActionData.current && actionData && "success" in actionData && actionData.success) {
			setFiles([])
			setTitle("")
			setDescription("")
			setTitleMissing(false)
		}
		prevActionData.current = actionData
	}, [actionData])

	function doUpload(file: File) {
		const formData = new FormData()
		formData.set("file", file)
		formData.set("title", title)
		if (description.trim()) formData.set("description", description)

		submit(formData, { method: "post", encType: "multipart/form-data" })
	}

	function handleFileSelect(newFiles: FileObject[]) {
		if (isSubmitting && newFiles.length > 0) return
		setFiles(newFiles)
		const accepted = newFiles.find((f) => !f.error)
		if (accepted) {
			if (title.trim()) {
				doUpload(accepted.file)
			} else {
				setTitleMissing(true)
			}
		}
	}

	function handleTitleUpload() {
		const selectedFile = acceptedFiles.length > 0 ? acceptedFiles[0].file : null
		if (!selectedFile || !title.trim()) return
		doUpload(selectedFile)
	}

	function handleArchive(documentId: string) {
		const formData = new FormData()
		formData.set("intent", "archive")
		formData.set("documentId", documentId)
		submit(formData, { method: "post" })
	}

	function handleUnarchive(documentId: string) {
		const formData = new FormData()
		formData.set("intent", "unarchive")
		formData.set("documentId", documentId)
		submit(formData, { method: "post" })
	}

	return (
		<VStack gap="space-8">
			<VStack gap="space-4">
				<Heading size="xlarge" level="2">
					Dokumentbibliotek
				</Heading>
				<BodyLong>
					Last opp dokumenter som kan lenkes til fra compliance-vurderinger. Kopier lenken og lim den inn i en kommentar
					— den blir automatisk klikkbar.
				</BodyLong>
			</VStack>

			{actionData && "success" in actionData && actionData.success && (
				<Alert variant="success">{"message" in actionData ? actionData.message : "Utført."}</Alert>
			)}
			{actionData && "success" in actionData && !actionData.success && (
				<Alert variant="error">{"error" in actionData ? actionData.error : "Noe gikk galt."}</Alert>
			)}

			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Last opp nytt dokument
				</Heading>

				<TextField
					label="Tittel"
					description="Gi dokumentet et beskrivende navn"
					value={title}
					onChange={(e) => {
						setTitle(e.target.value)
						if (e.target.value.trim()) setTitleMissing(false)
					}}
					size="medium"
					error={titleMissing ? "Fyll inn tittel før opplasting" : undefined}
				/>

				<Textarea
					label="Beskrivelse (valgfritt)"
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					size="medium"
					minRows={2}
				/>

				<AutoUploadDropzone
					label="Dra og slipp fil, eller klikk for å velge"
					description={`Maks ${MAX_SIZE_MB} MB. Støttede formater: PDF, DOCX, XLSX, PPTX, PNG, JPG, TXT, MD`}
					accept=".pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.txt,.md"
					maxSizeInBytes={MAX_SIZE_BYTES}
					files={files}
					onFilesChange={handleFileSelect}
					isUploading={isSubmitting}
					onFilesClear={() => setTitleMissing(false)}
					rejectionErrors={{
						fileType: "Filtypen støttes ikke.",
						fileSize: `Filen er over ${MAX_SIZE_MB} MB.`,
					}}
				/>

				{acceptedFiles.length > 0 && title.trim() && (
					<HStack gap="space-4">
						<Button
							type="button"
							variant="primary"
							onClick={handleTitleUpload}
							disabled={isSubmitting}
							loading={isSubmitting}
						>
							Last opp
						</Button>
					</HStack>
				)}
			</VStack>

			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Dokumenter ({documents.length})
				</Heading>

				{documents.length === 0 ? (
					<BodyLong>Ingen dokumenter er lastet opp ennå.</BodyLong>
				) : (
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell>Tittel</Table.HeaderCell>
								<Table.HeaderCell>Filnavn</Table.HeaderCell>
								<Table.HeaderCell>Type</Table.HeaderCell>
								<Table.HeaderCell>Størrelse</Table.HeaderCell>
								<Table.HeaderCell>Lastet opp</Table.HeaderCell>
								<Table.HeaderCell>Status</Table.HeaderCell>
								<Table.HeaderCell>Lenke</Table.HeaderCell>
								<Table.HeaderCell>Handling</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{(documents as DocumentRow[]).map((doc) => {
								const docUrl = `/api/dokumenter/${doc.id}`
								const isArchived = doc.archivedAt !== null
								return (
									<Table.Row key={doc.id}>
										<Table.DataCell>
											{doc.title}
											{doc.description && (
												<BodyLong size="small" className="text-subtle">
													{doc.description}
												</BodyLong>
											)}
										</Table.DataCell>
										<Table.DataCell>{doc.originalFileName}</Table.DataCell>
										<Table.DataCell>
											<Tag variant={getFileTypeVariant(doc.contentType)} size="xsmall">
												{getFileTypeLabel(doc.contentType)}
											</Tag>
										</Table.DataCell>
										<Table.DataCell>{formatFileSize(doc.sizeBytes)}</Table.DataCell>
										<Table.DataCell>{new Date(doc.uploadedAt).toLocaleDateString("nb-NO")}</Table.DataCell>
										<Table.DataCell>
											{isArchived ? (
												<Tag variant="neutral" size="xsmall">
													Arkivert
												</Tag>
											) : (
												<Tag variant="success" size="xsmall">
													Aktiv
												</Tag>
											)}
										</Table.DataCell>
										<Table.DataCell>
											<CopyButton copyText={docUrl} text="Kopier" size="xsmall" />
										</Table.DataCell>
										<Table.DataCell>
											{isArchived ? (
												<Button
													type="button"
													variant="secondary"
													size="xsmall"
													onClick={() => {
														if (window.confirm(`Reaktiver «${doc.title}»?`)) handleUnarchive(doc.id)
													}}
													disabled={isSubmitting}
												>
													Reaktiver
												</Button>
											) : (
												<Button
													type="button"
													variant="danger"
													size="xsmall"
													onClick={() => {
														if (
															window.confirm(
																`Arkiver «${doc.title}»? Filen bevares og lenken vil fortsatt fungere, men dokumentet skjules fra aktive lister.`,
															)
														)
															handleArchive(doc.id)
													}}
													disabled={isSubmitting}
												>
													Arkiver
												</Button>
											)}
										</Table.DataCell>
									</Table.Row>
								)
							})}
						</Table.Body>
					</Table>
				)}
			</VStack>
		</VStack>
	)
}
