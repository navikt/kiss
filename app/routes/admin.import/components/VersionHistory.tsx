import { Heading, Table, Tag, VStack } from "@navikt/ds-react"
import type { loader } from "../loader.server"

type LoaderData = Awaited<ReturnType<typeof loader>>["data"]
type Version = LoaderData["versions"][number]

interface VersionHistoryProps {
	versions: Version[]
}

export function VersionHistory({ versions }: VersionHistoryProps) {
	if (versions.length === 0) return null
	return (
		<VStack gap="space-4">
			<Heading size="medium" level="3">
				Versjonshistorikk
			</Heading>
			{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
			<section className="table-scroll" tabIndex={0} aria-label="Versjonshistorikk">
				<Table size="small">
					<Table.Header>
						<Table.Row>
							<Table.HeaderCell scope="col">Filnavn</Table.HeaderCell>
							<Table.HeaderCell scope="col">Status</Table.HeaderCell>
							<Table.HeaderCell scope="col">Importert</Table.HeaderCell>
							<Table.HeaderCell scope="col">Importert av</Table.HeaderCell>
							<Table.HeaderCell scope="col">Aktivert</Table.HeaderCell>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{versions.map((v) => (
							<Table.Row key={v.id}>
								<Table.DataCell>{v.sourceFileName}</Table.DataCell>
								<Table.DataCell>
									<Tag
										variant={v.status === "applied" ? "success" : v.status === "pending" ? "warning" : "neutral"}
										size="small"
									>
										{v.status === "applied" ? "Aktiv" : v.status === "pending" ? "Venter" : "Erstattet"}
									</Tag>
								</Table.DataCell>
								<Table.DataCell>{new Date(v.createdAt).toLocaleString("nb-NO")}</Table.DataCell>
								<Table.DataCell>{v.createdBy}</Table.DataCell>
								<Table.DataCell>{v.activatedAt ? new Date(v.activatedAt).toLocaleString("nb-NO") : "–"}</Table.DataCell>
							</Table.Row>
						))}
					</Table.Body>
				</Table>
			</section>
		</VStack>
	)
}
