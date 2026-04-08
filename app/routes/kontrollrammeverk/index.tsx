import { BodyLong, BodyShort, Heading, HStack, Select, VStack } from "@navikt/ds-react"
import { useMemo, useState } from "react"
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

function uniqueSorted(values: (string | null)[]) {
	const unique = new Set(values.filter(Boolean) as string[])
	return [...unique].sort((a, b) => a.localeCompare(b, "nb"))
}

export default function Kontrollrammeverk() {
	const { risks, controls } = useLoaderData<typeof loader>()
	const [ansvarlig, setAnsvarlig] = useState("")
	const [teknologielement, setTeknologielement] = useState("")
	const [frekvens, setFrekvens] = useState("")

	const responsibleOptions = useMemo(() => uniqueSorted(controls.map((c) => c.responsible)), [controls])
	const technologyOptions = useMemo(() => uniqueSorted(controls.map((c) => c.technologyElement)), [controls])
	const frequencyOptions = useMemo(() => uniqueSorted(controls.map((c) => c.frequency)), [controls])

	const filteredControls = useMemo(() => {
		let result = controls
		if (ansvarlig) result = result.filter((c) => c.responsible === ansvarlig)
		if (teknologielement) result = result.filter((c) => c.technologyElement === teknologielement)
		if (frekvens) result = result.filter((c) => c.frequency === frekvens)
		return result
	}, [controls, ansvarlig, teknologielement, frekvens])

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
					<HStack gap="space-6" wrap>
						{responsibleOptions.length > 0 && (
							<Select
								label="Ansvarlig"
								value={ansvarlig}
								onChange={(e) => setAnsvarlig(e.target.value)}
								style={{ minWidth: "14rem" }}
							>
								<option value="">Alle</option>
								{responsibleOptions.map((r) => (
									<option key={r} value={r}>
										{r}
									</option>
								))}
							</Select>
						)}
						{technologyOptions.length > 0 && (
							<Select
								label="Teknologielement"
								value={teknologielement}
								onChange={(e) => setTeknologielement(e.target.value)}
								style={{ minWidth: "14rem" }}
							>
								<option value="">Alle</option>
								{technologyOptions.map((t) => (
									<option key={t} value={t}>
										{t}
									</option>
								))}
							</Select>
						)}
						{frequencyOptions.length > 0 && (
							<Select
								label="Frekvens"
								value={frekvens}
								onChange={(e) => setFrekvens(e.target.value)}
								style={{ minWidth: "14rem" }}
							>
								<option value="">Alle</option>
								{frequencyOptions.map((f) => (
									<option key={f} value={f}>
										{f}
									</option>
								))}
							</Select>
						)}
					</HStack>
					<BodyShort size="small">
						Viser {filteredControls.length} av {controls.length} kontroller
					</BodyShort>
					{groupByDomain(filteredControls).map(({ domainName, items }) => (
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
