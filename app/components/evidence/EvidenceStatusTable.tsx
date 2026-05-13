import { BodyShort, Button, Detail, HStack, Table, Tag } from "@navikt/ds-react"
import type { EvidenceStatusItem } from "~/lib/evidence-providers/types"
import { EvidenceStatusBadge } from "./EvidenceStatusBadge"

interface Props {
	evidenceTypes: EvidenceStatusItem[]
	/** Whether download actions should be shown (draft + pending) */
	showActions: boolean
	isDownloading: boolean
	onDownload: (evidenceType: string, format: string) => void
}

export function EvidenceStatusTable({ evidenceTypes, showActions, isDownloading, onDownload }: Props) {
	return (
		// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table needs keyboard access
		<section className="table-scroll" tabIndex={0} aria-label="Status for bevistyper">
			<Table size="small">
				<Table.Header>
					<Table.Row>
						<Table.HeaderCell>Bevistype</Table.HeaderCell>
						<Table.HeaderCell>Status</Table.HeaderCell>
						<Table.HeaderCell>Tilgjengelig</Table.HeaderCell>
						{showActions && <Table.HeaderCell>Handlinger</Table.HeaderCell>}
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{evidenceTypes.map((et) => (
						<Table.Row key={et.id}>
							<Table.DataCell>
								<BodyShort size="small" weight="semibold">
									{et.label}
								</BodyShort>
							</Table.DataCell>
							<Table.DataCell>
								<EvidenceStatusBadge status={et.status} />
								{et.error && <Detail style={{ color: "var(--ax-text-danger)" }}>{et.error}</Detail>}
							</Table.DataCell>
							<Table.DataCell>
								{et.canDownload ? (
									<Tag variant="success" size="xsmall">
										Ja
									</Tag>
								) : (
									<Tag variant="neutral" size="xsmall">
										Nei
									</Tag>
								)}
							</Table.DataCell>
							{showActions && (
								<Table.DataCell>
									<HStack gap="space-2">
										{et.formats.map((fmt) => (
											<Button
												key={fmt}
												variant="tertiary"
												size="xsmall"
												onClick={() => onDownload(et.id, fmt)}
												loading={isDownloading}
												disabled={!et.canDownload || isDownloading}
											>
												Hent {fmt}
											</Button>
										))}
									</HStack>
								</Table.DataCell>
							)}
						</Table.Row>
					))}
				</Table.Body>
			</Table>
		</section>
	)
}
