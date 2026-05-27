import { BodyLong, Box, Button, Heading, VStack } from "@navikt/ds-react"

interface RetryableErrorViewProps {
	title: string
	message: string
}

/**
 * User-friendly error view for transient errors (retryable).
 * Shows a friendly message with a reload button.
 *
 * Used for:
 * - Database connection pool exhaustion
 * - API timeouts
 * - Rate limits
 * - Any other temporary service unavailability
 */
export function RetryableErrorView({ title, message }: RetryableErrorViewProps) {
	return (
		<Box padding="space-24">
			<VStack gap="space-6">
				<Heading size="xlarge" level="1">
					{title}
				</Heading>
				<BodyLong>{message}</BodyLong>
				<Button variant="primary" onClick={() => window.location.reload()}>
					Last siden på nytt
				</Button>
			</VStack>
		</Box>
	)
}
