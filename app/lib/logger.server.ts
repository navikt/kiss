import winston from "winston"

const isProd = process.env.NODE_ENV === "production"

const applicationVersion = typeof __BUILD_VERSION__ !== "undefined" ? __BUILD_VERSION__ : "unknown"

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

/** Custom format: ensure stack traces are never in the message field */
const separateStackTrace = winston.format((info) => {
	if (typeof info.message === "string") {
		const { message, stack_trace } = extractStackTrace(info.message)
		if (stack_trace) {
			info.message = message
			if (!info.stack_trace) {
				info.stack_trace = stack_trace
			}
		}
	}
	// Move Winston's native `stack` to `stack_trace` for consistency
	if (info.stack && !info.stack_trace) {
		info.stack_trace = info.stack
	}
	if (info.stack) {
		delete info.stack
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
			winstonLogger.error(message, {
				error: errorOrDetails.message,
				stack_trace: errorOrDetails.stack,
			})
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
