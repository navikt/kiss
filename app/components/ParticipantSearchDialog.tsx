import { PlusIcon } from "@navikt/aksel-icons"
import { BodyShort, Box, Button, Detail, Dialog, Search, VStack } from "@navikt/ds-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useFetcher } from "react-router"

interface UserSearchResult {
	navIdent: string
	displayName: string
	mail: string | null
}

interface ParticipantSearchDialogProps {
	currentValue: string
	onAdd: (navIdent: string) => void
}

function parseIdents(value: string): Set<string> {
	return new Set(
		value
			.split(",")
			.map((s) => s.trim().toUpperCase())
			.filter(Boolean),
	)
}

export function ParticipantSearchDialog({ currentValue, onAdd }: ParticipantSearchDialogProps) {
	const searchFetcher = useFetcher<{ results: UserSearchResult[] }>()
	const [open, setOpen] = useState(false)
	const [query, setQuery] = useState("")
	const [showResults, setShowResults] = useState(false)
	const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const searchInputRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		return () => {
			if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
		}
	}, [])

	const existingIdents = useMemo(() => parseIdents(currentValue), [currentValue])
	const results = searchFetcher.data?.results ?? []
	const isSearching = searchFetcher.state === "loading"

	const handleSearch = useCallback(
		(value: string) => {
			setQuery(value)
			if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
			if (value.trim().length < 2) {
				setShowResults(false)
				return
			}
			searchTimeoutRef.current = setTimeout(() => {
				searchFetcher.load(`/api/graph/users?q=${encodeURIComponent(value.trim())}`)
				setShowResults(true)
			}, 300)
		},
		[searchFetcher],
	)

	const handleAdd = useCallback(
		(navIdent: string) => {
			onAdd(navIdent)
		},
		[onAdd],
	)

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen && searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
				setOpen(nextOpen)
			}}
		>
			<Dialog.Trigger>
				<Button type="button" variant="secondary" size="small" icon={<PlusIcon aria-hidden />}>
					Søk etter person
				</Button>
			</Dialog.Trigger>
			<Dialog.Popup
				width="medium"
				position="center"
				closeOnOutsideClick
				initialFocusTo={() => searchInputRef.current}
				aria-label="Legg til deltaker"
			>
				<Dialog.Header>Legg til deltaker</Dialog.Header>
				<Dialog.Body>
					<VStack gap="space-4">
						<Search
							ref={searchInputRef}
							label="Søk på navn eller e-post"
							size="small"
							value={query}
							onChange={handleSearch}
							onClear={() => {
								if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
								setQuery("")
								setShowResults(false)
							}}
							autoComplete="off"
						/>
						<Detail textColor="subtle">
							Skriv minst 2 tegn. Du kan søke på fornavn, etternavn eller e-postadresse. Den valgte personens NAV-ident
							legges til i deltakerlisten.
						</Detail>
						{showResults && (
							<Box
								borderRadius="8"
								borderWidth="1"
								borderColor="neutral-subtle"
								style={{ maxHeight: "300px", overflowY: "auto" }}
							>
								{isSearching ? (
									<BodyShort size="small" textColor="subtle" style={{ padding: "var(--ax-space-8)" }}>
										Søker…
									</BodyShort>
								) : results.length > 0 ? (
									<VStack>
										{results.map((result) => {
											const alreadyAdded = existingIdents.has(result.navIdent.toUpperCase())
											return (
												<Button
													key={result.navIdent}
													type="button"
													variant="tertiary-neutral"
													size="small"
													style={{ justifyContent: "flex-start", width: "100%", textAlign: "left" }}
													onClick={alreadyAdded ? undefined : () => handleAdd(result.navIdent)}
													disabled={alreadyAdded}
												>
													<VStack>
														<BodyShort size="small" weight="semibold">
															{result.displayName}
															{alreadyAdded && " ✓"}
														</BodyShort>
														<Detail textColor="subtle">
															{result.navIdent}
															{result.mail ? ` · ${result.mail}` : ""}
															{alreadyAdded ? " · Allerede lagt til" : ""}
														</Detail>
													</VStack>
												</Button>
											)
										})}
									</VStack>
								) : (
									<BodyShort size="small" textColor="subtle" style={{ padding: "var(--ax-space-8)" }}>
										Ingen brukere funnet
									</BodyShort>
								)}
							</Box>
						)}
					</VStack>
				</Dialog.Body>
				<Dialog.Footer>
					<Button
						type="button"
						variant="secondary"
						size="small"
						onClick={() => {
							if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
							setOpen(false)
						}}
					>
						Lukk
					</Button>
				</Dialog.Footer>
			</Dialog.Popup>
		</Dialog>
	)
}
