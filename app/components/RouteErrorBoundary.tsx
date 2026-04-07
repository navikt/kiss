import { Alert, BodyLong, Box, Detail, Heading, VStack } from "@navikt/ds-react"
import { isRouteErrorResponse, Link, useRouteLoaderData } from "react-router"
import type { loader as rootLoader } from "~/root"

function useIsAdmin(): boolean {
	try {
		const data = useRouteLoaderData<typeof rootLoader>("root")
		return data?.user?.isAdmin === true
	} catch {
		return false
	}
}

export function RouteErrorBoundary({ error }: { error: unknown }) {
	const admin = useIsAdmin()
	const stack = error instanceof Error ? error.stack : undefined

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
				{admin && stack && (
					<Detail as="pre" style={{ whiteSpace: "pre-wrap", overflowX: "auto" }}>
						{stack}
					</Detail>
				)}
				<BodyLong>
					<Link to="/">Gå til forsiden</Link>
				</BodyLong>
			</VStack>
		</Box>
	)
}
