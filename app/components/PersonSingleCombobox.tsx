import { UNSAFE_Combobox } from "@navikt/ds-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useFetcher } from "react-router"

interface UserSearchResult {
	navIdent: string
	displayName: string
	mail: string | null
}

export interface PersonRef {
	navIdent: string
	displayName: string
}

interface PersonSingleComboboxProps {
	name: string
	label: string
	description?: string
	defaultValue?: PersonRef
	required?: boolean
	size?: "small" | "medium"
}

/**
 * Enkeltvalg-combobox for personsøk mot /api/graph/users.
 * Sender én skjult input med { navIdent, displayName } som JSON-verdi.
 */
export function PersonSingleCombobox({
	name,
	label,
	description,
	defaultValue,
	required = false,
	size = "small",
}: PersonSingleComboboxProps) {
	const searchFetcher = useFetcher<{ results: UserSearchResult[] }>()
	const [query, setQuery] = useState("")
	const [selected, setSelected] = useState<PersonRef | null>(defaultValue ?? null)
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
		return results.map((r) => {
			const ident = r.navIdent.trim().toUpperCase()
			const displayName = r.displayName?.trim() || null
			const label = r.mail ? `${displayName ?? ident} (${ident} · ${r.mail})` : `${displayName ?? ident} (${ident})`
			return { label, value: ident }
		})
	}, [searchFetcher.data, query])

	// Build a display name map from search results so we can store it on select
	const displayNameMap = useMemo(() => {
		const map = new Map<string, string>()
		for (const r of searchFetcher.data?.results ?? []) {
			map.set(r.navIdent.trim().toUpperCase(), r.displayName?.trim() || r.navIdent)
		}
		if (defaultValue) {
			map.set(defaultValue.navIdent.trim().toUpperCase(), defaultValue.displayName)
		}
		return map
	}, [searchFetcher.data, defaultValue])

	const selectedOptions = useMemo(() => {
		if (!selected) return []
		const ident = selected.navIdent.trim().toUpperCase()
		const displayName = displayNameMap.get(ident) ?? selected.displayName
		return [{ label: displayName ? `${displayName} (${ident})` : ident, value: ident }]
	}, [selected, displayNameMap])

	const handleToggleSelected = useCallback(
		(option: string, isSelected: boolean) => {
			const ident = option.trim().toUpperCase()
			if (!ident) return
			if (isSelected) {
				const displayName = displayNameMap.get(ident) ?? ident
				setSelected({ navIdent: ident, displayName })
				setQuery("")
			} else {
				setSelected(null)
			}
		},
		[displayNameMap],
	)

	const handleChange = useCallback(
		(value: string) => {
			setQuery(value)
			if (selected) setSelected(null)
			if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
			if (value.trim().length < 2) return
			searchTimeoutRef.current = setTimeout(() => {
				searchFetcher.load(`/api/graph/users?q=${encodeURIComponent(value.trim())}`)
			}, 300)
		},
		[searchFetcher, selected],
	)

	const handleClear = useCallback(() => {
		if (searchTimeoutRef.current) {
			clearTimeout(searchTimeoutRef.current)
			searchTimeoutRef.current = null
		}
		setQuery("")
		setSelected(null)
	}, [])

	const hiddenValue = selected ? JSON.stringify({ navIdent: selected.navIdent, displayName: selected.displayName }) : ""

	return (
		<>
			<UNSAFE_Combobox
				label={label}
				description={description}
				size={size}
				required={required}
				options={[]}
				filteredOptions={filteredOptions}
				selectedOptions={selectedOptions}
				onToggleSelected={handleToggleSelected}
				value={query}
				onChange={handleChange}
				onClear={handleClear}
				isLoading={isLoading}
				isMultiSelect={false}
				shouldAutocomplete={false}
			/>
			<input type="hidden" name={name} value={hiddenValue} />
		</>
	)
}
