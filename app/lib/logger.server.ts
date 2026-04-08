import winston from "winston"

const isProd = process.env.NODE_ENV === "production"

const applicationVersion = typeof __BUILD_VERSION__ !== "undefined" ? __BUILD_VERSION__ : "unknown"

const winstonLogger = winston.createLogger({
	level: "debug",
	defaultMeta: { applicationVersion },
	format: isProd
		? winston.format.combine(winston.format.timestamp(), winston.format.json())
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
		} else {
			winstonLogger.error(message)
		}
	},
	debug(message: string, details?: Record<string, unknown>) {
		winstonLogger.debug(message, details)
	},
}
