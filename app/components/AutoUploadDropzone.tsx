import type { FileObject, FileRejected, FileRejectionReason } from "@navikt/ds-react"
import { FileUpload, VStack } from "@navikt/ds-react"

const defaultRejectionErrors: Record<FileRejectionReason, string> = {
	fileType: "Filtypen støttes ikke.",
	fileSize: "Filen er for stor.",
}

interface AutoUploadDropzoneProps {
	label: string
	description: string
	accept: string
	maxSizeInBytes: number
	files: FileObject[]
	onFilesChange: (files: FileObject[]) => void
	isUploading: boolean
	rejectionErrors?: Partial<Record<FileRejectionReason, string>>
	/** Called when files are cleared (e.g. delete button clicked). Use for side effects like clearing validation errors. */
	onFilesClear?: () => void
}

export function AutoUploadDropzone({
	label,
	description,
	accept,
	maxSizeInBytes,
	files,
	onFilesChange,
	isUploading,
	rejectionErrors,
	onFilesClear,
}: AutoUploadDropzoneProps) {
	const errors = { ...defaultRejectionErrors, ...rejectionErrors }
	const acceptedFiles = files.filter((f): f is Extract<FileObject, { error: false }> => !f.error)
	const rejectedFiles = files.filter((f): f is FileRejected => f.error)

	function handleClear() {
		onFilesChange([])
		onFilesClear?.()
	}

	return (
		<>
			<FileUpload.Dropzone
				label={label}
				description={description}
				accept={accept}
				maxSizeInBytes={maxSizeInBytes}
				onSelect={onFilesChange}
				multiple={false}
				disabled={isUploading}
				fileLimit={{ max: 1, current: acceptedFiles.length }}
			/>

			{acceptedFiles.length > 0 && (
				<VStack gap="space-2">
					{acceptedFiles.map((file) => (
						<FileUpload.Item
							key={file.file.name}
							file={file.file}
							button={{
								action: "delete",
								onClick: handleClear,
							}}
							status={isUploading ? "uploading" : "idle"}
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
								rejected.reasons[0] in errors
									? errors[rejected.reasons[0] as FileRejectionReason]
									: rejected.reasons.join(", ")
							}
							button={{
								action: "delete",
								onClick: () => {
									const remaining = files.filter((f) => f !== rejected)
									onFilesChange(remaining)
									if (remaining.length === 0) onFilesClear?.()
								},
							}}
						/>
					))}
				</VStack>
			)}
		</>
	)
}
