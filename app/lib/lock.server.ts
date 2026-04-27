import { pool } from "../db/connection.server"

/**
 * PostgreSQL advisory lock for distributed coordination across multiple pods.
 *
 * Uses `pg_try_advisory_lock(key)` which is non-blocking — returns false if
 * another session already holds the lock. The lock is released when the
 * connection is returned to the pool (or explicitly via `pg_advisory_unlock`).
 *
 * Key convention: use a hash of the lock name to produce a bigint key.
 */

/** Convert a string to a stable 32-bit integer for use as an advisory lock key. */
function lockKey(name: string): number {
	let hash = 0
	for (let i = 0; i < name.length; i++) {
		hash = (hash * 31 + name.charCodeAt(i)) | 0
	}
	return hash
}

/**
 * Try to acquire an advisory lock and run `fn` exclusively.
 * If another pod already holds the lock, returns `null` without running `fn`.
 * If pool is unavailable (e.g. test environment), runs `fn` without locking.
 */
export async function withAdvisoryLock<T>(lockName: string, fn: () => Promise<T>): Promise<T | null> {
	if (!pool) {
		return await fn()
	}
	const key = lockKey(lockName)
	const client = await pool.connect()
	try {
		const { rows } = await client.query("SELECT pg_try_advisory_lock($1) AS acquired", [key])
		if (!rows[0]?.acquired) {
			return null
		}
		try {
			return await fn()
		} finally {
			await client.query("SELECT pg_advisory_unlock($1)", [key])
		}
	} finally {
		client.release()
	}
}
