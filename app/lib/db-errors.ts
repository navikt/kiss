import { isRouteErrorResponse } from "react-router"
import { DB_ERROR_TYPES, DbPoolError, type DomainErrorData, ERROR_CATEGORIES } from "~/lib/db-error-types"

function isSerializedTransientDomainError(error: unknown): error is DomainErrorData & { isDomainError?: true } {
	return (
		typeof error === "object" &&
		error !== null &&
		"isDomainError" in error &&
		error.isDomainError === true &&
		"category" in error &&
		error.category === ERROR_CATEGORIES.TRANSIENT &&
		"errorType" in error &&
		typeof error.errorType === "string" &&
		"title" in error &&
		typeof error.title === "string" &&
		"userMessage" in error &&
		typeof error.userMessage === "string"
	)
}

/**
 * Extracts transient error info from any error value, handling both:
 * - DbPoolError (thrown from pool.connect() — a real Error, works outside request handlers)
 * - Route error responses (status 503 + TRANSIENT category — from React Router data() in older code)
 *
 * Returns null if the error is not a transient error.
 */
export function getTransientErrorInfo(error: unknown): DomainErrorData | null {
	if (error instanceof DbPoolError && error.category === ERROR_CATEGORIES.TRANSIENT) {
		return {
			category: error.category,
			errorType: error.errorType,
			title: error.title,
			userMessage: error.userMessage,
		}
	}
	if (isSerializedTransientDomainError(error)) {
		return {
			category: error.category,
			errorType: error.errorType,
			title: error.title,
			userMessage: error.userMessage,
		}
	}
	if (
		isRouteErrorResponse(error) &&
		error.status === 503 &&
		typeof error.data === "object" &&
		error.data !== null &&
		"category" in error.data &&
		error.data.category === ERROR_CATEGORIES.TRANSIENT &&
		typeof error.data.title === "string" &&
		typeof error.data.userMessage === "string"
	) {
		return error.data as DomainErrorData
	}
	return null
}

/**
 * Type guard for transient errors (retryable errors like pool exhaustion, timeouts, rate limits).
 * Use getTransientErrorInfo() to get the error data for rendering.
 */
export function isTransientError(error: unknown): boolean {
	return getTransientErrorInfo(error) !== null
}

/**
 * Type guard for database pool exhaustion errors specifically.
 * More specific than isTransientError() — useful for testing or specific handling.
 */
export function isDbPoolError(error: unknown): boolean {
	const info = getTransientErrorInfo(error)
	return (
		info !== null &&
		(info.errorType === DB_ERROR_TYPES.POOL_EXHAUSTED || info.errorType === DB_ERROR_TYPES.POOL_TIMEOUT)
	)
}
