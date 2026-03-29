import { BodyLong, Heading, HGrid, VStack } from "@navikt/ds-react"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getSections } from "~/db/queries/sections.server"

export async function loader() {
	const sections = await getSections()
	return data({ sections })
}

export default function Seksjoner() {
	const { sections } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-6">
			<Heading size="xlarge" level="2">
				Seksjoner
			</Heading>
			<BodyLong>Oversikt over seksjoner, klynger og utviklingsteam.</BodyLong>

			{sections.length > 0 ? (
				<HGrid gap="space-6" columns={{ xs: 1, sm: 2, md: 3 }}>
					{sections.map((section) => (
						<Link
							key={section.id}
							to={`/seksjoner/${section.slug}`}
							style={{ textDecoration: "none", color: "inherit" }}
						>
							<div className="domain-status-card">
								<div className="domain-status-header">
									<Heading size="small" level="3">
										{section.name}
									</Heading>
								</div>
								{section.description && <BodyLong size="small">{section.description}</BodyLong>}
							</div>
						</Link>
					))}
				</HGrid>
			) : (
				<BodyLong>Ingen seksjoner funnet.</BodyLong>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
