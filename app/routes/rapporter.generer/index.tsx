import { Button, Heading, Select, VStack } from "@navikt/ds-react"
import { useState } from "react"
import type { ActionFunctionArgs } from "react-router"
import { data, Form, useActionData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"

export async function action({ request }: ActionFunctionArgs) {
	const formData = await request.formData()
	const scope = formData.get("scope")
	const seksjon = formData.get("seksjon")

	if (typeof scope !== "string" || !scope) {
		throw new Response("Mangler rapportomfang", { status: 400 })
	}

	// Placeholder – will generate actual report
	return data({
		success: true,
		message:
			scope === "alle"
				? "Rapport generert for alle seksjoner."
				: `Rapport generert for seksjon: ${typeof seksjon === "string" ? seksjon : "ukjent"}.`,
	})
}

export default function GenererRapport() {
	const actionData = useActionData<typeof action>()
	const [scope, setScope] = useState("alle")

	return (
		<VStack gap="space-8">
			<Heading size="xlarge" level="2">
				Generer rapport
			</Heading>

			{actionData?.success && (
				<div className="compliance-success" role="status">
					{actionData.message}
				</div>
			)}

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
							<option value="utvikling">Utvikling</option>
							<option value="infrastruktur">Infrastruktur</option>
							<option value="sikkerhet">Sikkerhet</option>
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
