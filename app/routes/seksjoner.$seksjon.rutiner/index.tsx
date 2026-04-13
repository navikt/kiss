import { DownloadIcon } from "@navikt/aksel-icons"
import { BodyShort, Box, Button, Heading, HStack, Table, Tag, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
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

	const routines = await getRoutinesForSection(section.id)

	return data({
		section,
		routines,
		canAdmin: user ? isAdmin(user) : false,
	})
}

export default function SeksjonRutinerIndex() {
	const { section, routines, canAdmin } = useLoaderData<typeof loader>()

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
									<Link to={`./${routine.id}`}>{routine.name}</Link>
								</Table.DataCell>
								<Table.DataCell>{getFrequencyLabel(routine.frequency)}</Table.DataCell>
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
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
