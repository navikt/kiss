import { DownloadIcon, ExternalLinkIcon, UploadIcon } from "@navikt/aksel-icons"
import type { FileObject, FileRejected, FileRejectionReason } from "@navikt/ds-react"
import {
	Link as AkselLink,
	Alert,
	BodyShort,
	Box,
	Button,
	ConfirmationPanel,
	Detail,
	FileUpload,
	Heading,
	HStack,
	Label,
	Table,
	Tag,
	VStack,
} from "@navikt/ds-react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Link, useActionData, useLoaderData, useNavigation, useRevalidator, useSubmit } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { completeReview, getReview, getRoutine } from "~/db/queries/routines.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { renderMarkdown } from "~/lib/markdown.server"
import { getFrequencyLabel } from "~/lib/routine-frequencies"

const MAX_SIZE_MB = 50
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024

type ActionResult = {
	success: boolean
	message?: string
	error?: string
	intent?: string
}

export async function loader({ params }: LoaderFunctionArgs) {
	const { seksjon, rutineId, gjennomgangId } = params
	if (!seksjon || !rutineId || !gjennomgangId) {
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

	const review = await getReview(gjennomgangId)
	if (!review) {
		throw data({ message: "Fant ikke gjennomgang" }, { status: 404 })
	}

	let applicationName: string | null = null
	if (review.applicationId) {
		const { getApplicationDetail } = await import("~/db/queries/nais.server")
		const appDetail = await getApplicationDetail(review.applicationId)
		applicationName = appDetail?.app.name ?? null
	}

	return data({
		section,
		routine,
		review: {
			...review,
			applicationName,
			reviewedAt: review.reviewedAt.toISOString(),
			createdAt: review.createdAt.toISOString(),
			summaryHtml: renderMarkdown(review.summary),
			participants: review.participants.map((p) => ({
				...p,
				confirmedAt: p.confirmedAt?.toISOString() ?? null,
			})),
			attachments: review.attachments.map((a) => ({
				...a,
				uploadedAt: a.uploadedAt.toISOString(),
			})),
		},
	})
}

export async function action({ request, params }: ActionFunctionArgs) {
	const { gjennomgangId } = params
	if (!gjennomgangId) {
		throw data({ message: "Mangler parametere" }, { status: 400 })
	}

	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)

	const formData = await request.formData()
	const intent = formData.get("intent") as string

	if (intent === "complete") {
		const review = await getReview(gjennomgangId)
		if (!review) {
			return data<ActionResult>({ success: false, error: "Fant ikke gjennomgang", intent: "complete" })
		}
		if (review.status === "completed") {
			return data<ActionResult>({ success: false, error: "Gjennomgangen er allerede fullført.", intent: "complete" })
		}

		await completeReview(gjennomgangId, authedUser.navIdent)

		return data<ActionResult>({
			success: true,
			message: "Gjennomgangen er fullført.",
			intent: "complete",
		})
	}

	return data<ActionResult>({ success: false, error: "Ukjent handling" })
}

function formatDate(dateStr: string) {
	return new Date(dateStr).toLocaleDateString("nb-NO", {
		day: "numeric",
		month: "long",
		year: "numeric",
	})
}

function formatDateTime(dateStr: string) {
	const d = new Date(dateStr)
	return d.toLocaleDateString("nb-NO", {
		day: "numeric",
		month: "long",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	})
}

function formatFileSize(bytes: number | null) {
	if (!bytes) return "—"
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const rejectionErrors: Record<FileRejectionReason, string> = {
	fileType: "Filtypen er ikke støttet",
	fileSize: `Filen er for stor (maks ${MAX_SIZE_MB} MB)`,
}

function UploadSection({ reviewId }: { reviewId: string }) {
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
						disabled={uploading}
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

function CompleteSection() {
	const submit = useSubmit()
	const navigation = useNavigation()
	const actionData = useActionData<ActionResult>()
	const [confirmed, setConfirmed] = useState(false)
	const isSubmitting = navigation.state === "submitting"

	function handleComplete() {
		if (!confirmed) return
		const formData = new FormData()
		formData.set("intent", "complete")
		submit(formData, { method: "post" })
	}

	return (
		<Box padding="space-8" borderWidth="1" borderColor="warning" borderRadius="8" background="warning-softA">
			<VStack gap="space-4">
				<Heading size="small" level="4">
					Fullfør gjennomgang
				</Heading>
				<BodyShort>
					Når gjennomgangen er fullført kan den ikke lenger redigeres. Sørg for at alle vedlegg er lastet opp og
					oppsummeringen er korrekt.
				</BodyShort>

				{actionData?.intent === "complete" && actionData.error && (
					<Alert variant="error" size="small">
						{actionData.error}
					</Alert>
				)}

				<ConfirmationPanel
					checked={confirmed}
					onChange={() => setConfirmed(!confirmed)}
					label="Jeg bekrefter at gjennomgangen er komplett"
					size="small"
				/>

				<HStack>
					<Button
						type="button"
						variant="primary"
						size="small"
						onClick={handleComplete}
						disabled={!confirmed || isSubmitting}
						loading={isSubmitting}
					>
						Fullfør gjennomgang
					</Button>
				</HStack>
			</VStack>
		</Box>
	)
}

export default function GjennomgangDetalj() {
	const { section, routine, review } = useLoaderData<typeof loader>()
	const confirmedCount = review.participants.filter((p) => p.confirmedAt).length
	const isDraft = review.status === "draft"

	return (
		<VStack gap="space-8" style={{ maxWidth: "64rem" }}>
			<div>
				<Detail>
					<Link to={`/seksjoner/${section.slug}/rutiner/${routine.id}`}>← Tilbake til {routine.name}</Link>
				</Detail>
				<HStack gap="space-4" align="center">
					<Heading size="xlarge" level="2">
						{review.title}
					</Heading>
					{isDraft ? (
						<Tag variant="warning" size="small">
							Utkast
						</Tag>
					) : (
						<Tag variant="success" size="small">
							Fullført
						</Tag>
					)}
				</HStack>
			</div>

			{/* Metadata */}
			<Box padding="space-8" borderWidth="1" borderColor="neutral-subtle" borderRadius="8">
				<HStack gap="space-12" wrap>
					<VStack gap="space-2">
						<Label size="small">Rutine</Label>
						<BodyShort>
							<AkselLink as={Link} to={`/seksjoner/${section.slug}/rutiner/${routine.id}`}>
								{routine.name}
							</AkselLink>
						</BodyShort>
					</VStack>
					<VStack gap="space-2">
						<Label size="small">Frekvens</Label>
						<BodyShort>{getFrequencyLabel(routine.frequency)}</BodyShort>
					</VStack>
					<VStack gap="space-2">
						<Label size="small">Gjennomgangsdato</Label>
						<BodyShort>{formatDateTime(review.reviewedAt)}</BodyShort>
					</VStack>
					<VStack gap="space-2">
						<Label size="small">Opprettet av</Label>
						<BodyShort>{review.createdBy}</BodyShort>
					</VStack>
					<VStack gap="space-2">
						<Label size="small">Opprettet</Label>
						<BodyShort>{formatDateTime(review.createdAt)}</BodyShort>
					</VStack>
					{review.applicationId && (
						<VStack gap="space-2">
							<Label size="small">Applikasjon</Label>
							<BodyShort>
								<AkselLink as={Link} to={`/applikasjoner/${review.applicationId}/detaljer`}>
									{review.applicationName ?? review.applicationId}
								</AkselLink>
							</BodyShort>
						</VStack>
					)}
				</HStack>
			</Box>

			{/* Summary */}
			{review.summaryHtml && (
				<VStack gap="space-2">
					<Heading size="medium" level="3">
						Oppsummering / referat
					</Heading>
					<Box padding="space-8" borderWidth="1" borderColor="neutral-subtle" borderRadius="8">
						<div
							className="markdown-content"
							// biome-ignore lint/security/noDangerouslySetInnerHtml: server-sanitized
							dangerouslySetInnerHTML={{ __html: review.summaryHtml }}
						/>
					</Box>
				</VStack>
			)}

			{/* Participants */}
			{review.participants.length > 0 && (
				<VStack gap="space-4">
					<Heading size="medium" level="3">
						Deltakere ({confirmedCount}/{review.participants.length} bekreftet)
					</Heading>
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell>Ident</Table.HeaderCell>
								<Table.HeaderCell>Navn</Table.HeaderCell>
								<Table.HeaderCell>Status</Table.HeaderCell>
								<Table.HeaderCell>Bekreftet</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{review.participants.map((p) => (
								<Table.Row key={p.id}>
									<Table.DataCell>{p.userIdent}</Table.DataCell>
									<Table.DataCell>{p.userName ?? "—"}</Table.DataCell>
									<Table.DataCell>
										{p.confirmedAt ? (
											<Tag variant="success" size="xsmall">
												Bekreftet
											</Tag>
										) : (
											<Tag variant="warning" size="xsmall">
												Venter
											</Tag>
										)}
									</Table.DataCell>
									<Table.DataCell>{p.confirmedAt ? formatDate(p.confirmedAt) : "—"}</Table.DataCell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				</VStack>
			)}

			{/* Vedlegg */}
			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Vedlegg
				</Heading>
				{review.attachments.length > 0 ? (
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell>Filnavn</Table.HeaderCell>
								<Table.HeaderCell>Type</Table.HeaderCell>
								<Table.HeaderCell>Størrelse</Table.HeaderCell>
								<Table.HeaderCell>Lastet opp av</Table.HeaderCell>
								<Table.HeaderCell>Dato</Table.HeaderCell>
								<Table.HeaderCell />
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{review.attachments.map((a) => (
								<Table.Row key={a.id}>
									<Table.DataCell>{a.fileName}</Table.DataCell>
									<Table.DataCell>{a.contentType}</Table.DataCell>
									<Table.DataCell>{formatFileSize(a.sizeBytes)}</Table.DataCell>
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
				) : (
					<Box padding="space-6" borderRadius="8" background="sunken">
						<BodyShort>Ingen vedlegg er lagt til denne gjennomgangen.</BodyShort>
					</Box>
				)}
			</VStack>

			{/* Upload section — only for drafts */}
			{isDraft && <UploadSection reviewId={review.id} />}

			{/* Complete section — only for drafts */}
			{isDraft && <CompleteSection />}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
