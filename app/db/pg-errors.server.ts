/**
 * Felles hjelpere for gjenkjenning av Postgres-feilkoder.
 *
 * Drizzle kan innkapsle Postgres-feil i en DrizzleQueryError med { cause: pgError }.
 * Alle funksjoner her håndterer begge tilfeller.
 *
 * Referanse: https://www.postgresql.org/docs/current/errcodes-appendix.html
 */

/** Postgres-feilkoder brukt i kodebasen */
export const PgErrorCode = {
	/** Brudd på unik constraint (duplicate key) */
	UNIQUE_VIOLATION: "23505",
	/** Brudd på fremmednøkkel-constraint */
	FOREIGN_KEY_VIOLATION: "23503",
	/** NOT NULL-brudd */
	NOT_NULL_VIOLATION: "23502",
	/** Brudd på check-constraint */
	CHECK_VIOLATION: "23514",
	/** Raise exception fra PL/pgSQL (f.eks. advisory lock / applikasjonslogikk) */
	RAISE_EXCEPTION: "P0001",
} as const

export type PgErrorCode = (typeof PgErrorCode)[keyof typeof PgErrorCode]

/**
 * Returnerer true dersom feilen er en Postgres-feil med den gitte koden.
 * Håndterer både direkte pg-feil og Drizzle-innkapslede feil ({ cause: pgError }).
 */
export function hasPostgresCode(error: unknown, code: string): boolean {
	if (typeof error !== "object" || error === null) return false
	const err = error as { code?: unknown; cause?: { code?: unknown } }
	return err.code === code || err.cause?.code === code
}

/**
 * Returnerer true dersom feilen er en unique_violation (23505).
 * Vanlig ved race conditions der to samtidige operasjoner prøver å sette inn samme rad.
 */
export function isUniqueViolation(error: unknown): boolean {
	return hasPostgresCode(error, PgErrorCode.UNIQUE_VIOLATION)
}

/**
 * Returnerer true dersom feilen er en foreign_key_violation (23503).
 */
export function isForeignKeyViolation(error: unknown): boolean {
	return hasPostgresCode(error, PgErrorCode.FOREIGN_KEY_VIOLATION)
}

/**
 * Returnerer true dersom feilen er en not_null_violation (23502).
 */
export function isNotNullViolation(error: unknown): boolean {
	return hasPostgresCode(error, PgErrorCode.NOT_NULL_VIOLATION)
}
