import { Select } from "@navikt/ds-react"

interface FilterSelectProps {
	label: string
	hideLabel?: boolean
	allLabel: string
	value: string
	onChange: (value: string) => void
	options: Array<readonly [value: string, label: string]>
	size?: "small" | "medium"
	style?: React.CSSProperties
}

/**
 * Dropdown for filtering a table/list by one column, prefilled with the distinct
 * values found in the data. Always includes an "all" option (empty string value)
 * that clears the filter.
 */
export function FilterSelect({
	label,
	hideLabel = false,
	allLabel,
	value,
	onChange,
	options,
	size = "small",
	style,
}: FilterSelectProps) {
	return (
		<Select
			label={label}
			hideLabel={hideLabel}
			size={size}
			value={value}
			onChange={(e) => onChange(e.target.value)}
			style={style}
		>
			<option value="">{allLabel}</option>
			{options.map(([optionValue, optionLabel]) => (
				<option key={optionValue} value={optionValue}>
					{optionLabel}
				</option>
			))}
		</Select>
	)
}
