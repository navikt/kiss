export function loader() {
	return new Response("ok", { status: 200, headers: { "Content-Type": "text/plain" } })
}
