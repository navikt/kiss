import { DownloadIcon, ExternalLinkIcon, PlusIcon, TrashIcon } from "@navikt/aksel-icons"
import type { FileObject } from "@navikt/ds-react"
import {
	Alert,
	BodyShort,
	Box,
	Button,
	Detail,
	Heading,
	HStack,
	ReadMore,
	Select,
	Table,
	Tag,
	Textarea,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Form, useActionData, useNavigation, useRevalidator } from "react-router"
import { AutoUploadDropzone } from "~/components/AutoUploadDropzone"
import type { ActionResult } from "../shared"
import { formatDate, formatFileSize } from "../utils"

const MAX_SIZE_MB = 50
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024

type AttachmentEntry = {
	id: string
	kind: "description" | "resolution"
	fileName: string
	contentType: string
	sizeBytes: number | null
	uploadedBy: string
	uploadedAt: string
}

type FollowUpPoint = {
	id: string
	text: string
	description: string | null
	resolution: string | null
	status: "needs_follow_up" | "completed" | "not_relevant"
	createdBy: string
	createdAt: string
	updatedBy: string
	updatedAt: string
	resolvedAt: string | null
	resolvedBy: string | null
	attachments: AttachmentEntry[]
}

export function FollowUpPointsSection({
	reviewId: _reviewId,
	status,
	points,
}: {
	reviewId: string
	status: "draft" | "needs_follow_up" | "completed" | "discarded"
	points: FollowUpPoint[]
}) {
	const actionData = useActionData<ActionResult>()
	const navigation = useNavigation()
	const isSubmitting = navigation.state === "submitting"
	const [newText, setNewText] = useState("")
	const formRef = useRef<HTMLFormElement>(null)

	const canAdd = status === "draft"
	const canEditText = status === "draft"
	// Beskrivelse på oppfølgingspunkter kan kun redigeres mens gjennomgangen
	// fortsatt er i utkast — etter fullføring (også «må følges opp») er
	// beskrivelsen låst for å bevare konteksten punktet ble opprettet i.
	const canEditDescription = status === "draft"
	const canDelete = status === "draft"
	// Når gjennomgangen er fullført låses begrunnelse/oppfølging på hvert
	// oppfølgingspunkt — man kan kun se eksisterende data, ikke endre status
	// eller laste opp nye vedlegg på resolution.
	const canChangeStatus = status === "draft" || status === "needs_follow_up"

	const followUpAddSuccess = actionData?.intent === "add-follow-up" && actionData.success
	useEffect(() => {
		if (followUpAddSuccess) {
			setNewText("")
			formRef.current?.reset()
		}
	}, [followUpAddSuccess])

	const seenIdsRef = useRef<Set<string> | null>(null)
	const newlyAddedIds = useMemo(() => {
		const previouslySeen = seenIdsRef.current
		const currentIds = new Set(points.map((p) => p.id))
		const added = new Set<string>()
		if (previouslySeen !== null) {
			for (const id of currentIds) {
				if (!previouslySeen.has(id)) {
					added.add(id)
				}
			}
		}
		return added
	}, [points])

	useEffect(() => {
		seenIdsRef.current = new Set(points.map((p) => p.id))
	}, [points])

	const colSpan = 3 + (canChangeStatus || canDelete ? 1 : 0)

	return (
		<VStack gap="space-4">
			<Heading size="medium" level="3">
				Oppfølgingspunkter
			</Heading>
			<BodyShort size="small" textColor="subtle">
				Punkter som må følges opp etter gjennomgangen. Når alle punkter er adressert (fullført eller markert som ikke
				relevant) settes gjennomgangen automatisk til fullført.
			</BodyShort>

			{points.length > 0 ? (
				<Table size="small">
					<Table.Header>
						<Table.Row>
							<Table.HeaderCell scope="col">Tittel</Table.HeaderCell>
							<Table.HeaderCell scope="col">Status</Table.HeaderCell>
							<Table.HeaderCell scope="col">Sist endret</Table.HeaderCell>
							{(canChangeStatus || canDelete) && <Table.HeaderCell scope="col" />}
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{points.map((p) => (
							<FollowUpPointRow
								key={p.id}
								point={p}
								canEditText={canEditText}
								canEditDescription={canEditDescription}
								canChangeStatus={canChangeStatus}
								canDelete={canDelete}
								colSpan={colSpan}
								initiallyOpen={newlyAddedIds.has(p.id)}
							/>
						))}
					</Table.Body>
				</Table>
			) : (
				<Box padding="space-6" borderRadius="8" background="sunken">
					<BodyShort>Ingen oppfølgingspunkter er lagt til.</BodyShort>
				</Box>
			)}

			{canAdd && (
				<Box
					marginBlock="space-8 space-0"
					padding="space-6"
					borderWidth="1"
					borderColor="neutral-subtle"
					borderRadius="8"
				>
					<Form method="post" ref={formRef}>
						<input type="hidden" name="intent" value="add-follow-up" />
						<VStack gap="space-2">
							<TextField
								label="Nytt oppfølgingspunkt"
								name="text"
								size="small"
								value={newText}
								onChange={(e) => setNewText(e.currentTarget.value)}
								description="Kort tittel på hva som må følges opp. Du kan legge til en utdypende beskrivelse og vedlegg etter at punktet er opprettet."
							/>
							{actionData?.intent === "add-follow-up" && actionData.error && (
								<Alert variant="error" size="small">
									{actionData.error}
								</Alert>
							)}
							<HStack>
								<Button
									type="submit"
									variant="secondary"
									size="small"
									icon={<PlusIcon aria-hidden />}
									disabled={!newText.trim() || isSubmitting}
								>
									Legg til oppfølgingspunkt
								</Button>
							</HStack>
						</VStack>
					</Form>
				</Box>
			)}
		</VStack>
	)
}

function FollowUpPointRow({
	point: p,
	canEditText,
	canEditDescription,
	canChangeStatus,
	canDelete,
	colSpan,
	initiallyOpen = false,
}: {
	point: Pick<
		FollowUpPoint,
		"id" | "text" | "description" | "resolution" | "status" | "updatedBy" | "updatedAt" | "attachments"
	>
	canEditText: boolean
	canEditDescription: boolean
	canChangeStatus: boolean
	canDelete: boolean
	colSpan: number
	initiallyOpen?: boolean
}) {
	const actionData = useActionData<ActionResult>()
	const [isOpen, setIsOpen] = useState(initiallyOpen)
	const [descriptionValue, setDescriptionValue] = useState(p.description ?? "")
	const [statusValue, setStatusValue] = useState<"needs_follow_up" | "completed" | "not_relevant">(p.status)
	const [resolutionValue, setResolutionValue] = useState(p.resolution ?? "")

	useEffect(() => {
		setDescriptionValue(p.description ?? "")
	}, [p.description])
	useEffect(() => {
		setStatusValue(p.status)
	}, [p.status])
	useEffect(() => {
		setResolutionValue(p.resolution ?? "")
	}, [p.resolution])

	const descriptionDirty = (descriptionValue ?? "") !== (p.description ?? "")
	const descriptionSavedNow =
		actionData?.intent === "update-follow-up-description" &&
		actionData.success &&
		actionData.pointId === p.id &&
		!descriptionDirty &&
		Boolean(p.description) === Boolean(descriptionValue.trim())

	const statusDirty = statusValue !== p.status || (resolutionValue ?? "") !== (p.resolution ?? "")
	const statusSavedNow =
		actionData?.intent === "update-follow-up-status" &&
		actionData.success &&
		actionData.pointId === p.id &&
		!statusDirty

	function statusTag(s: "needs_follow_up" | "completed" | "not_relevant") {
		if (s === "completed") {
			return (
				<Tag variant="success" size="xsmall">
					Fullført
				</Tag>
			)
		}
		if (s === "not_relevant") {
			return (
				<Tag variant="neutral" size="xsmall">
					Ikke relevant
				</Tag>
			)
		}
		return (
			<Tag variant="warning" size="xsmall">
				Må følges opp
			</Tag>
		)
	}

	return (
		<Table.ExpandableRow
			open={isOpen}
			onOpenChange={setIsOpen}
			togglePlacement="right"
			expandOnRowClick={true}
			colSpan={colSpan}
			content={
				<VStack gap="space-8">
					{canEditDescription ? (
						<Form method="post">
							<input type="hidden" name="intent" value="update-follow-up-description" />
							<input type="hidden" name="pointId" value={p.id} />
							<VStack gap="space-4">
								<Textarea
									label="Beskrivelse"
									name="description"
									size="small"
									minRows={3}
									maxLength={4000}
									required
									value={descriptionValue}
									onChange={(e) => setDescriptionValue(e.currentTarget.value)}
									description="Utdyp hva som må gjøres, hvem som er ansvarlig, frister osv."
								/>
								<FollowUpPointAttachments
									point={p}
									kind="description"
									title="Vedlegg til beskrivelse"
									canUpload={canEditDescription}
								/>
								{actionData?.intent === "update-follow-up-description" && actionData.error && (
									<Alert variant="error" size="small">
										{actionData.error}
									</Alert>
								)}
								<HStack gap="space-2" align="center">
									<Button
										type="submit"
										variant="secondary"
										size="xsmall"
										disabled={!descriptionDirty || descriptionValue.trim().length === 0}
									>
										Lagre beskrivelse
									</Button>
									{descriptionSavedNow && (
										<BodyShort size="small" textColor="subtle">
											Lagret.
										</BodyShort>
									)}
								</HStack>
							</VStack>
						</Form>
					) : (
						<>
							{p.description ? (
								<VStack gap="space-1">
									<Detail weight="semibold" textColor="subtle">
										Beskrivelse
									</Detail>
									<BodyShort size="small" style={{ whiteSpace: "pre-wrap" }}>
										{p.description}
									</BodyShort>
								</VStack>
							) : (
								<BodyShort size="small" textColor="subtle">
									Ingen beskrivelse er lagt til.
								</BodyShort>
							)}
							<FollowUpPointAttachments
								point={p}
								kind="description"
								title="Vedlegg til beskrivelse"
								canUpload={canEditDescription}
							/>
						</>
					)}

					{canChangeStatus && p.description ? (
						<Box borderWidth="1 0 0 0" borderColor="neutral-subtle" paddingBlock="space-16 space-0">
							<Form method="post">
								<input type="hidden" name="intent" value="update-follow-up-status" />
								<input type="hidden" name="pointId" value={p.id} />
								<VStack gap="space-2">
									<Select
										label="Status"
										name="status"
										size="small"
										value={statusValue}
										onChange={(e) =>
											setStatusValue(e.currentTarget.value as "needs_follow_up" | "completed" | "not_relevant")
										}
									>
										<option value="needs_follow_up">Må følges opp</option>
										<option value="completed">Fullført</option>
										<option value="not_relevant">Ikke relevant</option>
									</Select>
									<Textarea
										label="Oppfølging"
										name="resolution"
										size="small"
										minRows={2}
										maxLength={4000}
										required
										value={resolutionValue}
										onChange={(e) => setResolutionValue(e.currentTarget.value)}
										description="Beskriv kort hva som ble gjort eller hvorfor punktet er lukket."
									/>
									<FollowUpPointAttachments
										point={p}
										kind="resolution"
										title="Vedlegg til oppfølging"
										canUpload={canChangeStatus}
									/>
									{actionData?.intent === "update-follow-up-status" && actionData.error && (
										<Alert variant="error" size="small">
											{actionData.error}
										</Alert>
									)}
									<HStack gap="space-2" align="center">
										<Button
											type="submit"
											variant="secondary"
											size="xsmall"
											disabled={!statusDirty || resolutionValue.trim().length === 0}
										>
											Lagre status
										</Button>
										{statusSavedNow && (
											<BodyShort size="small" textColor="subtle">
												Lagret.
											</BodyShort>
										)}
									</HStack>
								</VStack>
							</Form>
						</Box>
					) : p.resolution ? (
						<Box borderWidth="1 0 0 0" borderColor="neutral-subtle" paddingBlock="space-16 space-0">
							<VStack gap="space-2">
								<VStack gap="space-1">
									<Detail weight="semibold" textColor="subtle">
										Oppfølging
									</Detail>
									<BodyShort size="small" style={{ whiteSpace: "pre-wrap" }}>
										{p.resolution}
									</BodyShort>
								</VStack>
								{p.description && (
									<FollowUpPointAttachments
										point={p}
										kind="resolution"
										title="Vedlegg til oppfølging"
										canUpload={canChangeStatus}
									/>
								)}
							</VStack>
						</Box>
					) : p.description ? (
						<Box borderWidth="1 0 0 0" borderColor="neutral-subtle" paddingBlock="space-16 space-0">
							<FollowUpPointAttachments
								point={p}
								kind="resolution"
								title="Vedlegg til oppfølging"
								canUpload={canChangeStatus}
							/>
						</Box>
					) : null}
				</VStack>
			}
		>
			<Table.DataCell>
				{canEditText ? (
					<Form method="post">
						<input type="hidden" name="intent" value="update-follow-up-text" />
						<input type="hidden" name="pointId" value={p.id} />
						<HStack gap="space-2" align="center">
							<TextField
								label="Tittel"
								hideLabel
								name="text"
								size="small"
								defaultValue={p.text}
								style={{ minWidth: "20rem" }}
							/>
							<Button type="submit" variant="tertiary" size="xsmall">
								Lagre
							</Button>
						</HStack>
					</Form>
				) : (
					p.text
				)}
			</Table.DataCell>
			<Table.DataCell>{statusTag(p.status)}</Table.DataCell>
			<Table.DataCell>
				<VStack gap="space-1">
					<Detail>{new Date(p.updatedAt).toLocaleString("nb-NO")}</Detail>
					<Detail textColor="subtle">av {p.updatedBy}</Detail>
				</VStack>
			</Table.DataCell>
			{(canChangeStatus || canDelete) && (
				<Table.DataCell>
					{canDelete && (
						<Form method="post">
							<input type="hidden" name="intent" value="delete-follow-up" />
							<input type="hidden" name="pointId" value={p.id} />
							<Button type="submit" variant="tertiary-neutral" size="xsmall" icon={<TrashIcon aria-hidden />}>
								Fjern
							</Button>
						</Form>
					)}
				</Table.DataCell>
			)}
		</Table.ExpandableRow>
	)
}

function FollowUpPointAttachments({
	point,
	kind,
	title,
	canUpload,
}: {
	point: Pick<FollowUpPoint, "id" | "attachments">
	kind: "description" | "resolution"
	title: string
	canUpload: boolean
}) {
	const revalidator = useRevalidator()
	const [files, setFiles] = useState<FileObject[]>([])
	const [uploading, setUploading] = useState(false)
	const [uploadResult, setUploadResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null)

	const attachmentsForKind = point.attachments.filter((a) => a.kind === kind)

	const uploadFile = useCallback(
		async (file: File) => {
			setUploading(true)
			setUploadResult(null)

			try {
				const formData = new FormData()
				formData.append("file", file)
				formData.append("kind", kind)

				const response = await fetch(`/api/oppfolgingspunkt/${point.id}/vedlegg`, {
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
		},
		[kind, point.id, revalidator],
	)

	function handleFileSelect(newFiles: FileObject[]) {
		if (uploading && newFiles.length > 0) return
		setFiles(newFiles)
		const accepted = newFiles.find((f) => !f.error)
		if (accepted) {
			uploadFile(accepted.file)
		}
	}

	if (!canUpload && attachmentsForKind.length === 0) {
		return null
	}

	return (
		<VStack gap="space-4">
			<Detail weight="semibold" textColor="subtle">
				{title}
			</Detail>

			{attachmentsForKind.length > 0 ? (
				<Table size="small">
					<Table.Header>
						<Table.Row>
							<Table.HeaderCell scope="col">Filnavn</Table.HeaderCell>
							<Table.HeaderCell scope="col">Størrelse</Table.HeaderCell>
							<Table.HeaderCell scope="col">Lastet opp av</Table.HeaderCell>
							<Table.HeaderCell scope="col">Dato</Table.HeaderCell>
							<Table.HeaderCell scope="col" />
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{attachmentsForKind.map((a) => (
							<Table.Row key={a.id}>
								<Table.DataCell>{a.fileName}</Table.DataCell>
								<Table.DataCell>{formatFileSize(a.sizeBytes)}</Table.DataCell>
								<Table.DataCell>{a.uploadedBy}</Table.DataCell>
								<Table.DataCell>{formatDate(a.uploadedAt)}</Table.DataCell>
								<Table.DataCell>
									<HStack gap="space-2">
										<Button
											as="a"
											href={`/api/oppfolgingspunkt-vedlegg/${a.id}`}
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
											href={`/api/oppfolgingspunkt-vedlegg/${a.id}?download=true`}
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
			) : (
				<BodyShort size="small" textColor="subtle">
					Ingen vedlegg lagt til.
				</BodyShort>
			)}

			{canUpload && (
				<ReadMore header="Last opp vedlegg" size="small">
					<VStack gap="space-2">
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
							label={title}
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
				</ReadMore>
			)}
		</VStack>
	)
}
