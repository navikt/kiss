import { PassThrough } from "node:stream"
import { createReadableStreamFromReadable } from "@react-router/node"
import { isbot } from "isbot"
import type { RenderToPipeableStreamOptions } from "react-dom/server"
import { renderToPipeableStream } from "react-dom/server"
import type { AppLoadContext, EntryContext } from "react-router"
import { ServerRouter } from "react-router"
import { runMigrations } from "~/db/migrate.server"
import { logger } from "~/lib/logger.server"
import { startNaisScheduler } from "~/lib/nais-scheduler.server"

// Run database migrations, then start the Nais scheduler
runMigrations()
	.then(() => {
		startNaisScheduler()
	})
	.catch((error) => {
		logger.error("Failed to run migrations, shutting down", error)
		process.exit(1)
	})

export const streamTimeout = 5_000

export function handleError(error: unknown, { request }: { request: Request }) {
	if (request.signal.aborted) return

	const url = new URL(request.url)
	const path = `${request.method} ${url.pathname}`

	if (error instanceof Error) {
		logger.error(`[${path}] Unhandled error: ${error.message}`, {
			stack_trace: error.stack,
			path: url.pathname,
			method: request.method,
		})
	} else {
		logger.error(`[${path}] Unhandled error`, { details: String(error) })
	}
}

export default function handleRequest(
	request: Request,
	responseStatusCode: number,
	responseHeaders: Headers,
	routerContext: EntryContext,
	_loadContext: AppLoadContext,
) {
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
