import { BodyLong, BodyShort, Heading, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAllControls, getAllRisks } from "~/db/queries/framework.server"

/** Gradient from light pink to deeper mauve, based on position in the list. */
function riskColor(index: number, total: number): string {
	const t = total <= 1 ? 0 : index / (total - 1)
	const r = Math.round(235 - t * 30)
	const g = Math.round(200 - t * 50)
	const b = Math.round(210 - t * 30)
	return `rgb(${r}, ${g}, ${b})`
}

function controlColor(index: number, total: number): string {
	const t = total <= 1 ? 0 : index / (total - 1)
	const r = Math.round(200 - t * 30)
	const g = Math.round(215 - t * 30)
	const b = Math.round(235 - t * 20)
	return `rgb(${r}, ${g}, ${b})`
}

/** Group items by their domainName, merging domains with same name. */
function groupByDomain<T extends { domainCode: string; domainName: string }>(
	items: T[],
): { domainName: string; items: T[] }[] {
	const groups = new Map<string, { domainName: string; items: T[] }>()
	for (const item of items) {
		let group = groups.get(item.domainName)
		if (!group) {
			group = { domainName: item.domainName, items: [] }
			groups.set(item.domainName, group)
		}
		group.items.push(item)
	}
	return [...groups.values()]
}

export async function loader(_args: LoaderFunctionArgs) {
	const [risks, controls] = await Promise.all([getAllRisks(), getAllControls()])
	return data({ risks, controls })
}

export default function Kontrollrammeverk() {
	const { risks, controls } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-12">
			<VStack gap="space-6">
				<Heading size="xlarge" level="2">
					Kontrollrammeverk
				</Heading>
				<BodyLong>Oversikt over domener, risikoer og kontroller i Minimum kontrollrammeverk (MKR v1.1).</BodyLong>
			</VStack>

			{risks.length > 0 && (
				<VStack gap="space-6">
					<Heading size="large" level="3">
						Risikoer
					</Heading>
					{groupByDomain(risks).map(({ domainName, items }) => (
						<VStack key={domainName} gap="space-4">
							<Heading size="medium" level="4">
								{domainName}
							</Heading>
							<div className="framework-card-grid">
								{items.map((risk, i) => (
									<Link
										key={risk.riskId}
										to={`/kontrollrammeverk/risiko/${risk.riskId}`}
										className="framework-card"
										style={{ backgroundColor: riskColor(i, items.length) }}
									>
										<BodyShort size="small" className="framework-card-id">
											{risk.riskId}:
										</BodyShort>
										<Heading size="small" level="5" className="framework-card-title">
											{risk.name}
										</Heading>
									</Link>
								))}
							</div>
						</VStack>
					))}
				</VStack>
			)}

			{controls.length > 0 && (
				<VStack gap="space-6">
					<Heading size="large" level="3">
						Kontroller
					</Heading>
					{groupByDomain(controls).map(({ domainName, items }) => (
						<VStack key={domainName} gap="space-4">
							<Heading size="medium" level="4">
								{domainName}
							</Heading>
							<div className="framework-card-grid">
								{items.map((ctrl, i) => (
									<Link
										key={ctrl.controlId}
										to={`/kontrollrammeverk/${ctrl.domainCode}/${ctrl.controlId}`}
										className="framework-card"
										style={{ backgroundColor: controlColor(i, items.length) }}
									>
										<BodyShort size="small" className="framework-card-id">
											{ctrl.controlId}:
										</BodyShort>
										<Heading size="small" level="5" className="framework-card-title">
											{ctrl.name}
										</Heading>
									</Link>
								))}
							</div>
						</VStack>
					))}
				</VStack>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
