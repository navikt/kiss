import { describe, expect, it } from "vitest"
import { DB_ERROR_TYPES, DbPoolError, type DomainErrorData, ERROR_CATEGORIES } from "~/lib/db-error-types"
import { getTransientErrorInfo, isDbPoolError, isTransientError } from "~/lib/db-errors"

describe("db-errors", () => {
	const transientDomainError: DomainErrorData = {
		category: ERROR_CATEGORIES.TRANSIENT,
		errorType: DB_ERROR_TYPES.POOL_TIMEOUT,
		title: "Midlertidig overbelastet",
		userMessage: "Prøv igjen om litt.",
	}

	it("recognizes transient DbPoolError instances", () => {
		const error = new DbPoolError(transientDomainError, 503)

		expect(getTransientErrorInfo(error)).toEqual(transientDomainError)
		expect(isTransientError(error)).toBe(true)
		expect(isDbPoolError(error)).toBe(true)
	})

	it("recognizes serialized transient DbPoolError objects", () => {
		const serializedError = JSON.parse(JSON.stringify(new DbPoolError(transientDomainError, 503))) as unknown

		expect(getTransientErrorInfo(serializedError)).toEqual(transientDomainError)
		expect(isTransientError(serializedError)).toBe(true)
		expect(isDbPoolError(serializedError)).toBe(true)
	})
})
