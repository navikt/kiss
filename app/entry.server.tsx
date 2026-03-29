import { renderToString } from "react-dom/server"
import type { AppLoadContext, EntryContext } from "react-router"
import { type HandleDocumentRequestFunction, ServerRouter } from "react-router"

const handleRequest: HandleDocumentRequestFunction = (
	request: Request,
	responseStatusCode: number,
	responseHeaders: Headers,
	routerContext: EntryContext,
	_loadContext: AppLoadContext,
) => {
	const html = renderToString(<ServerRouter context={routerContext} url={request.url} />)

	responseHeaders.set("Content-Type", "text/html")

	return new Response(`<!DOCTYPE html>${html}`, {
		headers: responseHeaders,
		status: responseStatusCode,
	})
}

export default handleRequest
