import { Button, Heading, Select, VStack } from "@navikt/ds-react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, redirect, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { generateComplianceReport } from "~/db/queries/reports.server"
import { getSections } from "~/db/queries/sections.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAuditor } from "~/lib/authorization.server"

export async function loader({ request }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAuditor(authedUser)

	const sections = await getSections()
	return data({
		sections: sections.map((s) => ({ id: s.id, name: s.name })),
	})
}

export async function action({ request }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAuditor(authedUser)

	const formData = await request.formData()
	const scope = formData.get("scope")

	if (typeof scope !== "string" || !scope) {
		throw new Response("Mangler rapportomfang", { status: 400 })
	}

	const resolvedScope = scope === "seksjon" ? "section" : "all"
	const scopeId = resolvedScope === "section" ? (formData.get("seksjon") as string) || undefined : undefined

	if (resolvedScope === "section" && !scopeId) {
		throw new Response("Velg en seksjon", { status: 400 })
	}

	const reportId = await generateComplianceReport({
		scope: resolvedScope,
		scopeId,
		createdBy: authedUser.navIdent,
	})

	return redirect(`/rapporter/${reportId}`)
}

export default function GenererRapport() {
	const { sections } = useLoaderData<typeof loader>()
	const [scope, setScope] = useState("alle")

	return (
		<VStack gap="space-8">
			<Heading size="xlarge" level="2">
				Generer rapport
			</Heading>

			<Form method="post">
				<VStack gap="space-6">
					<Select label="Rapportomfang" name="scope" value={scope} onChange={(e) => setScope(e.target.value)}>
						<option value="alle">Alle seksjoner</option>
						<option value="seksjon">Seksjon</option>
					</Select>

					{scope === "seksjon" && (
						<Select label="Velg seksjon" name="seksjon">
							<option value="" disabled>
								Velg seksjon
							</option>
							{sections.map((s) => (
								<option key={s.id} value={s.id}>
									{s.name}
								</option>
							))}
						</Select>
					)}

					<div>
						<Button type="submit" variant="primary">
							Generer rapport
						</Button>
					</div>
				</VStack>
			</Form>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
