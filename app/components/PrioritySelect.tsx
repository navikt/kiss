import { Select } from "@navikt/ds-react"
import { ROUTINE_PRIORITIES, routinePriorityLabels } from "~/lib/routine-priorities"

type PrioritySelectCommonProps = {
	disabled?: boolean
	size?: "small" | "medium"
	label?: string
	hideLabel?: boolean
	error?: string
	id?: string
}

// Controlled mode: value + onChange (used on detail page)
type PrioritySelectControlledProps = PrioritySelectCommonProps & {
	value: number
	onChange: (priority: number) => void
	name?: never
	defaultValue?: never
}

// Form mode: name + defaultValue (used in create/edit forms)
type PrioritySelectFormProps = PrioritySelectCommonProps & {
	name: string
	defaultValue?: number
	value?: never
	onChange?: never
}

type PrioritySelectProps = PrioritySelectControlledProps | PrioritySelectFormProps

/**
 * Dropdown for selecting routine priority.
 *
 * Supports two modes:
 * - **Form mode**: pass `name` (and optionally `defaultValue`) for use inside a `<Form>`.
 * - **Controlled mode**: pass `value` + `onChange` for controlled usage.
 *
 * Shows three options: Kritisk (1), Høy (2), Normal (3).
 */
export function PrioritySelect({
	disabled = false,
	size = "small",
	label = "Prioritet",
	hideLabel = false,
	error,
	id,
	...props
}: PrioritySelectProps) {
	const options = (
		<>
			<option value={ROUTINE_PRIORITIES.CRITICAL}>{routinePriorityLabels[ROUTINE_PRIORITIES.CRITICAL]}</option>
			<option value={ROUTINE_PRIORITIES.HIGH}>{routinePriorityLabels[ROUTINE_PRIORITIES.HIGH]}</option>
			<option value={ROUTINE_PRIORITIES.NORMAL}>{routinePriorityLabels[ROUTINE_PRIORITIES.NORMAL]}</option>
		</>
	)

	if ("name" in props && props.name !== undefined) {
		return (
			<Select
				label={label}
				hideLabel={hideLabel}
				size={size}
				id={id}
				name={props.name}
				defaultValue={String(props.defaultValue ?? ROUTINE_PRIORITIES.NORMAL)}
				disabled={disabled}
				error={error}
			>
				{options}
			</Select>
		)
	}

	return (
		<Select
			label={label}
			hideLabel={hideLabel}
			size={size}
			id={id}
			value={String(props.value)}
			onChange={(e) => props.onChange?.(Number(e.target.value))}
			disabled={disabled}
			error={error}
		>
			{options}
		</Select>
	)
}
