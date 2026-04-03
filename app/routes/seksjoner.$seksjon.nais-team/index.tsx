import type { LoaderFunctionArgs } from "react-router"
import { redirect } from "react-router"

export async function loader({ params }: LoaderFunctionArgs) {
	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })
	return redirect(`/seksjoner/${seksjon}/rediger`)
}

export default function SeksjonNaisTeam() {
	return null
}
