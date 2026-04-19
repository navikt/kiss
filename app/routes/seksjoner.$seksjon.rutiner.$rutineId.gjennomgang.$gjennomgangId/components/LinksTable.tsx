import { ExternalLinkIcon, TrashIcon } from "@navikt/aksel-icons"
import { Link as AkselLink, BodyShort, Box, Button, Heading, Table, VStack } from "@navikt/ds-react"
import { Form } from "react-router"
import { formatDate } from "../shared"

type ReviewLink = {
	id: string
	title: string | null
	url: string
	addedBy: string
	addedAt: string
}

export function LinksTable({ links, isDraft }: { links: ReviewLink[]; isDraft: boolean }) {
	return (
		<VStack gap="space-4">
			<Heading size="medium" level="3">
				Lenker
			</Heading>
			{links.length > 0 ? (
				<Table size="small">
					<Table.Header>
						<Table.Row>
							<Table.HeaderCell>Tittel</Table.HeaderCell>
							<Table.HeaderCell>URL</Table.HeaderCell>
							<Table.HeaderCell>Lagt til av</Table.HeaderCell>
							<Table.HeaderCell>Dato</Table.HeaderCell>
							{isDraft && <Table.HeaderCell />}
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{links.map((l) => (
							<Table.Row key={l.id}>
								<Table.DataCell>{l.title || "—"}</Table.DataCell>
								<Table.DataCell>
									<AkselLink href={l.url} target="_blank" rel="noopener noreferrer">
										{l.url.length > 60 ? `${l.url.slice(0, 60)}…` : l.url}
										<ExternalLinkIcon aria-hidden style={{ marginLeft: "0.25rem" }} />
									</AkselLink>
								</Table.DataCell>
								<Table.DataCell>{l.addedBy}</Table.DataCell>
								<Table.DataCell>{formatDate(l.addedAt)}</Table.DataCell>
								{isDraft && (
									<Table.DataCell>
										<Form method="post">
											<input type="hidden" name="intent" value="delete-link" />
											<input type="hidden" name="linkId" value={l.id} />
											<Button type="submit" variant="tertiary-neutral" size="xsmall" icon={<TrashIcon aria-hidden />}>
												Fjern
											</Button>
										</Form>
									</Table.DataCell>
								)}
							</Table.Row>
						))}
					</Table.Body>
				</Table>
			) : (
				<Box padding="space-6" borderRadius="8" background="sunken">
					<BodyShort>Ingen lenker er lagt til denne gjennomgangen.</BodyShort>
				</Box>
			)}
		</VStack>
	)
}
