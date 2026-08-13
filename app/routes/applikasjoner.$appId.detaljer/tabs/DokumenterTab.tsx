import { DownloadIcon } from "@navikt/aksel-icons"
import { BodyShort, Button, Detail, Table, Tag, VStack } from "@navikt/ds-react"
import { Link } from "react-router"
import { UserDisplayName } from "~/components/UserDisplayName"
import { activityTypeLabels, type RoutineActivityType } from "~/lib/activity-types"

type DocumentKind = "review_attachment" | "follow_up_attachment" | "evidence_download"

export interface ApplicationDocumentRow {
	id: string
	kind: DocumentKind
	fileName: string
	sizeBytes: number | null
	contentType: string | null
	uploadedBy: string
	uploadedByName: string | null
	uploadedAt: string
	reviewId: string
	routineId: string
	routineName: string
	sectionId: string | null
	reviewTitle: string
	activityType: RoutineActivityType | null
	followUpPointText: string | null
	downloadUrl: string
}

const kindLabels: Record<DocumentKind, string> = {
	review_attachment: "Vedlegg i gjennomgang",
	follow_up_attachment: "Vedlegg i oppfølgingspunkt",
	evidence_download: "Vedlikeholdsaktivitet",
}

function formatFileSize(bytes: number | null): string {
	if (bytes == null) return "—"
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(dateStr: string): string {
	return new Date(dateStr).toLocaleString("nb-NO", {
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	})
}

export function DokumenterTab({
	documents,
	sectionSlugMap,
}: {
	documents: ApplicationDocumentRow[]
	sectionSlugMap: Record<string, string>
}) {
	if (documents.length === 0) {
		return (
			<BodyShort textColor="subtle" size="small" style={{ marginTop: "var(--ax-space-8)" }}>
				Ingen vedlegg eller dokumenter er registrert for denne applikasjonen ennå.
			</BodyShort>
		)
	}

	return (
		// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1
		<section className="table-scroll" tabIndex={0} aria-label="Vedlegg og dokumenter">
			<Table size="small">
				<Table.Header>
					<Table.Row>
						<Table.HeaderCell>Type</Table.HeaderCell>
						<Table.HeaderCell>Navn</Table.HeaderCell>
						<Table.HeaderCell>Rutine / gjennomgang</Table.HeaderCell>
						<Table.HeaderCell>Størrelse</Table.HeaderCell>
						<Table.HeaderCell>Lastet opp / hentet av</Table.HeaderCell>
						<Table.HeaderCell>Tidspunkt</Table.HeaderCell>
						<Table.HeaderCell />
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{documents.map((doc) => {
						const slug = doc.sectionId ? sectionSlugMap[doc.sectionId] : null
						const reviewLink = slug ? `/seksjoner/${slug}/rutiner/${doc.routineId}/gjennomgang/${doc.reviewId}` : null

						return (
							<Table.Row key={`${doc.kind}-${doc.id}`}>
								<Table.DataCell>
									<Tag variant={doc.kind === "evidence_download" ? "info" : "alt1"} size="xsmall">
										{kindLabels[doc.kind]}
									</Tag>
								</Table.DataCell>
								<Table.DataCell>
									<VStack gap="space-1">
										<BodyShort size="small">{doc.fileName}</BodyShort>
										{doc.activityType && <Detail textColor="subtle">{activityTypeLabels[doc.activityType]}</Detail>}
										{doc.followUpPointText && (
											<Detail textColor="subtle">Oppfølgingspunkt: {doc.followUpPointText}</Detail>
										)}
									</VStack>
								</Table.DataCell>
								<Table.DataCell>
									<VStack gap="space-1">
										<BodyShort size="small">{doc.routineName}</BodyShort>
										{reviewLink ? (
											<Link to={reviewLink}>{doc.reviewTitle}</Link>
										) : (
											<Detail textColor="subtle">{doc.reviewTitle}</Detail>
										)}
									</VStack>
								</Table.DataCell>
								<Table.DataCell>{formatFileSize(doc.sizeBytes)}</Table.DataCell>
								<Table.DataCell>
									<UserDisplayName navIdent={doc.uploadedBy} name={doc.uploadedByName} />
								</Table.DataCell>
								<Table.DataCell>{formatDate(doc.uploadedAt)}</Table.DataCell>
								<Table.DataCell>
									<Button
										as="a"
										href={doc.downloadUrl}
										variant="tertiary"
										size="xsmall"
										icon={<DownloadIcon aria-hidden />}
									>
										Last ned
									</Button>
								</Table.DataCell>
							</Table.Row>
						)
					})}
				</Table.Body>
			</Table>
		</section>
	)
}
