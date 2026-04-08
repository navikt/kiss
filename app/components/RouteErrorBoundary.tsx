import { Alert, BodyLong, Box, Detail, Heading, VStack } from "@navikt/ds-react"
import { isRouteErrorResponse, Link, useRouteLoaderData } from "react-router"
import type { loader as rootLoader } from "~/root"

export function RouteErrorBoundary({ error }: { error: unknown }) {
	const rootData = useRouteLoaderData<typeof rootLoader>("root")
	const admin = rootData?.user?.isAdmin === true

	// React Router serialiserer errors over nettverket — de mister prototype
	const message =
		error instanceof Error
			? error.message
			: typeof error === "object" && error !== null && "message" in error
				? String((error as { message: unknown }).message)
				: "En uventet feil oppstod"
	const stack =
		error instanceof Error
			? error.stack
			: typeof error === "object" && error !== null && "stack" in error
				? String((error as { stack: unknown }).stack)
				: undefined

	if (isRouteErrorResponse(error)) {
		const errorMessage =
			typeof error.data === "object" && error.data !== null && "message" in error.data
				? String(error.data.message)
				: typeof error.data === "string"
					? error.data
					: error.statusText
		return (
			<Box padding="space-24">
				<VStack gap="space-6">
					<Heading size="xlarge" level="2">
						{error.status === 404 ? "Ikke funnet" : `Feil ${error.status}`}
					</Heading>
					<Alert variant="error">{errorMessage}</Alert>
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
				{admin && !stack && error != null ? (
					<Detail as="pre" style={{ whiteSpace: "pre-wrap", overflowX: "auto" }}>
						{typeof error === "object" ? JSON.stringify(error, null, 2) : String(error)}
					</Detail>
				) : null}
				<BodyLong>
					<Link to="/">Gå til forsiden</Link>
				</BodyLong>
			</VStack>
		</Box>
	)
}
