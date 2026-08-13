// Windows reserved device names (case-insensitive) — a file named e.g. "CON" or "CON.txt" cannot be created on Windows.
const WINDOWS_RESERVED_NAMES = new Set([
	"CON",
	"PRN",
	"AUX",
	"NUL",
	"COM1",
	"COM2",
	"COM3",
	"COM4",
	"COM5",
	"COM6",
	"COM7",
	"COM8",
	"COM9",
	"LPT1",
	"LPT2",
	"LPT3",
	"LPT4",
	"LPT5",
	"LPT6",
	"LPT7",
	"LPT8",
	"LPT9",
])

/**
 * Sanitizes a string for use as a filename or zip-entry segment, safe across macOS, Windows and Linux.
 * Whitelists letters (incl. norske tegn), digits, spaces, underscore and hyphen — everything else
 * (path separators, `: * ? " < > |`, dots etc.) is replaced with `_`. Also trims trailing
 * underscores/spaces (dots and other disallowed trailing characters become `_` before trimming,
 * which also avoids Windows' "no trailing dot or space" restriction) and guards against reserved
 * Windows device names (`CON`, `PRN`, `LPT1`, ...).
 */
export function sanitizeFilename(value: string, maxLength = 60): string {
	let safe = value
		.replace(/[^a-zA-Z0-9æøåÆØÅ _-]/g, "_")
		.trim()
		.replace(/[_ ]+$/, "")
		.slice(0, maxLength)
		.replace(/[_ ]+$/, "")

	if (safe.length === 0) safe = "_"
	if (WINDOWS_RESERVED_NAMES.has(safe.toUpperCase())) safe = `_${safe}`

	return safe
}
