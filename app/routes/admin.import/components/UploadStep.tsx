import type { FileObject, FileRejected, FileRejectionReason } from "@navikt/ds-react"
import { Button, FileUpload, Heading, VStack } from "@navikt/ds-react"
import { MAX_SIZE, MAX_SIZE_MB, rejectionErrors } from "../shared"

interface UploadStepProps {
	files: FileObject[]
	onFilesChange: (files: FileObject[]) => void
	onUpload: () => void
	isSubmitting: boolean
}

export function UploadStep({ files, onFilesChange, onUpload, isSubmitting }: UploadStepProps) {
	const acceptedFiles = files.filter((f): f is Extract<FileObject, { error: false }> => !f.error)
	const rejectedFiles = files.filter((f): f is FileRejected => f.error)

	return (
		<>
			<FileUpload.Dropzone
				label="Last opp kontrollrammeverk"
				description={`Du kan laste opp filer i xlsx-format. Maks størrelse ${MAX_SIZE_MB} MB.`}
				accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
				maxSizeInBytes={MAX_SIZE}
				multiple={false}
				onSelect={onFilesChange}
				fileLimit={{ max: 1, current: acceptedFiles.length }}
			/>

			{acceptedFiles.length > 0 && (
				<VStack gap="space-8">
					<VStack as="ul" gap="space-12">
						{acceptedFiles.map((file) => (
							<FileUpload.Item
								as="li"
								key={file.file.name}
								file={file.file}
								button={{
									action: "delete",
									onClick: () => onFilesChange([]),
								}}
								status={isSubmitting ? "uploading" : "idle"}
							/>
						))}
					</VStack>
					<div>
						<Button type="button" variant="primary" onClick={onUpload} loading={isSubmitting}>
							Last opp og valider
						</Button>
					</div>
				</VStack>
			)}

			{rejectedFiles.length > 0 && (
				<VStack gap="space-8">
					<Heading level="3" size="xsmall">
						Filer med feil
					</Heading>
					<VStack as="ul" gap="space-12">
						{rejectedFiles.map((rejected) => (
							<FileUpload.Item
								as="li"
								key={rejected.file.name}
								file={rejected.file}
								error={
									rejected.reasons[0] in rejectionErrors
										? rejectionErrors[rejected.reasons[0] as FileRejectionReason]
										: rejected.reasons.join(", ")
								}
								button={{
									action: "delete",
									onClick: () => onFilesChange(files.filter((f) => f !== rejected)),
								}}
							/>
						))}
					</VStack>
				</VStack>
			)}
		</>
	)
}
