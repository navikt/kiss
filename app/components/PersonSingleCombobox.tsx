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
	// selectedRef mirrors selected state so handleChange can read the latest value
	// synchronously within the same React event batch as handleToggleSelected.
	const selectedRef = useRef<PersonRef | null>(defaultValue ?? null)
	const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const lastFetchedQueryRef = useRef("")

	useEffect(() => {
		return () => {
			if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
		}
	}, [])

	const isLoading = searchFetcher.state === "loading"

	const filteredOptions = useMemo(() => {
		if (query.trim().length < 2) return []
		// Vis kun resultater som tilhører gjeldende query — ikke stale data fra forrige søk
		if (query.trim() !== lastFetchedQueryRef.current) return []
		const results = searchFetcher.data?.results ?? []
		return results.map((r) => {
			const ident = r.navIdent.trim().toUpperCase()
			const displayName = r.displayName?.trim() || null
			const label = r.mail ? `${displayName ?? ident} (${ident} · ${r.mail})` : `${displayName ?? ident} (${ident})`
			return { label, value: ident }
		})
	}, [searchFetcher.data, query])

	const displayNameMap = useMemo(() => {
		const map = new Map<string, string | null>()
		for (const r of searchFetcher.data?.results ?? []) {
			const ident = r.navIdent.trim().toUpperCase()
			map.set(ident, r.displayName?.trim() || null)
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
				const displayName = displayNameMap.get(ident) ?? null
				const person = { navIdent: ident, displayName: displayName ?? ident }
				selectedRef.current = person
				setSelected(person)
				setQuery(displayName ? `${displayName} (${ident})` : ident)
			} else {
				selectedRef.current = null
				setSelected(null)
				setQuery("")
			}
		},
		[displayNameMap],
	)

	const handleChange = useCallback(
		(value: string) => {
			if (selectedRef.current !== null) {
				// UNSAFE_Combobox fires onChange("") and onChange(currentLabel) after onToggleSelected —
				// both synchronously (same event batch) and after re-render. Ignore both.
				// Use selectedRef so this works even within the same React event batch as handleToggleSelected.
				const { navIdent, displayName } = selectedRef.current
				const selectedLabel = displayName !== navIdent ? `${displayName} (${navIdent})` : navIdent
				if (value === "" || value === selectedLabel) return
				// User has started typing a new query — clear the selection first.
				if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
				selectedRef.current = null
				setSelected(null)
			}
			setQuery(value)
			if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
			if (value.trim().length < 2) return
			searchTimeoutRef.current = setTimeout(() => {
				const q = value.trim()
				lastFetchedQueryRef.current = q
				searchFetcher.load(`/api/graph/users?q=${encodeURIComponent(q)}`)
			}, 300)
		},
		[searchFetcher],
	)

	const handleClear = useCallback(() => {
		if (searchTimeoutRef.current) {
			clearTimeout(searchTimeoutRef.current)
			searchTimeoutRef.current = null
		}
		setQuery("")
		selectedRef.current = null
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
