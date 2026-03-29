import { PencilIcon } from "@navikt/aksel-icons"
import { BodyLong, BodyShort, Button, Detail, Heading, HStack, List, TextField, VStack } from "@navikt/ds-react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getRiskDetail, updateRiskShortTitle } from "~/db/queries/framework.server"
import { getAuthenticatedUser } from "~/lib/auth.server"

/** Parse risk description into sections: first paragraph = description, bullet lines = consequences. */
function parseDescription(text: string): { description: string; consequences: string[] } {
	const lines = text.split("\n").map((l) => l.trim())
	const descLines: string[] = []
	const consequences: string[] = []
	let inBullets = false

	for (const line of lines) {
		if (line.startsWith("•") || line.startsWith("-") || line.startsWith("*")) {
			inBullets = true
			consequences.push(line.replace(/^[•\-*]\s*/, ""))
		} else if (inBullets && line) {
			consequences.push(line)
		} else if (!inBullets && line) {
			descLines.push(line)
		}
	}

	return {
		description: descLines.join(" "),
		consequences,
	}
}

function controlColor(index: number, total: number): string {
	const t = total <= 1 ? 0 : index / (total - 1)
	const r = Math.round(200 - t * 30)
	const g = Math.round(215 - t * 30)
	const b = Math.round(235 - t * 20)
	return `rgb(${r}, ${g}, ${b})`
}

export async function loader({ params }: LoaderFunctionArgs) {
	const risikoId = params.risikoId?.toUpperCase()
	if (!risikoId) throw new Response("Mangler risiko-ID", { status: 400 })

	const risk = await getRiskDetail(risikoId)
	if (!risk) throw new Response("Risiko ikke funnet", { status: 404 })

	return data({ risk })
}

export async function action({ request, params }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const userName = user?.navIdent ?? "system"
	const risikoId = params.risikoId?.toUpperCase()
	if (!risikoId) return data({ error: "Mangler risiko-ID" }, { status: 400 })

	const formData = await request.formData()
	const shortTitle = formData.get("shortTitle") as string

	try {
		await updateRiskShortTitle(risikoId, shortTitle, userName)
		return data({ success: true })
	} catch (err) {
		return data({ error: err instanceof Error ? err.message : "Ukjent feil" }, { status: 500 })
	}
}

export default function RiskDetailPage() {
	const { risk } = useLoaderData<typeof loader>()
	const [editing, setEditing] = useState(false)
	const [titleValue, setTitleValue] = useState(risk.name)
	const parsed = parseDescription(risk.description)

	return (
		<VStack gap="space-8">
			<VStack gap="space-2">
				<Detail>
					<Link to="/kontrollrammeverk">Kontrollrammeverk</Link> /{" "}
					<Link to={`/kontrollrammeverk/${risk.domainCode}`}>{risk.domainName}</Link> / Risiko
				</Detail>
				{editing ? (
					<Form method="post" onSubmit={() => setEditing(false)}>
						<HStack gap="space-2" align="end" wrap={false}>
							<TextField
								label={`Kort tittel for ${risk.riskId}`}
								hideLabel
								size="small"
								name="shortTitle"
								value={titleValue}
								onChange={(e) => setTitleValue(e.target.value)}
								autoFocus
							/>
							<Button type="submit" variant="primary" size="small">
								Lagre
							</Button>
							<Button
								type="button"
								variant="tertiary"
								size="small"
								onClick={() => {
									setTitleValue(risk.name)
									setEditing(false)
								}}
							>
								Avbryt
							</Button>
						</HStack>
					</Form>
				) : (
					<HStack gap="space-2" align="center">
						<Heading size="xlarge" level="2">
							{risk.riskId}: {risk.name}
						</Heading>
						<Button
							type="button"
							variant="tertiary-neutral"
							size="small"
							icon={<PencilIcon aria-hidden />}
							onClick={() => setEditing(true)}
							aria-label={`Rediger kort tittel for ${risk.riskId}`}
						/>
					</HStack>
				)}
			</VStack>

			<hr style={{ border: "none", borderTop: "1px solid var(--ax-border-subtle)" }} />

			<VStack gap="space-6">
				<VStack gap="space-4">
					<Heading size="large" level="3">
						Risikobeskrivelse
					</Heading>
					<BodyLong>{parsed.description}</BodyLong>
				</VStack>

				{parsed.consequences.length > 0 && (
					<VStack gap="space-4">
						<Heading size="large" level="3">
							Konsekvenser
						</Heading>
						<List>
							{parsed.consequences.map((c) => (
								<List.Item key={c}>{c}</List.Item>
							))}
						</List>
					</VStack>
				)}

				{risk.controls.length > 0 && (
					<VStack gap="space-4">
						<Heading size="large" level="3">
							Mitigerende kontroller
						</Heading>
						<div className="framework-card-grid">
							{risk.controls.map((ctrl, i) => (
								<Link
									key={ctrl.id}
									to={`/kontrollrammeverk/${ctrl.domainCode}/${ctrl.id}`}
									className="framework-card"
									style={{ backgroundColor: controlColor(i, risk.controls.length) }}
								>
									<BodyShort size="small" className="framework-card-id">
										{ctrl.id}
									</BodyShort>
									<Heading size="small" level="4" className="framework-card-title">
										{ctrl.name}
									</Heading>
								</Link>
							))}
						</div>
					</VStack>
				)}
			</VStack>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
