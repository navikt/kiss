import type { FileObject } from "@navikt/ds-react"
import { Alert, BodyLong, Heading, VStack } from "@navikt/ds-react"
import { useEffect, useState } from "react"
import { useActionData, useLoaderData, useNavigation, useSubmit } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import type { action } from "./action.server"
import { AuditLog } from "./components/AuditLog"
import { ConfirmStep } from "./components/ConfirmStep"
import { DiffView } from "./components/DiffView"
import { PendingImportAlert } from "./components/PendingImportAlert"
import { PreviewStep } from "./components/PreviewStep"
import { UploadStep } from "./components/UploadStep"
import { VersionHistory } from "./components/VersionHistory"
import type { loader } from "./loader.server"

export { action } from "./action.server"
export { loader } from "./loader.server"
export { RouteErrorBoundary as ErrorBoundary }

export default function Import() {
	const { versions, auditEntries, pendingImport } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const navigation = useNavigation()
	const submit = useSubmit()
	const [files, setFiles] = useState<FileObject[]>([])
	const [excludedChanges, setExcludedChanges] = useState<Set<string>>(new Set())
	const isSubmitting = navigation.state === "submitting"

	// Initialize excludedChanges with db-only keys when actionData changes
	useEffect(() => {
		if (!actionData || !("success" in actionData) || !actionData.success || !actionData.stagingDiff) return
		const diff = actionData.stagingDiff
		if (diff.isFirstImport) return
		const dbOnlyKeys: string[] = []
		for (const r of diff.changed.risks) {
			for (const f of r.fields) {
				if (f.source === "db-only") {
					dbOnlyKeys.push(`risk:${r.riskId}:${f.field}`)
				}
			}
		}
		for (const c of diff.changed.controls) {
			for (const f of c.fields) {
				if (f.source === "db-only") {
					dbOnlyKeys.push(`control:${c.controlId}:${f.field}`)
				}
			}
		}
		setExcludedChanges(new Set(dbOnlyKeys))
	}, [actionData])

	function handleUpload() {
		const acceptedFiles = files.filter((f): f is Extract<FileObject, { error: false }> => !f.error)
		const selectedFile = acceptedFiles.length > 0 ? acceptedFiles[0].file : null
		if (!selectedFile) return
		const formData = new FormData()
		formData.append("file", selectedFile)
		submit(formData, { method: "post", encType: "multipart/form-data" })
	}

	const isStaged = actionData && "success" in actionData && actionData.success
	const isActivated = actionData && "activated" in actionData && actionData.activated

	return (
		<VStack gap="space-6">
			<Heading size="xlarge" level="2">
				Importer kontrollrammeverk
			</Heading>
			<BodyLong>
				Dra og slipp en Excel-fil (.xlsx) i feltet nedenfor, eller klikk for å velge fil fra filsystemet.
			</BodyLong>

			{pendingImport && !actionData && <PendingImportAlert pendingImport={pendingImport} isSubmitting={isSubmitting} />}

			<UploadStep files={files} onFilesChange={setFiles} onUpload={handleUpload} isSubmitting={isSubmitting} />

			{actionData && "success" in actionData && !actionData.success && (
				<Alert variant="error">{actionData.error}</Alert>
			)}

			{isActivated && (
				<Alert variant="success">Kontrollrammeverket er nå aktivert og tilgjengelig på kontrollrammeverk-siden.</Alert>
			)}

			{isStaged && (
				<VStack gap="space-6">
					<Alert variant="success">Filen ble lest og validert. Kontroller dataene nedenfor før aktivering.</Alert>
					<PreviewStep summary={actionData.summary} />
					{actionData.stagingDiff && (
						<DiffView
							stagingDiff={actionData.stagingDiff}
							excludedChanges={excludedChanges}
							setExcludedChanges={setExcludedChanges}
						/>
					)}
					<ConfirmStep stagingDiff={actionData.stagingDiff} excludedChanges={excludedChanges} />
				</VStack>
			)}

			<VersionHistory versions={versions} />
			<AuditLog entries={auditEntries} />
		</VStack>
	)
}
