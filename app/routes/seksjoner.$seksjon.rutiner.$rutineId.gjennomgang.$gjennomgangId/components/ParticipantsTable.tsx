import { Heading, Table, Tag, VStack } from "@navikt/ds-react"
import { formatDate } from "../shared"

type Participant = {
	id: string
	userIdent: string
	userName: string | null
	confirmedAt: string | null
}

export function ParticipantsTable({ participants }: { participants: Participant[] }) {
	if (participants.length === 0) return null
	const confirmedCount = participants.filter((p) => p.confirmedAt).length

	return (
		<VStack gap="space-4">
			<Heading size="medium" level="3">
				Deltakere ({confirmedCount}/{participants.length} bekreftet)
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
					{participants.map((p) => (
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
	)
}
