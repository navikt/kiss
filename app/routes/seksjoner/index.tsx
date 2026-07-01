import { BodyLong, Button, Heading, HGrid, HStack, VStack } from "@navikt/ds-react"
import { useState } from "react"
import { data, Link, useLoaderData } from "react-router"
import { OpprettSeksjonModal } from "~/components/OpprettSeksjonModal"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getSections } from "~/db/queries/sections.server"
import { getAuthenticatedUser } from "~/lib/auth.server"
import { isAdmin } from "~/lib/authorization.server"
import type { Route } from "./+types/index"

export async function loader({ request }: Route.LoaderArgs) {
	const user = await getAuthenticatedUser(request)
	const sections = await getSections()
	return data({ sections, canCreateSection: user !== null && isAdmin(user) })
}

export default function Seksjoner() {
	const { sections, canCreateSection } = useLoaderData<typeof loader>()
	const [opprettOpen, setOpprettOpen] = useState(false)

	return (
		<VStack gap="space-6">
			<HStack justify="space-between" align="center">
				<Heading size="xlarge" level="2">
					Seksjoner
				</Heading>
				{canCreateSection && (
					<Button variant="primary" onClick={() => setOpprettOpen(true)}>
						Opprett seksjon
					</Button>
				)}
			</HStack>
			<BodyLong>Oversikt over seksjoner, klynger og utviklingsteam.</BodyLong>

			{canCreateSection && opprettOpen && <OpprettSeksjonModal open onClose={() => setOpprettOpen(false)} />}

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
