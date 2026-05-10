import type { FileObject } from "@navikt/ds-react"
import { AutoUploadDropzone } from "~/components/AutoUploadDropzone"
import { MAX_SIZE, MAX_SIZE_MB } from "../shared"

interface UploadStepProps {
	files: FileObject[]
	onFilesChange: (files: FileObject[]) => void
	isSubmitting: boolean
}

export function UploadStep({ files, onFilesChange, isSubmitting }: UploadStepProps) {
	return (
		<AutoUploadDropzone
			label="Dra og slipp Excel-fil, eller klikk for å velge"
			description={`Du kan laste opp filer i xlsx-format. Maks størrelse ${MAX_SIZE_MB} MB.`}
			accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
			maxSizeInBytes={MAX_SIZE}
			files={files}
			onFilesChange={onFilesChange}
			isUploading={isSubmitting}
			rejectionErrors={{
				fileType: "Filformatet støttes ikke. Last opp en .xlsx-fil.",
				fileSize: `Filen er større enn ${MAX_SIZE_MB} MB.`,
			}}
		/>
	)
}
