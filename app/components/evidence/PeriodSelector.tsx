/**
 * Period selector for NDA evidence.
 *
 * Lets users choose periodType and periodStart for deployment audit reports.
 * Calculates valid completed periods dynamically.
 */

import { BodyShort, Button, HStack, Select, VStack } from "@navikt/ds-react"
import { useEffect, useRef, useState } from "react"
import { useFetcher } from "react-router"

const PERIOD_TYPE_LABELS: Record<string, string> = {
	yearly: "Årlig",
	tertiary: "Tertialsvis",
	quarterly: "Kvartalsvis",
	monthly: "Månedlig",
}

interface PeriodOption {
	value: string
	label: string
}

function getCompletedPeriods(periodType: string, yearsBack = 3): PeriodOption[] {
	const now = new Date()
	const currentYear = now.getFullYear()
	const currentMonth = now.getMonth() + 1
	const periods: PeriodOption[] = []

	for (let year = currentYear; year >= currentYear - yearsBack; year--) {
		switch (periodType) {
			case "yearly":
				if (year < currentYear) {
					periods.push({ value: `${year}-01-01`, label: `${year}` })
				}
				break
			case "tertiary":
				for (const [startMonth, label] of [
					[9, `T3 ${year}`],
					[5, `T2 ${year}`],
					[1, `T1 ${year}`],
				] as const) {
					// Period ends 4 months after start; use Date to handle year rollover
					const periodEnd = new Date(year, startMonth - 1 + 4, 1)
					if (
						periodEnd.getFullYear() < currentYear ||
						(periodEnd.getFullYear() === currentYear && periodEnd.getMonth() + 1 <= currentMonth)
					) {
						periods.push({
							value: `${year}-${String(startMonth).padStart(2, "0")}-01`,
							label,
						})
					}
				}
				break
			case "quarterly":
				for (const [startMonth, label] of [
					[10, `Q4 ${year}`],
					[7, `Q3 ${year}`],
					[4, `Q2 ${year}`],
					[1, `Q1 ${year}`],
				] as const) {
					// Period ends 3 months after start; use Date to handle year rollover
					const periodEnd = new Date(year, startMonth - 1 + 3, 1)
					if (
						periodEnd.getFullYear() < currentYear ||
						(periodEnd.getFullYear() === currentYear && periodEnd.getMonth() + 1 <= currentMonth)
					) {
						periods.push({
							value: `${year}-${String(startMonth).padStart(2, "0")}-01`,
							label,
						})
					}
				}
				break
			case "monthly":
				for (let month = 12; month >= 1; month--) {
					if (year < currentYear || (year === currentYear && month < currentMonth)) {
						const monthStr = String(month).padStart(2, "0")
						const monthNames = [
							"Januar",
							"Februar",
							"Mars",
							"April",
							"Mai",
							"Juni",
							"Juli",
							"August",
							"September",
							"Oktober",
							"November",
							"Desember",
						]
						periods.push({
							value: `${year}-${monthStr}-01`,
							label: `${monthNames[month - 1]} ${year}`,
						})
					}
				}
				break
		}
	}

	return periods
}

interface PeriodSelectorProps {
	activityId: string
	onSaved?: () => void
}

export function PeriodSelector({ activityId, onSaved }: PeriodSelectorProps) {
	const fetcher = useFetcher()
	const [periodType, setPeriodType] = useState("yearly")
	const [periodStart, setPeriodStart] = useState("")
	const prevFetcherState = useRef(fetcher.state)

	const periods = getCompletedPeriods(periodType)
	const isSubmitting = fetcher.state !== "idle"

	useEffect(() => {
		if (prevFetcherState.current !== "idle" && fetcher.state === "idle" && fetcher.data) {
			const result = fetcher.data as Record<string, unknown>
			if (result.success && onSaved) {
				onSaved()
			}
		}
		prevFetcherState.current = fetcher.state
	}, [fetcher.state, fetcher.data, onSaved])

	return (
		<VStack gap="space-4">
			<BodyShort>Velg periode for leveranserapporten. Kun avsluttede perioder er tilgjengelige.</BodyShort>
			<HStack gap="space-4" align="end">
				<Select
					label="Periodetype"
					value={periodType}
					onChange={(e) => {
						setPeriodType(e.target.value)
						setPeriodStart("")
					}}
					size="small"
				>
					{Object.entries(PERIOD_TYPE_LABELS).map(([value, label]) => (
						<option key={value} value={value}>
							{label}
						</option>
					))}
				</Select>
				<Select label="Periode" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} size="small">
					<option value="">Velg periode…</option>
					{periods.map((p) => (
						<option key={p.value} value={p.value}>
							{p.label}
						</option>
					))}
				</Select>
				<fetcher.Form method="post" action="/api/evidence-period-config">
					<input type="hidden" name="activityId" value={activityId} />
					<input type="hidden" name="periodType" value={periodType} />
					<input type="hidden" name="periodStart" value={periodStart} />
					<Button
						type="submit"
						size="small"
						variant="primary"
						disabled={!periodStart || isSubmitting}
						loading={isSubmitting}
					>
						Velg periode
					</Button>
				</fetcher.Form>
			</HStack>
			{fetcher.data && "success" in (fetcher.data as Record<string, unknown>) && (
				<BodyShort size="small">Periodevalg lagret.</BodyShort>
			)}
		</VStack>
	)
}

export { getCompletedPeriods, PERIOD_TYPE_LABELS }
