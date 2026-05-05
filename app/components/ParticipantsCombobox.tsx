import { UNSAFE_Combobox } from "@navikt/ds-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useFetcher } from "react-router"

interface UserSearchResult {
	navIdent: string
	displayName: string
	mail: string | null
}

export interface ParticipantOption {
	navIdent: string
	displayName?: string | null
}

interface ParticipantsComboboxProps {
	name: string
	label: string
	description?: string
	defaultParticipants?: ParticipantOption[]
	size?: "small" | "medium"
}

interface SelectedOption {
	label: string
	value: string
	displayName: string | null
}

function toComboboxOption(p: ParticipantOption): SelectedOption {
	const ident = p.navIdent.trim()
	const displayName = p.displayName?.trim() || null
	return {
		label: displayName ? `${displayName} (${ident})` : ident,
		value: ident.toUpperCase(),
		displayName,
	}
}

export function ParticipantsCombobox({
	name,
	label,
	description,
	defaultParticipants = [],
	size = "small",
}: ParticipantsComboboxProps) {
	const searchFetcher = useFetcher<{ results: UserSearchResult[] }>()
	const [query, setQuery] = useState("")
	const [selectedOptions, setSelectedOptions] = useState(() => defaultParticipants.map(toComboboxOption))
	const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	useEffect(() => {
		return () => {
			if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
		}
	}, [])

	const isLoading = searchFetcher.state === "loading"

	const filteredOptions = useMemo(() => {
		if (query.trim().length < 2) return []
		const results = searchFetcher.data?.results ?? []
		const selectedIdents = new Set(selectedOptions.map((o) => o.value))
		return results
			.filter((r) => !selectedIdents.has(r.navIdent.toUpperCase()))
			.map((r) => ({
				label: r.mail ? `${r.displayName} (${r.navIdent} · ${r.mail})` : `${r.displayName} (${r.navIdent})`,
				value: r.navIdent.toUpperCase(),
			}))
	}, [searchFetcher.data, selectedOptions, query])

	const handleChange = useCallback(
		(value: string) => {
			setQuery(value)
			if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
			if (value.trim().length < 2) return
			searchTimeoutRef.current = setTimeout(() => {
				searchFetcher.load(`/api/graph/users?q=${encodeURIComponent(value.trim())}`)
			}, 300)
		},
		[searchFetcher],
	)

	const handleToggleSelected = useCallback(
		(option: string, isSelected: boolean, _isCustomOption: boolean) => {
			const ident = option.trim().toUpperCase()
			if (!ident) return
			setSelectedOptions((current) => {
				if (isSelected) {
					if (current.some((o) => o.value === ident)) return current
					const fromResults = (searchFetcher.data?.results ?? []).find((r) => r.navIdent.toUpperCase() === ident)
					const displayName = fromResults?.displayName?.trim() || null
					const label = displayName ? `${displayName} (${ident})` : ident
					return [...current, { label, value: ident, displayName }]
				}
				return current.filter((o) => o.value !== ident)
			})
			if (isSelected) setQuery("")
		},
		[searchFetcher.data],
	)

	const handleClear = useCallback(() => {
		if (searchTimeoutRef.current) {
			clearTimeout(searchTimeoutRef.current)
			searchTimeoutRef.current = null
		}
		setQuery("")
	}, [])

	const hiddenValue = JSON.stringify(selectedOptions.map((o) => ({ navIdent: o.value, displayName: o.displayName })))

	return (
		<>
			<UNSAFE_Combobox
				label={label}
				description={description}
				size={size}
				options={[]}
				filteredOptions={filteredOptions}
				selectedOptions={selectedOptions}
				onToggleSelected={handleToggleSelected}
				value={query}
				onChange={handleChange}
				onClear={handleClear}
				isLoading={isLoading}
				isMultiSelect
				allowNewValues
				shouldAutocomplete={false}
			/>
			<input type="hidden" name={name} value={hiddenValue} />
		</>
	)
}
