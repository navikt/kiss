import { isRouteErrorResponse } from "react-router"
import { DB_ERROR_TYPES, type DomainErrorData, ERROR_CATEGORIES } from "~/db/connection.server"

/**
 * Type guard for transient errors (retryable errors like pool exhaustion, timeouts, rate limits).
 *
 * Returns true if the error is a structured Response with category = TRANSIENT.
 * These errors should show a retry button in the UI.
 *
 * Validates all required DomainErrorData fields to ensure sound type narrowing —
 * callers depend on title and userMessage being strings.
 *
 * Works both server-side and client-side because React Router serializes
 * Response objects with their status and data intact.
 */
export function isTransientError(error: unknown): error is Response & { data: DomainErrorData } {
	return (
		isRouteErrorResponse(error) &&
		error.status === 503 &&
		typeof error.data === "object" &&
		error.data !== null &&
		"category" in error.data &&
		error.data.category === ERROR_CATEGORIES.TRANSIENT &&
		typeof error.data.title === "string" &&
		typeof error.data.userMessage === "string"
	)
}

/**
 * Type guard for database pool exhaustion errors specifically.
 * More specific than isTransientError() — useful for testing or specific handling.
 */
export function isDbPoolError(error: unknown): error is Response & { data: DomainErrorData } {
	return (
		isTransientError(error) &&
		(error.data.errorType === DB_ERROR_TYPES.POOL_EXHAUSTED || error.data.errorType === DB_ERROR_TYPES.POOL_TIMEOUT)
	)
}
