import { PlusIcon } from "@navikt/aksel-icons"
import {
	Link as AkselLink,
	BodyLong,
	BodyShort,
	Button,
	Heading,
	HStack,
	Table,
	Tag,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { useRef } from "react"
import { Form, Link } from "react-router"
import type { TeamItem } from "../shared"

export function UtviklingsteamTab({
	teams,
	seksjon,
	sectionName,
}: {
	teams: TeamItem[]
	seksjon: string
	sectionName: string
}) {
	const teamFormRef = useRef<HTMLFormElement>(null)

	return (
		<VStack gap="space-6">
			{teams.length > 0 && (
				/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
				<section className="table-scroll" tabIndex={0} aria-label={`Team i ${sectionName}`}>
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Team</Table.HeaderCell>
								<Table.HeaderCell scope="col">Beskrivelse</Table.HeaderCell>
								<Table.HeaderCell scope="col">Nais-team</Table.HeaderCell>
								<Table.HeaderCell scope="col" />
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{teams.map((team) => (
								<Table.Row key={team.id}>
									<Table.DataCell>
										<HStack gap="space-2" align="center" wrap>
											<AkselLink as={Link} to={`/seksjoner/${seksjon}/team/${team.slug}`}>
												{team.name}
											</AkselLink>
											{team.archivedAt && (
												<Tag variant="neutral" size="xsmall">
													Arkivert
												</Tag>
											)}
										</HStack>
									</Table.DataCell>
									<Table.DataCell>{team.description ?? "–"}</Table.DataCell>
									<Table.DataCell>
										{team.linkedNaisTeams.length > 0 ? (
											<HStack gap="space-2" wrap>
												{team.linkedNaisTeams.map((slug) => (
													<Tag key={slug} variant="info" size="xsmall">
														{slug}
													</Tag>
												))}
											</HStack>
										) : (
											/* TODO: flytt inline style til CSS module */
											<BodyShort size="small" style={{ color: "var(--ax-text-subtle)" }}>
												Ingen
											</BodyShort>
										)}
									</Table.DataCell>
									<Table.DataCell align="right">
										<Button
											as={Link}
											to={`/seksjoner/${seksjon}/team/${team.slug}/rediger`}
											variant="tertiary"
											size="xsmall"
										>
											Rediger
										</Button>
									</Table.DataCell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				</section>
			)}

			{teams.length === 0 && <BodyLong>Ingen team er opprettet i denne seksjonen.</BodyLong>}

			<Form
				method="post"
				ref={teamFormRef}
				onSubmit={() => {
					setTimeout(() => teamFormRef.current?.reset(), 0)
				}}
			>
				<input type="hidden" name="intent" value="create-team" />
				<VStack gap="space-4">
					<Heading size="small" level="4">
						Legg til team
					</Heading>
					<HStack gap="space-4" align="end">
						<TextField label="Teamnavn" name="name" size="small" autoComplete="off" />
						<TextField label="Beskrivelse" name="description" size="small" autoComplete="off" />
						<Button type="submit" variant="secondary" size="small" icon={<PlusIcon aria-hidden />}>
							Legg til
						</Button>
					</HStack>
				</VStack>
			</Form>
		</VStack>
	)
}
