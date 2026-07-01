import { redirect } from "react-router"
import type { Route } from "./+types/index"

export async function loader({ params }: Route.LoaderArgs) {
	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })
	return redirect(`/seksjoner/${seksjon}/rediger`)
}

export default function SeksjonNaisTeam() {
	return null
}
