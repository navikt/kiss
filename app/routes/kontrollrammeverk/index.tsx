import { BodyLong, BodyShort, Heading, HStack, Select, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData, useSearchParams } from "react-router"
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

export async function loader({ request }: LoaderFunctionArgs) {
	const url = new URL(request.url)
	const ansvarlig = url.searchParams.get("ansvarlig") ?? ""
	const teknologielement = url.searchParams.get("teknologielement") ?? ""
	const frekvens = url.searchParams.get("frekvens") ?? ""

	const [risks, allControls] = await Promise.all([getAllRisks(), getAllControls()])

	let filteredControls = allControls
	if (ansvarlig) filteredControls = filteredControls.filter((c) => c.responsible === ansvarlig)
	if (teknologielement)
		filteredControls = filteredControls.filter((c) => c.technologyElements.includes(teknologielement))
	if (frekvens) filteredControls = filteredControls.filter((c) => c.frequency === frekvens)

	const responsibleOptions = uniqueSorted(allControls.map((c) => c.responsible))
	const technologyOptions = uniqueSorted(allControls.flatMap((c) => c.technologyElements))
	const frequencyOptions = uniqueSorted(allControls.map((c) => c.frequency))

	return data({
		risks,
		controls: filteredControls,
		totalControls: allControls.length,
		filters: { ansvarlig, teknologielement, frekvens },
		options: { responsibleOptions, technologyOptions, frequencyOptions },
	})
}

function uniqueSorted(values: (string | null)[]) {
	const unique = new Set(values.filter(Boolean) as string[])
	return [...unique].sort((a, b) => a.localeCompare(b, "nb"))
}

export default function Kontrollrammeverk() {
	const { risks, controls, totalControls, filters, options } = useLoaderData<typeof loader>()
	const [, setSearchParams] = useSearchParams()

	function setFilter(key: string, value: string) {
		setSearchParams(
			(prev) => {
				if (value) {
					prev.set(key, value)
				} else {
					prev.delete(key)
				}
				return prev
			},
			{ replace: true },
		)
	}

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

			{(controls.length > 0 || totalControls > 0) && (
				<VStack gap="space-6">
					<Heading size="large" level="3">
						Kontroller
					</Heading>
					<HStack gap="space-6" wrap>
						{options.responsibleOptions.length > 0 && (
							<Select
								label="Ansvarlig"
								value={filters.ansvarlig}
								onChange={(e) => setFilter("ansvarlig", e.target.value)}
								style={{ minWidth: "14rem" }}
							>
								<option value="">Vis alle</option>
								{options.responsibleOptions.map((r) => (
									<option key={r} value={r}>
										{r}
									</option>
								))}
							</Select>
						)}
						{options.technologyOptions.length > 0 && (
							<Select
								label="Teknologielement"
								value={filters.teknologielement}
								onChange={(e) => setFilter("teknologielement", e.target.value)}
								style={{ minWidth: "14rem" }}
							>
								<option value="">Vis alle</option>
								{options.technologyOptions.map((t) => (
									<option key={t} value={t}>
										{t}
									</option>
								))}
							</Select>
						)}
						{options.frequencyOptions.length > 0 && (
							<Select
								label="Frekvens"
								value={filters.frekvens}
								onChange={(e) => setFilter("frekvens", e.target.value)}
								style={{ minWidth: "14rem" }}
							>
								<option value="">Vis alle</option>
								{options.frequencyOptions.map((f) => (
									<option key={f} value={f}>
										{f}
									</option>
								))}
							</Select>
						)}
					</HStack>
					<BodyShort size="small">
						Viser {controls.length} av {totalControls} kontroller
					</BodyShort>
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
