import { Alert, BodyLong, Box, Heading, VStack } from "@navikt/ds-react"
import { isRouteErrorResponse, Link } from "react-router"

export function RouteErrorBoundary({ error }: { error: unknown }) {
	if (isRouteErrorResponse(error)) {
		return (
			<Box padding="space-24">
				<VStack gap="space-6">
					<Heading size="xlarge" level="2">
						{error.status === 404 ? "Ikke funnet" : `Feil ${error.status}`}
					</Heading>
					<Alert variant="error">{typeof error.data === "string" ? error.data : error.statusText}</Alert>
					<BodyLong>
						<Link to="/">Gå til forsiden</Link>
					</BodyLong>
				</VStack>
			</Box>
		)
	}

	const message = error instanceof Error ? error.message : "En uventet feil oppstod"

	return (
		<Box padding="space-24">
			<VStack gap="space-6">
				<Heading size="xlarge" level="2">
					Noe gikk galt
				</Heading>
				<Alert variant="error">{message}</Alert>
				<BodyLong>
					<Link to="/">Gå til forsiden</Link>
				</BodyLong>
			</VStack>
		</Box>
	)
}
