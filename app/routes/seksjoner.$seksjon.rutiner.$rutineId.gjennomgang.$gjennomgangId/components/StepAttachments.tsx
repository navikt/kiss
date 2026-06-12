import { DownloadIcon, ExternalLinkIcon } from "@navikt/aksel-icons"
import type { FileObject } from "@navikt/ds-react"
import { Alert, BodyShort, Box, Button, Heading, HStack, Table, Tag, VStack } from "@navikt/ds-react"
import { useState } from "react"
import { useRevalidator } from "react-router"
import { AutoUploadDropzone } from "~/components/AutoUploadDropzone"

const MAX_SIZE_MB = 50
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024

function formatFileSize(bytes: number | null) {
	if (!bytes) return "—"
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(dateStr: string) {
	return new Date(dateStr).toLocaleDateString("nb-NO", {
		day: "numeric",
		month: "long",
		year: "numeric",
	})
}

function AttachmentSourceTag({ sourceType }: { sourceType: string }) {
	if (sourceType === "automated") {
		return (
			<Tag variant="info" size="xsmall">
				Hentet automatisk
			</Tag>
		)
	}
	if (sourceType === "manual") {
		return (
			<Tag variant="neutral" size="xsmall">
				Lastet opp manuelt
			</Tag>
		)
	}
	return (
		<Tag variant="neutral" size="xsmall">
			Ukjent
		</Tag>
	)
}

type Attachment = {
	id: string
	fileName: string
	contentType: string
	sizeBytes: number | null
	sourceType: string
	uploadedBy: string
	uploadedAt: string
}

type Props = {
	reviewId: string
	attachments: Attachment[]
	isDraft: boolean
	activityStepId?: string
}

export function StepAttachments({ reviewId, attachments, isDraft, activityStepId }: Props) {
	return (
		<VStack gap="space-4">
			<Heading size="small" level="4">
				Vedlegg
			</Heading>

			{attachments.length > 0 ? (
				/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
				<section className="table-scroll" tabIndex={0} aria-label="Vedlegg">
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Filnavn</Table.HeaderCell>
								<Table.HeaderCell scope="col">Type</Table.HeaderCell>
								<Table.HeaderCell scope="col">Størrelse</Table.HeaderCell>
								<Table.HeaderCell scope="col">Kilde</Table.HeaderCell>
								<Table.HeaderCell scope="col">Lastet opp av</Table.HeaderCell>
								<Table.HeaderCell scope="col">Dato</Table.HeaderCell>
								<Table.HeaderCell scope="col" />
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{attachments.map((a) => (
								<Table.Row key={a.id}>
									<Table.DataCell>{a.fileName}</Table.DataCell>
									<Table.DataCell>{a.contentType}</Table.DataCell>
									<Table.DataCell>{formatFileSize(a.sizeBytes)}</Table.DataCell>
									<Table.DataCell>
										<AttachmentSourceTag sourceType={a.sourceType} />
									</Table.DataCell>
									<Table.DataCell>{a.uploadedBy}</Table.DataCell>
									<Table.DataCell>{formatDate(a.uploadedAt)}</Table.DataCell>
									<Table.DataCell>
										<HStack gap="space-2">
											<Button
												as="a"
												href={`/api/rutine-vedlegg/${a.id}`}
												target="_blank"
												rel="noopener noreferrer"
												variant="tertiary"
												size="xsmall"
												icon={<ExternalLinkIcon aria-hidden />}
											>
												Åpne
											</Button>
											<Button
												as="a"
												href={`/api/rutine-vedlegg/${a.id}?download=true`}
												download={a.fileName}
												variant="tertiary"
												size="xsmall"
												icon={<DownloadIcon aria-hidden />}
											>
												Last ned
											</Button>
										</HStack>
									</Table.DataCell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				</section>
			) : (
				<Box padding="space-6" borderRadius="8" background="sunken">
					<BodyShort>Ingen vedlegg er lagt til denne gjennomgangen.</BodyShort>
				</Box>
			)}

			{isDraft && <UploadSection reviewId={reviewId} activityStepId={activityStepId} />}
		</VStack>
	)
}

function UploadSection({ reviewId, activityStepId }: { reviewId: string; activityStepId?: string }) {
	const revalidator = useRevalidator()
	const [files, setFiles] = useState<FileObject[]>([])
	const [uploading, setUploading] = useState(false)
	const [uploadResult, setUploadResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null)

	async function uploadFile(file: File) {
		setUploading(true)
		setUploadResult(null)

		try {
			const formData = new FormData()
			formData.append("file", file)
			if (activityStepId) formData.append("activityStepId", activityStepId)

			const response = await fetch(`/api/gjennomgang/${reviewId}/vedlegg`, {
				method: "POST",
				body: formData,
			})

			if (response.status === 413) {
				setUploadResult({
					success: false,
					error: `Filen er for stor. Maksimal filstørrelse er ${MAX_SIZE_MB} MB.`,
				})
				return
			}

			const result = await response.json()
			setUploadResult(result)

			if (result.success) {
				revalidator.revalidate()
			}
		} catch {
			setUploadResult({ success: false, error: "Nettverksfeil ved opplasting." })
		} finally {
			setFiles([])
			setUploading(false)
		}
	}

	function handleFileSelect(newFiles: FileObject[]) {
		if (uploading && newFiles.length > 0) return
		setFiles(newFiles)
		const accepted = newFiles.find((f) => !f.error)
		if (accepted) {
			uploadFile(accepted.file)
		}
	}

	return (
		<VStack gap="space-4">
			<Heading size="small" level="4">
				Last opp vedlegg
			</Heading>

			{uploadResult?.error && (
				<Alert variant="error" size="small">
					{uploadResult.error}
				</Alert>
			)}
			{uploadResult?.success && (
				<Alert variant="success" size="small">
					{uploadResult.message}
				</Alert>
			)}

			<AutoUploadDropzone
				label="Dra og slipp fil, eller klikk for å velge"
				description={`Maks ${MAX_SIZE_MB} MB. Støttede formater: PDF, DOCX, XLSX, PPTX, PNG, JPG, TXT, MD, CSV`}
				accept=".pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.txt,.md,.csv"
				maxSizeInBytes={MAX_SIZE_BYTES}
				files={files}
				onFilesChange={handleFileSelect}
				isUploading={uploading}
				rejectionErrors={{
					fileType: "Filtypen er ikke støttet",
					fileSize: `Filen er for stor (maks ${MAX_SIZE_MB} MB)`,
				}}
			/>
		</VStack>
	)
}
