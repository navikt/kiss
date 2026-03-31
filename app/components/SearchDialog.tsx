import { MagnifyingGlassIcon } from "@navikt/aksel-icons"
import { BodyShort, Box, Detail, Dialog, HStack, Loader, Search, Tag, VStack } from "@navikt/ds-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router"

interface SearchResult {
	type: "application" | "team" | "section" | "risk" | "control"
	id: string
	url: string
	title: string
	subtitle?: string
}

const typeLabels: Record<SearchResult["type"], string> = {
	application: "Applikasjon",
	team: "Team",
	section: "Seksjon",
	risk: "Risiko",
	control: "Kontroll",
}

const typeVariants: Record<SearchResult["type"], "info" | "neutral" | "alt1" | "alt2" | "alt3"> = {
	application: "info",
	team: "neutral",
	section: "alt1",
	risk: "alt2",
	control: "alt3",
}

function Kbd({ children }: { children: React.ReactNode }) {
	return (
		<Box
			as="kbd"
			paddingInline="space-6"
			paddingBlock="space-2"
			background="neutral-moderate"
			borderRadius="4"
			style={{
				fontFamily: "inherit",
				fontSize: "0.75rem",
				fontWeight: 500,
			}}
		>
			{children}
		</Box>
	)
}

export function SearchDialog() {
	const [open, setOpen] = useState(false)
	const [query, setQuery] = useState("")
	const [results, setResults] = useState<SearchResult[]>([])
	const [loading, setLoading] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(0)
	const searchInputRef = useRef<HTMLInputElement>(null)
	const resultsRef = useRef<SearchResult[]>([])
	const selectedIndexRef = useRef(0)
	const navigate = useNavigate()
	const location = useLocation()

	resultsRef.current = results
	selectedIndexRef.current = selectedIndex

	// Close dialog on navigation
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on path change
	useEffect(() => {
		setOpen(false)
		setQuery("")
		setResults([])
	}, [location.pathname])

	// Keyboard shortcut: Cmd/Ctrl + K
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "k") {
				e.preventDefault()
				setOpen(true)
			}
		}
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [])

	// Arrow key navigation
	useEffect(() => {
		if (!open) return

		const handleArrowKeys = (e: KeyboardEvent) => {
			const currentResults = resultsRef.current
			if (e.key === "ArrowDown") {
				e.preventDefault()
				setSelectedIndex((i) => Math.min(i + 1, currentResults.length - 1))
			} else if (e.key === "ArrowUp") {
				e.preventDefault()
				setSelectedIndex((i) => Math.max(i - 1, 0))
			} else if (e.key === "Enter" && currentResults.length > 0) {
				e.preventDefault()
				const result = currentResults[selectedIndexRef.current]
				if (result) {
					navigate(result.url)
					setOpen(false)
				}
			}
		}

		window.addEventListener("keydown", handleArrowKeys)
		return () => window.removeEventListener("keydown", handleArrowKeys)
	}, [open, navigate])

	// Debounced search
	useEffect(() => {
		if (!query.trim()) {
			setResults([])
			return
		}

		const timer = setTimeout(async () => {
			setLoading(true)
			try {
				const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
				if (response.ok) {
					const data = await response.json()
					setResults(data.results || [])
					setSelectedIndex(0)
				}
			} catch {
				// Ignore errors
			} finally {
				setLoading(false)
			}
		}, 200)

		return () => clearTimeout(timer)
	}, [query])

	const handleSelect = useCallback(
		(result: SearchResult) => {
			navigate(result.url)
			setOpen(false)
		},
		[navigate],
	)

	return (
		<Dialog open={open} onOpenChange={(nextOpen) => setOpen(nextOpen)}>
			<Dialog.Trigger>
				<Box
					as="button"
					paddingInline="space-12"
					paddingBlock="space-6"
					background="neutral-softA"
					borderRadius="8"
					borderWidth="1"
					borderColor="neutral-subtle"
					style={{ cursor: "pointer", minWidth: "200px" }}
				>
					<HStack gap="space-8" align="center">
						<MagnifyingGlassIcon aria-hidden style={{ fontSize: "1rem", color: "var(--ax-text-neutral-subtle)" }} />
						<BodyShort size="small" textColor="subtle" style={{ flex: 1 }}>
							Søk...
						</BodyShort>
						<Kbd>⌘K</Kbd>
					</HStack>
				</Box>
			</Dialog.Trigger>

			<Dialog.Popup
				width="large"
				position="center"
				closeOnOutsideClick
				initialFocusTo={() => searchInputRef.current}
				aria-label="Søk"
			>
				<Dialog.Header withClosebutton={false}>
					<Search
						ref={searchInputRef}
						label="Søk"
						hideLabel
						variant="simple"
						placeholder="Søk etter applikasjoner, team, seksjoner, risikoer, kontroller..."
						value={query}
						onChange={setQuery}
						autoComplete="off"
					/>
				</Dialog.Header>

				<Dialog.Body style={{ padding: 0, maxHeight: "400px", overflowY: "auto" }}>
					{loading && (
						<HStack justify="center" padding="space-24">
							<Loader size="medium" />
						</HStack>
					)}

					{!loading && query && results.length === 0 && (
						<Box padding="space-24">
							<BodyShort style={{ color: "var(--ax-text-neutral-subtle)", textAlign: "center" }}>
								Ingen resultater for «{query}»
							</BodyShort>
						</Box>
					)}

					{!loading && results.length > 0 && (
						<Box paddingInline="space-12" paddingBlock="space-8">
							<VStack as="ul" role="listbox" gap="space-2" style={{ listStyle: "none", margin: 0, padding: 0 }}>
								{results.map((result, index) => {
									const isSelected = index === selectedIndex
									return (
										<Box
											as="li"
											role="option"
											aria-selected={isSelected}
											key={`${result.type}-${result.id}`}
											padding="space-12"
											paddingInline="space-16"
											borderRadius="4"
											style={{
												cursor: "pointer",
												background: isSelected ? "var(--ax-bg-accent-moderate-pressed)" : undefined,
											}}
											onMouseEnter={() => setSelectedIndex(index)}
											onClick={() => handleSelect(result)}
										>
											<HStack gap="space-12" align="center">
												<MagnifyingGlassIcon
													aria-hidden
													style={{ fontSize: "1rem", color: "var(--ax-text-neutral-subtle)" }}
												/>
												<VStack gap="space-2" style={{ flex: 1, minWidth: 0 }}>
													<HStack gap="space-8" align="center">
														<BodyShort
															weight="semibold"
															style={{
																overflow: "hidden",
																textOverflow: "ellipsis",
																whiteSpace: "nowrap",
															}}
														>
															{result.title}
														</BodyShort>
														<Tag size="xsmall" variant={typeVariants[result.type]}>
															{typeLabels[result.type]}
														</Tag>
													</HStack>
													{result.subtitle && (
														<BodyShort
															size="small"
															textColor="subtle"
															style={{
																overflow: "hidden",
																textOverflow: "ellipsis",
																whiteSpace: "nowrap",
															}}
														>
															{result.subtitle}
														</BodyShort>
													)}
												</VStack>
											</HStack>
										</Box>
									)
								})}
							</VStack>
						</Box>
					)}

					{!loading && !query && (
						<Box padding="space-24">
							<VStack gap="space-8" align="center">
								<BodyShort style={{ color: "var(--ax-text-neutral-subtle)" }}>
									Søk etter applikasjoner, team, seksjoner, risikoer eller kontroller
								</BodyShort>
								<HStack gap="space-8">
									<HStack gap="space-4" align="center">
										<Kbd>↑</Kbd>
										<Kbd>↓</Kbd>
										<Detail>naviger</Detail>
									</HStack>
									<HStack gap="space-4" align="center">
										<Kbd>↵</Kbd>
										<Detail>velg</Detail>
									</HStack>
									<HStack gap="space-4" align="center">
										<Kbd>esc</Kbd>
										<Detail>lukk</Detail>
									</HStack>
								</HStack>
							</VStack>
						</Box>
					)}
				</Dialog.Body>
			</Dialog.Popup>
		</Dialog>
	)
}
