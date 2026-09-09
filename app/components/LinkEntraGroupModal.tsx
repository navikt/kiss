import { PlusIcon } from "@navikt/aksel-icons"
import { BodyShort, Button, Detail, HStack, Modal, Search, Table, VStack } from "@navikt/ds-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Form, useFetcher } from "react-router"

interface GroupSearchResult {
	id: string
	displayName: string
}

interface LinkEntraGroupModalProps {
	intent: string
}

/** Modal for å søke opp og koble en Entra ID-gruppe til et team. */
export function LinkEntraGroupModal({ intent }: LinkEntraGroupModalProps) {
	const modalRef = useRef<HTMLDialogElement>(null)
	const searchFetcher = useFetcher<{ results: GroupSearchResult[] }>()
	const [searchValue, setSearchValue] = useState("")
	const [selectedGroup, setSelectedGroup] = useState<GroupSearchResult | null>(null)
	const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const lastQueryRef = useRef<string>("")

	const isSearching = searchFetcher.state === "loading"
	const searchResults = searchFetcher.data?.results ?? []
	const trimmedSearchValue = searchValue.trim()
	// Resultatene gjelder forrige query helt til den nye faktisk er sendt til backend
	// (debounce-vindu inkludert) — unngår å vise stale treff eller "Ingen grupper funnet".
	const isStale = trimmedSearchValue !== lastQueryRef.current

	const handleSearch = useCallback(
		(value: string) => {
			setSearchValue(value)
			setSelectedGroup(null)
			if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
			if (value.trim().length < 2) return
			searchTimeoutRef.current = setTimeout(() => {
				const query = value.trim()
				lastQueryRef.current = query
				searchFetcher.load(`/api/graph/groups?q=${encodeURIComponent(query)}`)
			}, 300)
		},
		[searchFetcher],
	)

	useEffect(() => {
		return () => {
			if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
		}
	}, [])

	function handleOpen() {
		if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
		lastQueryRef.current = ""
		setSearchValue("")
		setSelectedGroup(null)
		modalRef.current?.showModal()
	}

	function handleClose() {
		if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
		lastQueryRef.current = ""
		setSearchValue("")
		setSelectedGroup(null)
		modalRef.current?.close()
	}

	return (
		<>
			<Button variant="secondary" size="small" icon={<PlusIcon aria-hidden />} onClick={handleOpen}>
				Koble til Entra-gruppe
			</Button>

			<Modal ref={modalRef} header={{ heading: "Koble til Entra ID-gruppe" }} onClose={handleClose}>
				<Modal.Body>
					<VStack gap="space-4">
						<Search
							label="Søk etter Entra ID-gruppe"
							value={searchValue}
							onChange={handleSearch}
							onClear={() => {
								if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
								lastQueryRef.current = ""
								setSearchValue("")
								setSelectedGroup(null)
							}}
							size="small"
						/>
						{searchValue.trim().length >= 2 && (
							<section
								className="table-scroll"
								// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1
								tabIndex={0}
								aria-label="Søkeresultater for grupper"
								style={{ maxHeight: "20rem", overflow: "auto" }}
							>
								{isSearching || isStale ? (
									<BodyShort size="small">Søker…</BodyShort>
								) : searchResults.length === 0 ? (
									<BodyShort size="small">Ingen grupper funnet.</BodyShort>
								) : (
									<Table size="small">
										<Table.Body>
											{searchResults.map((group) => (
												<Table.Row key={group.id} selected={selectedGroup?.id === group.id}>
													<Table.DataCell>
														<VStack gap="space-1">
															<BodyShort size="small" weight="semibold">
																{group.displayName}
															</BodyShort>
															<Detail textColor="subtle" style={{ fontFamily: "monospace" }}>
																{group.id}
															</Detail>
														</VStack>
													</Table.DataCell>
													<Table.DataCell align="right">
														<Button variant="tertiary" size="xsmall" onClick={() => setSelectedGroup(group)}>
															Velg
														</Button>
													</Table.DataCell>
												</Table.Row>
											))}
										</Table.Body>
									</Table>
								)}
							</section>
						)}
					</VStack>
				</Modal.Body>
				<Modal.Footer>
					<Form method="post" onSubmit={() => modalRef.current?.close()}>
						<input type="hidden" name="intent" value={intent} />
						<input type="hidden" name="groupId" value={selectedGroup?.id ?? ""} />
						<input type="hidden" name="groupName" value={selectedGroup?.displayName ?? ""} />
						<HStack gap="space-4">
							<Button type="submit" size="small" disabled={!selectedGroup}>
								Koble til
							</Button>
							<Button type="button" variant="secondary" size="small" onClick={handleClose}>
								Avbryt
							</Button>
						</HStack>
					</Form>
				</Modal.Footer>
			</Modal>
		</>
	)
}
