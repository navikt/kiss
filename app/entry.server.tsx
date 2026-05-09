import { PassThrough } from "node:stream"
import { createReadableStreamFromReadable } from "@react-router/node"
import { isbot } from "isbot"
import type { RenderToPipeableStreamOptions } from "react-dom/server"
import { renderToPipeableStream } from "react-dom/server"
import type { AppLoadContext, EntryContext } from "react-router"
import { ServerRouter } from "react-router"
import { runMigrations } from "~/db/migrate.server"
import { logger } from "~/lib/logger.server"
import { startUnifiedScheduler, stopUnifiedScheduler } from "~/lib/unified-scheduler.server"

// Run database migrations, then start background schedulers.
// The promise is awaited in handleRequest to block traffic until ready.
let migrationDone = false
const migrationPromise = runMigrations()
	.then(() => {
		migrationDone = true
		startUnifiedScheduler()
	})
	.catch((error) => {
		logger.error("Failed to run migrations, shutting down", error)
		// Exit immediately — do not let the catch resolve normally
		process.exit(1)
	})

// Graceful shutdown
process.on("SIGTERM", () => {
	logger.info("SIGTERM received — stopping scheduler")
	stopUnifiedScheduler()
})

export const streamTimeout = 5_000

export function handleError(error: unknown, { request }: { request: Request }) {
	if (request.signal.aborted) return

	const url = new URL(request.url)
	const path = `${request.method} ${url.pathname}`

	if (error instanceof Error) {
		logger.error(`[${path}] Unhandled error`, error)
	} else {
		logger.error(`[${path}] Unhandled error`, {
			error: String(error),
			path: url.pathname,
			method: request.method,
		})
	}
}

export default async function handleRequest(
	request: Request,
	responseStatusCode: number,
	responseHeaders: Headers,
	routerContext: EntryContext,
	_loadContext: AppLoadContext,
) {
	// Block until migrations complete. If they already finished, this resolves immediately.
	await migrationPromise
	if (!migrationDone) {
		return new Response("Service Unavailable — database migrations have not completed", {
			status: 503,
			headers: { "Retry-After": "5" },
		})
	}

	if (request.method.toUpperCase() === "HEAD") {
		return new Response(null, {
			status: responseStatusCode,
			headers: responseHeaders,
		})
	}

	return new Promise((resolve, reject) => {
		let shellRendered = false
		const userAgent = request.headers.get("user-agent")

		const readyOption: keyof RenderToPipeableStreamOptions =
			(userAgent && isbot(userAgent)) || routerContext.isSpaMode ? "onAllReady" : "onShellReady"

		let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(() => abort(), streamTimeout + 1_000)

		const { pipe, abort } = renderToPipeableStream(<ServerRouter context={routerContext} url={request.url} />, {
			[readyOption]() {
				shellRendered = true
				const body = new PassThrough({
					final(callback) {
						clearTimeout(timeoutId)
						timeoutId = undefined
						callback()
					},
				})
				const stream = createReadableStreamFromReadable(body)

				responseHeaders.set("Content-Type", "text/html")

				pipe(body)

				resolve(
					new Response(stream, {
						headers: responseHeaders,
						status: responseStatusCode,
					}),
				)
			},
			onShellError(error: unknown) {
				reject(error)
			},
			onError(error: unknown) {
				responseStatusCode = 500
				if (shellRendered) {
					logger.error("Stream render error", error instanceof Error ? error : { details: String(error) })
				}
			},
		})
	})
}
