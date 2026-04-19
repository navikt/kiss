import { UploadIcon } from "@navikt/aksel-icons"
import type { FileObject, FileRejected, FileRejectionReason } from "@navikt/ds-react"
import { Alert, Button, FileUpload, Heading, HStack, VStack } from "@navikt/ds-react"
import { useState } from "react"
import { useRevalidator } from "react-router"
import { MAX_SIZE_BYTES, MAX_SIZE_MB, rejectionErrors } from "../shared"

export function UploadSection({ reviewId }: { reviewId: string }) {
	const revalidator = useRevalidator()
	const [files, setFiles] = useState<FileObject[]>([])
	const [uploading, setUploading] = useState(false)
	const [uploadResult, setUploadResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null)

	const acceptedFiles = files.filter((f): f is Extract<FileObject, { error: false }> => !f.error)
	const rejectedFiles = files.filter((f): f is FileRejected => f.error)

	async function handleUpload() {
		const selectedFile = acceptedFiles.length > 0 ? acceptedFiles[0].file : null
		if (!selectedFile) return

		setUploading(true)
		setUploadResult(null)

		try {
			const formData = new FormData()
			formData.append("file", selectedFile)

			const response = await fetch(`/api/gjennomgang/${reviewId}/vedlegg`, {
				method: "POST",
				body: formData,
			})

			const result = await response.json()
			setUploadResult(result)

			if (result.success) {
				setFiles([])
				revalidator.revalidate()
			}
		} catch {
			setUploadResult({ success: false, error: "Nettverksfeil ved opplasting." })
		} finally {
			setUploading(false)
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

			<FileUpload.Dropzone
				label="Velg PDF-fil eller dra og slipp"
				description={`Maks ${MAX_SIZE_MB} MB. Kun PDF-filer.`}
				accept=".pdf,application/pdf"
				maxSizeInBytes={MAX_SIZE_BYTES}
				onSelect={setFiles}
				multiple={false}
				fileLimit={{ max: 1, current: acceptedFiles.length }}
			/>

			{acceptedFiles.length > 0 && (
				<VStack gap="space-2">
					{acceptedFiles.map((file) => (
						<FileUpload.Item
							key={file.file.name}
							file={file.file}
							button={{ action: "delete", onClick: () => setFiles([]) }}
							status={uploading ? "uploading" : "idle"}
						/>
					))}
				</VStack>
			)}

			{rejectedFiles.length > 0 && (
				<VStack gap="space-2">
					{rejectedFiles.map((rejected) => (
						<FileUpload.Item
							key={rejected.file.name}
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

			{acceptedFiles.length > 0 && (
				<HStack>
					<Button
						type="button"
						variant="primary"
						size="small"
						onClick={handleUpload}
						loading={uploading}
						icon={<UploadIcon aria-hidden />}
					>
						Last opp
					</Button>
				</HStack>
			)}
		</VStack>
	)
}
