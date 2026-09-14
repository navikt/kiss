import { BodyShort, Box, Heading, Table, Tag, VStack } from "@navikt/ds-react"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { UserDisplayName } from "~/components/UserDisplayName"
import { getAppScopeIdsForApps } from "~/db/queries/applications.server"
import { getCompletedReviewsForSection } from "~/db/queries/routines.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { getUserNamesByNavIdents } from "~/db/queries/users.server"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { hasReviewReadAccess, isAdmin, isAuditor } from "~/lib/authorization.server"
import type { Route } from "./+types/index"

function formatDate(date: string | Date | null): string {
	if (!date) return "—"
	return new Date(date).toLocaleDateString("nb-NO")
}

export async function loader({ params, request }: Route.LoaderArgs) {
	const { seksjon } = params
	if (!seksjon) {
		throw data({ message: "Mangler seksjonsparameter" }, { status: 400 })
	}

	const authedUser = await requireAuthenticatedUser(request)

	const section = await getSectionBySlug(seksjon)
	if (!section) {
		throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })
	}

	const allReviews = await getCompletedReviewsForSection(section.id)

	// Admin/auditor see everything regardless of app scope, so the batch lookup below
	// would only spend DB queries to compute a result that's discarded by hasReviewReadAccess.
	const isPrivilegedUser = isAdmin(authedUser) || isAuditor(authedUser)

	// Resolve dev-team scope for every distinct application in one batch, instead of
	// calling getAppScopeIds() per review — a section can have reviews for many apps.
	const uniqueAppIds = isPrivilegedUser
		? []
		: [...new Set(allReviews.flatMap((r) => (r.applicationId ? [r.applicationId] : [])))]
	const scopeByAppId = await getAppScopeIdsForApps(uniqueAppIds)

	// Several completed reviews can share the same application; cache the access
	// check per application so hasReviewReadAccess() isn't re-evaluated for each review.
	const accessByScope = new Map<string, Promise<boolean>>()
	const cacheKeyFor = (applicationId: string | null) =>
		applicationId ? `app:${applicationId}` : `section:${section.id}`
	const checkAccess = (applicationId: string | null) => {
		const cacheKey = cacheKeyFor(applicationId)
		let access = accessByScope.get(cacheKey)
		if (!access) {
			const preloadedDevTeamIds = applicationId ? scopeByAppId.get(applicationId)?.devTeamIds : undefined
			access = hasReviewReadAccess(authedUser, { applicationId, sectionId: section.id }, preloadedDevTeamIds)
			accessByScope.set(cacheKey, access)
		}
		return access
	}

	const accessFlags = await Promise.all(allReviews.map((review) => checkAccess(review.applicationId)))
	const reviews = allReviews.filter((_, i) => accessFlags[i])

	const reviewerNames = await getUserNamesByNavIdents(reviews.map((r) => r.createdBy))
	const reviewsWithNames = reviews.map((r) => ({
		...r,
		createdByName: reviewerNames.get(r.createdBy.trim().toUpperCase()) ?? null,
	}))

	return data({
		section,
		reviews: reviewsWithNames,
	})
}

export default function GjennomforteRutiner() {
	const { section, reviews } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-8">
			<Heading size="xlarge" level="2" spacing>
				Gjennomførte rutinegjennomganger — {section.name}
			</Heading>

			{reviews.length === 0 ? (
				<Box padding="space-6" borderRadius="8" background="sunken">
					<BodyShort>Ingen gjennomganger er registrert for denne seksjonen ennå.</BodyShort>
				</Box>
			) : (
				<Table>
					<Table.Header>
						<Table.Row>
							<Table.HeaderCell>Dato</Table.HeaderCell>
							<Table.HeaderCell>Rutine</Table.HeaderCell>
							<Table.HeaderCell>Applikasjon</Table.HeaderCell>
							<Table.HeaderCell>Tittel</Table.HeaderCell>
							<Table.HeaderCell>Opprettet av</Table.HeaderCell>
							<Table.HeaderCell>Deltakere</Table.HeaderCell>
							<Table.HeaderCell>Vedlegg</Table.HeaderCell>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{reviews.map((review) => {
							const confirmedCount = review.participants.filter((p) => p.confirmedAt).length
							return (
								<Table.Row key={review.id}>
									<Table.DataCell>{formatDate(review.reviewedAt)}</Table.DataCell>
									<Table.DataCell>
										<Link to={`../${review.routineId}`}>{review.routineName}</Link>
									</Table.DataCell>
									<Table.DataCell>
										{review.applicationId ? (
											<Link to={`/applikasjoner/${review.applicationId}/detaljer`}>{review.applicationName}</Link>
										) : (
											"—"
										)}
									</Table.DataCell>
									<Table.DataCell>{review.title}</Table.DataCell>
									<Table.DataCell>
										<UserDisplayName navIdent={review.createdBy} name={review.createdByName} />
									</Table.DataCell>
									<Table.DataCell>
										{review.participants.length > 0
											? `${review.participants.length} (${confirmedCount} bekreftet)`
											: "—"}
									</Table.DataCell>
									<Table.DataCell>
										{review.attachments.length > 0 ? (
											<Tag variant="info" size="small">
												{review.attachments.length}
											</Tag>
										) : (
											"0"
										)}
									</Table.DataCell>
								</Table.Row>
							)
						})}
					</Table.Body>
				</Table>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
