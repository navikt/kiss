import path from "node:path"
import url from "node:url"
import { trace } from "@opentelemetry/api"
import { createRequestHandler } from "@react-router/express"
import compression from "compression"
import express from "express"
import winston from "winston"

const isProd = process.env.NODE_ENV === "production"

/** Custom format: ensure stack traces are never in the message field */
const separateStackTrace = winston.format((info) => {
	if (typeof info.message === "string") {
		const stackPattern = /\n\s+at\s/
		const match = stackPattern.exec(info.message)
		if (match?.index) {
			if (!info.stack_trace) {
				info.stack_trace = info.message.substring(match.index).trim()
			}
			info.message = info.message.substring(0, match.index).trim()
		}
	}
	if (info.stack && !info.stack_trace) {
		info.stack_trace = info.stack
	}
	if (info.stack) {
		delete info.stack
	}
	return info
})

const logger = winston.createLogger({
	level: "info",
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

const HEALTH_PATHS = new Set(["/api/isalive", "/api/isready"])

function accessLogMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
	const start = Date.now()

	res.on("finish", () => {
		if (HEALTH_PATHS.has(req.path)) return

		const duration = Date.now() - start

		// Skip static assets in production
		if (process.env.NODE_ENV === "production" && req.path.startsWith("/assets/")) return

		const span = trace.getActiveSpan()
		const traceId = span?.spanContext().traceId

		logger.info("request", {
			method: req.method,
			path: req.originalUrl,
			status: res.statusCode,
			duration_ms: duration,
			trace_id: traceId,
			user_agent: req.get("user-agent"),
			remote_addr: req.ip,
		})
	})

	next()
}

const app = express()
app.disable("x-powered-by")
app.use(compression())

const buildPath = path.resolve("build/server/index.js")
const buildDir = path.resolve("build/client")

// Static assets with immutable caching
app.use("/assets", express.static(path.join(buildDir, "assets"), { immutable: true, maxAge: "1y" }))
app.use(express.static(buildDir))
app.use(express.static("public", { maxAge: "1h" }))

// Structured access logging (after static to skip asset logs)
app.use(accessLogMiddleware)

// React Router request handler
const build = await import(url.pathToFileURL(buildPath).href)
app.all("/{*splat}", createRequestHandler({ build, mode: process.env.NODE_ENV }))

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
	logger.error("Unhandled server error", {
		error: err.message,
		stack_trace: err.stack,
	})
	if (!res.headersSent) {
		res.status(500).send("Internal Server Error")
	}
})

const port = Number(process.env.PORT) || 3000
const host = process.env.HOST || "0.0.0.0"

app.listen(port, host, () => {
	logger.info(`Server listening on http://${host}:${port}`)
})
