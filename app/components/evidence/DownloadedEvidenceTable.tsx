import { DownloadIcon } from "@navikt/aksel-icons"
import { BodyShort, Button, Detail, Heading, Table, Tag, VStack } from "@navikt/ds-react"

export interface EvidenceDownload {
	id: string
	instanceId: string
	evidenceType: string
	format: string
	fileName: string
	sizeBytes: number | null
	source: string
	apiInstanceName: string | null
	forceFetchJustification: string | null
	performedBy: string
	performedAt: string
}

interface Props {
	downloads: EvidenceDownload[]
	/** Map evidence type id → human-readable label */
	evidenceTypeLabels: Record<string, string>
	/** Format an instance id for display */
	formatInstanceId: (instanceId: string) => string
}

function formatFileSize(bytes: number | null): string {
	if (bytes == null) return "—"
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(dateStr: string): string {
	return new Date(dateStr).toLocaleDateString("nb-NO", {
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	})
}

export function DownloadedEvidenceTable({ downloads, evidenceTypeLabels, formatInstanceId }: Props) {
	return (
		<VStack gap="space-2">
			<Heading size="small" level="4">
				Nedlastede bevis ({downloads.length})
			</Heading>
			{downloads.length > 0 ? (
				// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table needs keyboard access
				<section className="table-scroll" tabIndex={0} aria-label="Nedlastede bevis">
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell>Bevistype</Table.HeaderCell>
								<Table.HeaderCell>Instans</Table.HeaderCell>
								<Table.HeaderCell>Format</Table.HeaderCell>
								<Table.HeaderCell>Kilde</Table.HeaderCell>
								<Table.HeaderCell>Størrelse</Table.HeaderCell>
								<Table.HeaderCell>Utført av</Table.HeaderCell>
								<Table.HeaderCell>Tidspunkt</Table.HeaderCell>
								<Table.HeaderCell />
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{downloads.map((d) => (
								<Table.Row key={d.id}>
									<Table.DataCell>{evidenceTypeLabels[d.evidenceType] ?? d.evidenceType}</Table.DataCell>
									<Table.DataCell>{d.apiInstanceName ?? formatInstanceId(d.instanceId)}</Table.DataCell>
									<Table.DataCell>
										<Tag variant="neutral" size="xsmall">
											{d.format.toUpperCase()}
										</Tag>
									</Table.DataCell>
									<Table.DataCell>
										<VStack gap="space-1">
											{d.source === "m2m_api" ? (
												<Tag variant="info" size="xsmall">
													Hentet automatisk
												</Tag>
											) : (
												<Tag variant="alt1" size="xsmall">
													Lastet opp manuelt
												</Tag>
											)}
											{d.forceFetchJustification && <Detail>Begrunnelse: {d.forceFetchJustification}</Detail>}
										</VStack>
									</Table.DataCell>
									<Table.DataCell>{formatFileSize(d.sizeBytes)}</Table.DataCell>
									<Table.DataCell>{d.performedBy}</Table.DataCell>
									<Table.DataCell>{formatDate(d.performedAt)}</Table.DataCell>
									<Table.DataCell>
										<Button
											as="a"
											href={`/api/evidence-file/${d.id}`}
											variant="tertiary"
											size="xsmall"
											icon={<DownloadIcon aria-hidden />}
										>
											Last ned
										</Button>
									</Table.DataCell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				</section>
			) : (
				<BodyShort size="small">Ingen bevis lastet ned ennå.</BodyShort>
			)}
		</VStack>
	)
}
