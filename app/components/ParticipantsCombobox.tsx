import { Button, HStack, Label, UNSAFE_Combobox, VStack } from "@navikt/ds-react"
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
	quickAddOptions?: Array<{ navIdent: string; displayName: string | null }>
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
	quickAddOptions,
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

	// Combined display name map from all known sources so quick-add preserves names
	const displayNameMap = useMemo(() => {
		const map = new Map<string, string | null>()
		for (const p of defaultParticipants) {
			map.set(p.navIdent.trim().toUpperCase(), p.displayName?.trim() || null)
		}
		for (const r of searchFetcher.data?.results ?? []) {
			map.set(r.navIdent.trim().toUpperCase(), r.displayName?.trim() || null)
		}
		for (const q of quickAddOptions ?? []) {
			map.set(q.navIdent.trim().toUpperCase(), q.displayName?.trim() || null)
		}
		return map
	}, [defaultParticipants, searchFetcher.data, quickAddOptions])

	const filteredOptions = useMemo(() => {
		if (query.trim().length < 2) return []
		const results = searchFetcher.data?.results ?? []
		const selectedIdents = new Set(selectedOptions.map((o) => o.value))
		return results
			.filter((r) => !selectedIdents.has(r.navIdent.trim().toUpperCase()))
			.map((r) => {
				const ident = r.navIdent.trim().toUpperCase()
				const displayName = r.displayName?.trim() || null
				return {
					label: r.mail ? `${displayName ?? ident} (${ident} · ${r.mail})` : `${displayName ?? ident} (${ident})`,
					value: ident,
				}
			})
	}, [searchFetcher.data, selectedOptions, query])

	const addParticipant = useCallback(
		(navIdent: string) => {
			const ident = navIdent.trim().toUpperCase()
			if (!ident) return
			setSelectedOptions((current) => {
				if (current.some((o) => o.value === ident)) return current
				const displayName = displayNameMap.get(ident) ?? null
				const label = displayName ? `${displayName} (${ident})` : ident
				return [...current, { label, value: ident, displayName }]
			})
		},
		[displayNameMap],
	)

	const handleToggleSelected = useCallback(
		(option: string, isSelected: boolean, _isCustomOption: boolean) => {
			const ident = option.trim().toUpperCase()
			if (!ident) return
			if (isSelected) {
				addParticipant(ident)
			} else {
				setSelectedOptions((current) => current.filter((o) => o.value !== ident))
			}
			if (isSelected) setQuery("")
		},
		[addParticipant],
	)

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

	const handleClear = useCallback(() => {
		if (searchTimeoutRef.current) {
			clearTimeout(searchTimeoutRef.current)
			searchTimeoutRef.current = null
		}
		setQuery("")
	}, [])

	const hiddenValue = JSON.stringify(selectedOptions.map((o) => ({ navIdent: o.value, displayName: o.displayName })))

	const selectedIdents = useMemo(() => new Set(selectedOptions.map((o) => o.value)), [selectedOptions])

	const unselectedQuickOptions = useMemo(
		() => (quickAddOptions ?? []).filter((q) => !selectedIdents.has(q.navIdent.trim().toUpperCase())),
		[quickAddOptions, selectedIdents],
	)

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
			{unselectedQuickOptions.length > 0 && (
				<VStack gap="space-2">
					<Label size="small">Hurtigvalg fra teamet</Label>
					<HStack gap="space-2" wrap>
						{unselectedQuickOptions.map((q) => {
							const ident = q.navIdent.trim().toUpperCase()
							const displayName = displayNameMap.get(ident)
							return (
								<Button
									key={ident}
									type="button"
									variant="secondary"
									size="xsmall"
									onClick={() => addParticipant(ident)}
								>
									{displayName ? `${displayName} (${ident})` : ident}
								</Button>
							)
						})}
					</HStack>
				</VStack>
			)}
		</>
	)
}
