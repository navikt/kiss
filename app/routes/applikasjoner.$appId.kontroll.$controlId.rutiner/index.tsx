import { BodyShort, Box, Detail, Heading, HStack, Table, Tag, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getApplicationDetail } from "~/db/queries/nais.server"
import { getRoutineDeadlinesWithControls } from "~/db/queries/routine-deadlines.server"
import { calculateDeadline, getLatestReviewForApp, isOverdue } from "~/db/queries/routines.server"
import { useAppBasePath } from "~/hooks/useAppBasePath"
import type { RoutineFrequency } from "~/lib/routine-frequencies"
import { getFrequencyLabel } from "~/lib/routine-frequencies"

function formatDate(date: string | Date | null): string {
	if (!date) return "—"
	return new Date(date).toLocaleDateString("nb-NO")
}

const matchSourceLabels: Record<string, string> = {
	screening: "Screening",
	persistence: "Database/klassifisering",
	group_classification: "Tilgangsklassifisering",
	oracle_role_criticality: "Oracle-roller",
	screening_selection: "Spørsmålsvalg",
	section: "Gjelder hele seksjonen",
	ruleset: "Regelsett",
}

export async function loader({ params }: LoaderFunctionArgs) {
	const { appId, controlId } = params
	if (!appId || !controlId) throw data({ message: "Mangler parametere" }, { status: 400 })

	const [app, controlRow] = await Promise.all([
		getApplicationDetail(appId),
		(async () => {
			const { db } = await import("~/db/connection.server")
			const { frameworkControls } = await import("~/db/schema/framework")
			const { eq } = await import("drizzle-orm")
			const [row] = await db
				.select({
					id: frameworkControls.id,
					controlId: frameworkControls.controlId,
					shortTitle: frameworkControls.shortTitle,
				})
				.from(frameworkControls)
				.where(eq(frameworkControls.id, controlId))
				.limit(1)
			return row ?? null
		})(),
	])
	if (!app) throw data({ message: "Applikasjon ikke funnet" }, { status: 404 })
	if (!controlRow) throw data({ message: "Kontroll ikke funnet" }, { status: 404 })

	const control = {
		id: controlRow.id,
		controlId: controlRow.controlId,
		name: controlRow.shortTitle ?? controlRow.controlId,
	}

	const appInfo = { id: app.app.id, name: app.app.name }

	// Load all routine deadlines using shared pipeline
	const allDeadlines = await getRoutineDeadlinesWithControls(appId)

	// Filter deadlines to only routines linked to this control
	const matchedDeadlines = allDeadlines.filter((d) => d.routine && d.routine.controls.some((c) => c.id === controlId))

	// Resolve technology element names for matched routines
	const matchedRoutineIds = [...new Set(matchedDeadlines.map((d) => d.routine?.id).filter(Boolean) as string[])]
	const routineTechElementMap = new Map<string, string[]>()
	if (matchedRoutineIds.length > 0) {
		const { routineTechnologyElements } = await import("~/db/schema/routines")
		const { technologyElements } = await import("~/db/schema/framework")
		const { db } = await import("~/db/connection.server")
		const { inArray, eq, and, isNull } = await import("drizzle-orm")
		const techRows = await db
			.select({
				routineId: routineTechnologyElements.routineId,
				elementName: technologyElements.name,
			})
			.from(routineTechnologyElements)
			.innerJoin(technologyElements, eq(technologyElements.id, routineTechnologyElements.elementId))
			.where(
				and(
					inArray(routineTechnologyElements.routineId, matchedRoutineIds),
					isNull(routineTechnologyElements.archivedAt),
				),
			)
		for (const row of techRows) {
			const existing = routineTechElementMap.get(row.routineId) ?? []
			existing.push(row.elementName)
			routineTechElementMap.set(row.routineId, existing)
		}
	}

	// Enrich with latest review info for this app
	const routinesWithReviews = await Promise.all(
		matchedDeadlines.map(async (d) => {
			const routine = d.routine
			if (!routine) return null
			const latestReview = await getLatestReviewForApp(routine.id, appId)
			const lastReviewDate = latestReview?.reviewedAt ?? null
			const deadline = calculateDeadline(lastReviewDate, routine.createdAt, routine.frequency as RoutineFrequency)
			return {
				id: routine.id,
				name: routine.name,
				status: routine.status,
				frequency: routine.frequency,
				sectionId: routine.sectionId,
				matchSource: d.matchSource,
				lastReviewDate: lastReviewDate?.toISOString() ?? null,
				deadline: deadline.toISOString(),
				overdue: isOverdue(deadline),
				neverReviewed: !latestReview,
				technologyElements: routineTechElementMap.get(routine.id) ?? [],
			}
		}),
	)
	const validRoutines = routinesWithReviews.filter((r) => r !== null)

	// Load section slugs so we can build correct /seksjoner/:slug/ URLs
	const uniqueSectionIds = [...new Set(validRoutines.map((r) => r.sectionId))]
	const sectionSlugMap: Record<string, string> = {}
	if (uniqueSectionIds.length > 0) {
		const { db } = await import("~/db/connection.server")
		const { sections } = await import("~/db/schema/organization")
		const { inArray } = await import("drizzle-orm")
		const sectionRows = await db
			.select({ id: sections.id, slug: sections.slug })
			.from(sections)
			.where(inArray(sections.id, uniqueSectionIds))
		for (const row of sectionRows) {
			sectionSlugMap[row.id] = row.slug
		}
	}

	return data({
		app: appInfo,
		control: { id: control.id, controlId: control.controlId, name: control.name },
		routines: validRoutines,
		sectionSlugMap,
	})
}

export default function AppKontrollRutiner() {
	const { app, control, routines, sectionSlugMap } = useLoaderData<typeof loader>()
	const appBase = useAppBasePath()

	return (
		<VStack gap="space-12">
			<VStack gap="space-2">
				<Detail>
					<Link to={`${appBase}/detaljer?fane=kontroller`}>{app.name} / Kontroller</Link>
				</Detail>
				<Heading size="xlarge" level="2">
					Rutiner for {control.controlId}
				</Heading>
				<BodyShort textColor="subtle">{control.name}</BodyShort>
			</VStack>

			{routines.length === 0 ? (
				<Box padding="space-6" borderRadius="8" background="sunken">
					<BodyShort>Ingen rutiner er etablert for denne kontrollen for {app.name}.</BodyShort>
				</Box>
			) : (
				<VStack gap="space-4">
					<HStack gap="space-4" wrap>
						<Tag variant="success" size="small">
							{routines.length} {routines.length === 1 ? "rutine" : "rutiner"} etablert
						</Tag>
						{routines.some((r) => r.overdue) && (
							<Tag variant="error" size="small">
								{routines.filter((r) => r.overdue).length} forfalt
							</Tag>
						)}
						{routines.some((r) => r.neverReviewed) && (
							<Tag variant="warning" size="small">
								{routines.filter((r) => r.neverReviewed).length} ikke gjennomført
							</Tag>
						)}
					</HStack>

					<Table>
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Rutine</Table.HeaderCell>
								<Table.HeaderCell scope="col">Teknologielement</Table.HeaderCell>
								<Table.HeaderCell scope="col">Frekvens</Table.HeaderCell>
								<Table.HeaderCell scope="col">Kilde</Table.HeaderCell>
								<Table.HeaderCell scope="col">Siste gjennomgang</Table.HeaderCell>
								<Table.HeaderCell scope="col">Frist</Table.HeaderCell>
								<Table.HeaderCell scope="col">Status</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{routines.map((r) => (
								<Table.Row key={`${r.id}-${r.matchSource}`}>
									<Table.DataCell>
										<HStack gap="space-2" align="center" wrap>
											<Link to={`/seksjoner/${sectionSlugMap[r.sectionId] ?? r.sectionId}/rutiner/${r.id}`}>
												{r.name}
											</Link>
											{r.status === "approved" && (
												<Tag variant="success" size="xsmall">
													Godkjent
												</Tag>
											)}
										</HStack>
									</Table.DataCell>
									<Table.DataCell>
										{r.technologyElements.length > 0 ? (
											<HStack gap="space-2" wrap>
												{r.technologyElements.map((el) => (
													<Tag key={el} variant="info" size="xsmall">
														{el}
													</Tag>
												))}
											</HStack>
										) : (
											"—"
										)}
									</Table.DataCell>
									<Table.DataCell>{getFrequencyLabel(r.frequency)}</Table.DataCell>
									<Table.DataCell>
										<Tag variant="neutral" size="xsmall">
											{matchSourceLabels[r.matchSource] ?? r.matchSource}
										</Tag>
									</Table.DataCell>
									<Table.DataCell>{formatDate(r.lastReviewDate)}</Table.DataCell>
									<Table.DataCell>{formatDate(r.deadline)}</Table.DataCell>
									<Table.DataCell>
										{r.neverReviewed ? (
											<Tag variant="warning" size="xsmall">
												Ikke gjennomført
											</Tag>
										) : r.overdue ? (
											<Tag variant="error" size="xsmall">
												Forfalt
											</Tag>
										) : (
											<Tag variant="success" size="xsmall">
												OK
											</Tag>
										)}
									</Table.DataCell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				</VStack>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
