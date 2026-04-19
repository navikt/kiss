import { DownloadIcon, ExternalLinkIcon } from "@navikt/aksel-icons"
import { BodyShort, Box, Button, Heading, HStack, Table, VStack } from "@navikt/ds-react"
import { formatDate, formatFileSize } from "../shared"

type Attachment = {
	id: string
	fileName: string
	contentType: string
	sizeBytes: number | null
	uploadedBy: string
	uploadedAt: string
}

export function AttachmentsTable({ attachments }: { attachments: Attachment[] }) {
	return (
		<VStack gap="space-4">
			<Heading size="medium" level="3">
				Vedlegg
			</Heading>
			{attachments.length > 0 ? (
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
						{attachments.map((a) => (
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
	)
}
