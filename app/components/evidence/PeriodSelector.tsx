/**
 * Period selector for NDA evidence.
 *
 * Lets users choose periodType and periodStart for deployment audit reports.
 * Calculates valid completed periods dynamically.
 */

import { BodyShort, Button, HStack, Select, VStack } from "@navikt/ds-react"
import { useEffect, useState } from "react"

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
	currentPeriod?: { periodType: string; periodStart: string } | null
	onSelectPeriod: (periodConfig: { periodType: string; periodStart: string }) => void
	isSubmitting?: boolean
	onRefresh?: () => void
	refreshLabel?: string
	refreshLoading?: boolean
	refreshDisabled?: boolean
	periodLocked?: boolean
}

export function PeriodSelector({
	currentPeriod = null,
	onSelectPeriod,
	isSubmitting = false,
	onRefresh,
	refreshLabel = "Generer rapporter for valgt periode",
	refreshLoading = false,
	refreshDisabled = false,
	periodLocked = false,
}: PeriodSelectorProps) {
	const [periodType, setPeriodType] = useState(currentPeriod?.periodType ?? "yearly")
	const [periodStart, setPeriodStart] = useState(currentPeriod?.periodStart ?? "")

	const periods = getCompletedPeriods(periodType)
	const isCurrentPeriod = currentPeriod?.periodType === periodType && currentPeriod.periodStart === periodStart

	useEffect(() => {
		setPeriodType(currentPeriod?.periodType ?? "yearly")
		setPeriodStart(currentPeriod?.periodStart ?? "")
	}, [currentPeriod?.periodStart, currentPeriod?.periodType])

	return (
		<VStack gap="space-16">
			<BodyShort>
				Velg periode for leveranserapporten, eller hent rapportene for valgt periode på nytt. Kun avsluttede perioder er
				tilgjengelige.
			</BodyShort>
			<HStack gap="space-16" align="end" wrap>
				<Select
					label="Periodetype"
					value={periodType}
					onChange={(e) => {
						setPeriodType(e.target.value)
						setPeriodStart("")
					}}
					size="small"
					readOnly={periodLocked}
				>
					{Object.entries(PERIOD_TYPE_LABELS).map(([value, label]) => (
						<option key={value} value={value}>
							{label}
						</option>
					))}
				</Select>
				<Select
					label="Periode"
					value={periodStart}
					onChange={(e) => setPeriodStart(e.target.value)}
					size="small"
					readOnly={periodLocked}
				>
					<option value="">Velg periode…</option>
					{periods.map((p) => (
						<option key={p.value} value={p.value}>
							{p.label}
						</option>
					))}
				</Select>
				{isCurrentPeriod && onRefresh ? (
					<Button
						type="button"
						size="small"
						variant="primary"
						onClick={onRefresh}
						disabled={isSubmitting || refreshDisabled}
						loading={refreshLoading}
					>
						{refreshLabel}
					</Button>
				) : (
					<Button
						type="button"
						size="small"
						variant="primary"
						disabled={!periodStart || isSubmitting || periodLocked}
						loading={isSubmitting}
						onClick={() => onSelectPeriod({ periodType, periodStart })}
					>
						Generer rapporter for valgt periode
					</Button>
				)}
			</HStack>
		</VStack>
	)
}

export { getCompletedPeriods, PERIOD_TYPE_LABELS }
