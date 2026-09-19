import { BodyLong, Link as DsLink, Heading, Table, Tag, VStack } from "@navikt/ds-react"
import { and, eq, isNotNull, isNull } from "drizzle-orm"
import { data, Link, useLoaderData } from "react-router"
import { db } from "~/db/connection.server"
import { getSectionIdsForApp } from "~/db/queries/routines.server"
import { monitoredApplications } from "~/db/schema/applications"
import { sections } from "~/db/schema/organization"
import { routines } from "~/db/schema/routines"
import { screeningRoutineSelections } from "~/db/schema/screening"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"
import type { Route } from "./+types/index"

interface MismatchRow {
	selectionId: string
	applicationId: string
	applicationName: string
	routineId: string
	routineName: string
	routineSectionId: string
	routineSectionName: string
	routineSectionSlug: string
	selectedBy: string
	selectedAt: string
}

export async function loader({ request }: Route.LoaderArgs) {
	const authedUser = await requireAuthenticatedUser(request)
	requireAdmin(authedUser)

	const mismatches = await findRoutineSectionMismatches()
	return data({ mismatches })
}

/**
 * Finds active screening_routine_selections whose routine belongs to a section the application
 * does not effectively belong to. Historically possible because saveRoutineSelection and the
 * matchers that read these selections did not enforce section-scoping before this was fixed
 * (see PR #769) — this view lets admins spot and clean up any stale cross-section selections
 * that may already exist in the database.
 */
async function findRoutineSectionMismatches(): Promise<MismatchRow[]> {
	const activeSelections = await db
		.select({
			selectionId: screeningRoutineSelections.id,
			applicationId: screeningRoutineSelections.applicationId,
			applicationName: monitoredApplications.name,
			routineId: routines.id,
			routineName: routines.name,
			routineSectionId: routines.sectionId,
			routineSectionName: sections.name,
			routineSectionSlug: sections.slug,
			selectedBy: screeningRoutineSelections.selectedBy,
			selectedAt: screeningRoutineSelections.selectedAt,
		})
		.from(screeningRoutineSelections)
		.innerJoin(routines, eq(routines.id, screeningRoutineSelections.routineId))
		.innerJoin(sections, eq(sections.id, routines.sectionId))
		.innerJoin(monitoredApplications, eq(monitoredApplications.id, screeningRoutineSelections.applicationId))
		.where(and(isNotNull(screeningRoutineSelections.routineId), isNull(screeningRoutineSelections.archivedAt)))

	if (activeSelections.length === 0) return []

	// Resolve each distinct app's effective sections once, then flag selections whose routine
	// section is not among them.
	const distinctAppIds = [...new Set(activeSelections.map((s) => s.applicationId))]
	const sectionIdsByApp = new Map<string, string[]>(
		await Promise.all(distinctAppIds.map(async (appId) => [appId, await getSectionIdsForApp(appId)] as const)),
	)

	return activeSelections
		.filter((s) => !(sectionIdsByApp.get(s.applicationId) ?? []).includes(s.routineSectionId))
		.map((s) => ({
			selectionId: s.selectionId,
			applicationId: s.applicationId,
			applicationName: s.applicationName,
			routineId: s.routineId,
			routineName: s.routineName,
			routineSectionId: s.routineSectionId,
			routineSectionName: s.routineSectionName,
			routineSectionSlug: s.routineSectionSlug,
			selectedBy: s.selectedBy,
			selectedAt: s.selectedAt.toISOString(),
		}))
}

export { RouteErrorBoundary as ErrorBoundary } from "~/components/RouteErrorBoundary"

export default function RutineSeksjonsavvik() {
	const { mismatches } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-8">
			<VStack gap="space-2">
				<Heading size="xlarge" level="2">
					Rutine-seksjonsavvik
				</Heading>
				<BodyLong>
					Viser aktive rutinevalg fra screening der valgt rutine tilhører en annen seksjon enn applikasjonen effektivt
					er i. Slike avvik kan stamme fra manglende seksjons-scoping i eldre versjoner av systemet (rettet i PR #769)
					og bør ryddes opp manuelt.
				</BodyLong>
			</VStack>

			<section className="admin-maintenance-card">
				<VStack gap="space-4">
					<Heading size="medium" level="3">
						Sammendrag
					</Heading>
					<Tag variant={mismatches.length > 0 ? "error" : "success"} size="small">
						{mismatches.length} avvik funnet
					</Tag>
				</VStack>
			</section>

			{mismatches.length === 0 ? (
				<BodyLong>Ingen avvik funnet. Alle aktive rutinevalg er i riktig seksjon for sin applikasjon.</BodyLong>
			) : (
				// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1
				<section className="table-scroll" tabIndex={0} aria-label="Rutine-seksjonsavvik">
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
								<Table.HeaderCell scope="col">Rutine</Table.HeaderCell>
								<Table.HeaderCell scope="col">Rutinens seksjon</Table.HeaderCell>
								<Table.HeaderCell scope="col">Valgt av</Table.HeaderCell>
								<Table.HeaderCell scope="col">Valgt</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{mismatches.map((m) => (
								<Table.Row key={m.selectionId}>
									<Table.DataCell>
										<DsLink as={Link} to={`/applikasjoner/${m.applicationId}/detaljer`}>
											{m.applicationName}
										</DsLink>
									</Table.DataCell>
									<Table.DataCell>
										<DsLink as={Link} to={`/seksjoner/${m.routineSectionSlug}/rutiner/${m.routineId}`}>
											{m.routineName}
										</DsLink>
									</Table.DataCell>
									<Table.DataCell>{m.routineSectionName}</Table.DataCell>
									<Table.DataCell>{m.selectedBy}</Table.DataCell>
									<Table.DataCell>{new Date(m.selectedAt).toLocaleString("nb-NO")}</Table.DataCell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				</section>
			)}
		</VStack>
	)
}
