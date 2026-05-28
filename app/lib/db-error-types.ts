/**
 * Error categories — determines how the UI should handle the error.
 * Kept in a client-safe file so error boundaries can import without pulling in server code.
 */
export const ERROR_CATEGORIES = {
	/** Temporary error that may resolve on retry (e.g., pool exhaustion, timeout, rate limit) */
	TRANSIENT: "TRANSIENT",
	/** Permanent error that won't resolve on retry (e.g., constraint violation, not found) */
	PERMANENT: "PERMANENT",
	/** Authentication/authorization error */
	AUTHENTICATION: "AUTHENTICATION",
} as const

export type ErrorCategory = (typeof ERROR_CATEGORIES)[keyof typeof ERROR_CATEGORIES]

/**
 * Database error types — specific error codes within a category.
 */
export const DB_ERROR_TYPES = {
	POOL_EXHAUSTED: "DB_POOL_EXHAUSTED",
	POOL_TIMEOUT: "DB_POOL_TIMEOUT",
} as const

export type DbErrorType = (typeof DB_ERROR_TYPES)[keyof typeof DB_ERROR_TYPES]

/**
 * Domain error data structure — structured errors thrown by the data access layer.
 * Allows the presentation layer to render appropriate UI without knowing infrastructure details.
 */
export interface DomainErrorData {
	/** Error category — determines UI treatment (retry button, auth prompt, etc.) */
	category: ErrorCategory
	/** Specific error type within the category (e.g., DB_POOL_TIMEOUT) */
	errorType: string
	/** User-facing title for the error (e.g., "Midlertidig overbelastet") */
	title: string
	/** User-facing message explaining the error */
	userMessage: string
}
