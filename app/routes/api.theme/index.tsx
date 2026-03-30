import type { ActionFunctionArgs } from "react-router"
import { redirect } from "react-router"

export async function action({ request }: ActionFunctionArgs) {
	const formData = await request.formData()
	const theme = formData.get("theme") === "dark" ? "dark" : "light"
	const referer = request.headers.get("Referer") ?? "/"

	return redirect(referer, {
		headers: {
			"Set-Cookie": `kiss-theme=${theme}; SameSite=Lax; Path=/; Max-Age=31536000; HttpOnly`,
		},
	})
}
