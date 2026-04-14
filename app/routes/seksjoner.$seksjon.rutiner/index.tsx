import { CheckmarkCircleIcon, DownloadIcon, XMarkOctagonIcon } from "@navikt/aksel-icons"
import { BodyShort, Box, Button, Heading, HGrid, HStack, Table, Tag, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAllControlsForSelection } from "~/db/queries/framework.server"
import { getRoutinesForSection } from "~/db/queries/routines.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import {
	type DataClassification,
	dataClassificationLabels,
	type PersistenceType,
	persistenceTypeLabels,
} from "~/db/schema/applications"
import { getAuthenticatedUser } from "~/lib/auth.server"
import { isAdmin } from "~/lib/authorization.server"
import { getFrequencyLabel } from "~/lib/routine-frequencies"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const { seksjon } = params
	if (!seksjon) {
		throw data({ message: "Mangler seksjonsparameter" }, { status: 400 })
	}

	const user = await getAuthenticatedUser(request)

	const section = await getSectionBySlug(seksjon)
	if (!section) {
		throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })
	}

	const [routines, allControls] = await Promise.all([getRoutinesForSection(section.id), getAllControlsForSelection()])

	return data({
		section,
		routines,
		allControls,
		canAdmin: user ? isAdmin(user) : false,
	})
}

export default function SeksjonRutinerIndex() {
	const { section, routines, allControls, canAdmin } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-6">
			<HStack justify="space-between" align="center">
				<Heading size="large">Rutiner — {section.name}</Heading>
				<HStack gap="space-2">
					<Button
						as="a"
						href={`/api/seksjoner/${section.slug}/eksport?type=rutiner`}
						variant="tertiary"
						size="small"
						icon={<DownloadIcon aria-hidden />}
					>
						Eksporter
					</Button>
					<Button as={Link} to="./mangler" variant="secondary" size="small">
						Manglende
					</Button>
					<Button as={Link} to="./gjennomfort" variant="secondary" size="small">
						Gjennomførte
					</Button>
					{canAdmin && (
						<Button as={Link} to="./ny" variant="primary" size="small">
							Opprett ny rutine
						</Button>
					)}
				</HStack>
			</HStack>

			{routines.length === 0 ? (
				<Box padding="space-6" borderRadius="8" background="sunken">
					<BodyShort>Ingen rutiner er opprettet for denne seksjonen ennå.</BodyShort>
				</Box>
			) : (
				<Table>
					<Table.Header>
						<Table.Row>
							<Table.HeaderCell>Navn</Table.HeaderCell>
							<Table.HeaderCell>Frekvens</Table.HeaderCell>
							<Table.HeaderCell>Krav</Table.HeaderCell>
							<Table.HeaderCell>Teknologielementer</Table.HeaderCell>
							<Table.HeaderCell>Databasekoblinger</Table.HeaderCell>
							<Table.HeaderCell>Gjennomganger</Table.HeaderCell>
							<Table.HeaderCell />
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{routines.map((routine) => (
							<Table.Row key={routine.id}>
								<Table.DataCell>
									<HStack gap="space-2" align="center" wrap>
										<Link to={`./${routine.id}`}>{routine.name}</Link>
										{routine.appliesToAllInSection === 1 && (
											<Tag variant="alt3" size="xsmall">
												Gjelder alle
											</Tag>
										)}
									</HStack>
								</Table.DataCell>
								<Table.DataCell>{getFrequencyLabel(routine.frequency)}</Table.DataCell>
								<Table.DataCell>
									<VStack gap="space-1">
										{routine.controls.map((c) => (
											<HStack key={c.id} gap="space-2" align="center" wrap>
												<Tag variant="alt1" size="xsmall">
													{c.controlId}
												</Tag>
												<BodyShort size="small">{c.name}</BodyShort>
											</HStack>
										))}
									</VStack>
								</Table.DataCell>
								<Table.DataCell>
									<HStack gap="space-1" wrap>
										{routine.technologyElements.map((te) => (
											<Tag key={te.id} variant="info" size="small">
												{te.name}
											</Tag>
										))}
									</HStack>
								</Table.DataCell>
								<Table.DataCell>
									<HStack gap="space-2" wrap>
										{routine.persistenceLinks.map((pl) => (
											<HStack key={pl.id} gap="space-1" wrap>
												{pl.persistenceType && (
													<Tag variant="info" size="xsmall">
														{persistenceTypeLabels[pl.persistenceType as PersistenceType] ?? pl.persistenceType}
													</Tag>
												)}
												{pl.dataClassification && (
													<Tag variant="warning" size="xsmall">
														{dataClassificationLabels[pl.dataClassification as DataClassification] ??
															pl.dataClassification}
													</Tag>
												)}
											</HStack>
										))}
									</HStack>
								</Table.DataCell>
								<Table.DataCell>{routine.reviewCount}</Table.DataCell>
								<Table.DataCell>
									{canAdmin && (
										<Button as={Link} to={`./${routine.id}/rediger`} variant="tertiary" size="small">
											Rediger
										</Button>
									)}
								</Table.DataCell>
							</Table.Row>
						))}
					</Table.Body>
				</Table>
			)}

			{/* Kravdekning */}
			<ControlCoverageSummary routines={routines} allControls={allControls} />
		</VStack>
	)
}

function ControlCoverageSummary({
	routines,
	allControls,
}: {
	routines: Array<{ controls: Array<{ id: string; controlId: string; name: string }> }>
	allControls: Array<{ id: string; controlId: string; name: string }>
}) {
	const coveredControlIds = new Set(routines.flatMap((r) => r.controls.map((c) => c.id)))
	const covered = allControls.filter((c) => coveredControlIds.has(c.id))
	const uncovered = allControls.filter((c) => !coveredControlIds.has(c.id))

	return (
		<VStack gap="space-4">
			<HStack gap="space-4" align="center">
				<Heading size="medium" level="3">
					Kravdekning
				</Heading>
				<Tag variant={uncovered.length === 0 ? "success" : "neutral"} size="small">
					{covered.length} av {allControls.length} krav dekket
				</Tag>
			</HStack>

			<HGrid columns={{ xs: 1, md: 2 }} gap="space-4">
				{uncovered.length > 0 && (
					<Box padding="space-4" borderRadius="8" borderWidth="1" borderColor="neutral-subtle">
						<VStack gap="space-2">
							<HStack gap="space-2" align="center">
								<XMarkOctagonIcon aria-hidden fontSize="1.25rem" color="var(--ax-text-danger)" />
								<Heading size="xsmall" level="4">
									Krav uten rutiner ({uncovered.length})
								</Heading>
							</HStack>
							<VStack gap="space-1">
								{uncovered.map((c) => (
									<HStack key={c.id} gap="space-2" align="center" wrap>
										<Tag variant="error" size="xsmall">
											{c.controlId}
										</Tag>
										<BodyShort size="small">{c.name}</BodyShort>
									</HStack>
								))}
							</VStack>
						</VStack>
					</Box>
				)}

				{covered.length > 0 && (
					<Box padding="space-4" borderRadius="8" borderWidth="1" borderColor="neutral-subtle">
						<VStack gap="space-2">
							<HStack gap="space-2" align="center">
								<CheckmarkCircleIcon aria-hidden fontSize="1.25rem" color="var(--ax-text-success)" />
								<Heading size="xsmall" level="4">
									Krav med rutiner ({covered.length})
								</Heading>
							</HStack>
							<VStack gap="space-1">
								{covered.map((c) => (
									<HStack key={c.id} gap="space-2" align="center" wrap>
										<Tag variant="success" size="xsmall">
											{c.controlId}
										</Tag>
										<BodyShort size="small">{c.name}</BodyShort>
									</HStack>
								))}
							</VStack>
						</VStack>
					</Box>
				)}
			</HGrid>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
