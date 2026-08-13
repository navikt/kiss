/**
 * Returns a Date whose *local* getters (`getHours`, `getDate`, ...) yield the wall-clock time
 * in Europe/Oslo, regardless of the server process's own timezone (`TZ` env var).
 *
 * Zip libraries (archiver/zip-stream, JSZip) store entry timestamps by reading the local
 * date/time components of the `Date` object they're given — they don't store a timezone offset.
 * If the process runs with e.g. `TZ=UTC` (common in containers unless explicitly configured),
 * a plain `new Date()` would be stored using UTC components, making entries appear a couple of
 * hours off once extracted on a machine in Norwegian time. Pre-converting to Oslo wall-clock time
 * here makes zip timestamps correct independent of the container's `TZ` setting.
 */
export function zipEntryDate(date: Date = new Date()): Date {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: "Europe/Oslo",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	}).formatToParts(date)

	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)

	return new Date(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"))
}
