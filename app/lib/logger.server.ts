import winston from "winston"

const isProd = process.env.NODE_ENV === "production"

const applicationVersion = typeof __BUILD_VERSION__ !== "undefined" ? __BUILD_VERSION__ : "unknown"

const MAX_FIELD_LENGTH = 4096

/** Truncate a string field to prevent massive log entries */
function truncate(value: string | undefined, max = MAX_FIELD_LENGTH): string | undefined {
	if (!value || value.length <= max) return value
	return `${value.substring(0, max)}… [truncated, total ${value.length} chars]`
}

/** Extract stack trace from a message string if accidentally embedded */
function extractStackTrace(message: string): { message: string; stack_trace?: string } {
	const stackPattern = /\n\s+at\s/
	const match = stackPattern.exec(message)
	if (match?.index) {
		return {
			message: message.substring(0, match.index).trim(),
			stack_trace: message.substring(match.index).trim(),
		}
	}
	return { message }
}

/** Collect the chain of error causes */
function collectCauses(error: Error): string[] {
	const causes: string[] = []
	let current: unknown = error.cause
	while (current) {
		if (current instanceof Error) {
			causes.push(current.message)
			current = current.cause
		} else {
			causes.push(String(current))
			break
		}
	}
	return causes
}

/** Custom format: separate stack traces and truncate oversized fields */
const separateStackTrace = winston.format((info) => {
	if (typeof info.message === "string") {
		const { message, stack_trace } = extractStackTrace(info.message)
		if (stack_trace) {
			info.message = message
			if (!info.stack_trace) {
				info.stack_trace = stack_trace
			}
		}
		info.message = truncate(info.message as string) ?? info.message
	}
	// Move Winston's native `stack` to `stack_trace` for consistency
	if (info.stack && !info.stack_trace) {
		info.stack_trace = info.stack
	}
	if (info.stack) {
		delete info.stack
	}
	// Truncate error and details fields
	if (typeof info.error === "string") {
		info.error = truncate(info.error)
	}
	if (typeof info.details === "string") {
		info.details = truncate(info.details)
	}
	return info
})

const winstonLogger = winston.createLogger({
	level: "debug",
	defaultMeta: { applicationVersion },
	format: isProd
		? winston.format.combine(
				winston.format.errors({ stack: true }),
				winston.format.timestamp(),
				separateStackTrace(),
				winston.format.json(),
			)
		: winston.format.combine(winston.format.colorize(), winston.format.simple()),
	transports: [new winston.transports.Console()],
})

export const logger = {
	info(message: string, details?: Record<string, unknown>) {
		winstonLogger.info(message, details)
	},
	warn(message: string, details?: Record<string, unknown>) {
		winstonLogger.warn(message, details)
	},
	error(message: string, errorOrDetails?: unknown) {
		if (errorOrDetails instanceof Error) {
			const meta: Record<string, unknown> = {
				error: truncate(errorOrDetails.message),
				stack_trace: errorOrDetails.stack,
			}
			const causes = collectCauses(errorOrDetails)
			if (causes.length > 0) {
				meta.cause = causes.length === 1 ? causes[0] : causes
			}
			winstonLogger.error(message, meta)
		} else if (errorOrDetails && typeof errorOrDetails === "object") {
			winstonLogger.error(message, errorOrDetails as Record<string, unknown>)
		} else if (errorOrDetails !== undefined) {
			winstonLogger.error(message, { details: String(errorOrDetails) })
		} else {
			winstonLogger.error(message)
		}
	},
	debug(message: string, details?: Record<string, unknown>) {
		winstonLogger.debug(message, details)
	},
}
