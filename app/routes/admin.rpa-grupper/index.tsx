import { PlusIcon } from "@navikt/aksel-icons"
import {
	Alert,
	BodyLong,
	BodyShort,
	Button,
	CopyButton,
	Detail,
	Heading,
	HStack,
	Modal,
	ReadMore,
	Search,
	Table,
	Tag,
	VStack,
} from "@navikt/ds-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { type ActionFunctionArgs, data, Link, type LoaderFunctionArgs, useFetcher, useLoaderData } from "react-router"
import { getAuditLogByAction } from "~/db/queries/audit.server"
import { addRpaGroup, getActiveRpaGroups, getMemberCountPerRpaGroup, removeRpaGroup } from "~/db/queries/rpa.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"
import { syncSingleRpaGroup } from "~/lib/rpa-sync.server"

export async function loader({ request }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const [groups, memberCounts, auditLog] = await Promise.all([
		getActiveRpaGroups(),
		getMemberCountPerRpaGroup(),
		getAuditLogByAction("rpa_group_members_synced", 10),
	])

	const countMap = new Map(memberCounts.map((c) => [c.rpaGroupId, c]))

	const groupsWithStats = groups.map((g) => {
		const stats = countMap.get(g.id)
		return {
			...g,
			memberCount: stats?.memberCount ?? 0,
			lastSyncedAt: stats?.lastSyncedAt ?? null,
		}
	})

	return { groups: groupsWithStats, auditLog }
}

export async function action({ request }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const formData = await request.formData()
	const intent = formData.get("intent")

	switch (intent) {
		case "add-group": {
			const groupId = formData.get("groupId")
			const groupName = formData.get("groupName")

			if (typeof groupId !== "string" || !groupId.trim()) {
				return data({ error: "Gruppe-ID er påkrevd." }, { status: 400 })
			}

			let result: { id: string }
			try {
				result = await addRpaGroup(
					groupId.trim(),
					typeof groupName === "string" ? groupName.trim() : null,
					authedUser.navIdent,
				)
			} catch (err) {
				if (err instanceof Error && err.message.includes("unique")) {
					return data({ error: "Denne gruppen er allerede lagt til." }, { status: 409 })
				}
				throw err
			}

			// Trigger immediate sync for the new group
			try {
				await syncSingleRpaGroup(result.id, groupId.trim(), typeof groupName === "string" ? groupName.trim() : null)
			} catch {
				// Sync failure is non-blocking — scheduler will retry
			}

			return { success: true, message: "Gruppe lagt til." }
		}

		case "remove-group": {
			const groupDbId = formData.get("groupDbId")

			if (typeof groupDbId !== "string" || !groupDbId.trim()) {
				return data({ error: "Gruppe-ID mangler." }, { status: 400 })
			}

			await removeRpaGroup(groupDbId.trim(), authedUser.navIdent)
			return { success: true, message: "Gruppe fjernet." }
		}

		default:
			return data({ error: "Ukjent handling." }, { status: 400 })
	}
}

export default function AdminRpaGrupper() {
	const { groups, auditLog } = useLoaderData<typeof loader>()
	const addModalRef = useRef<HTMLDialogElement>(null)

	return (
		<VStack gap="space-6">
			<HStack justify="space-between" align="center" wrap>
				<div>
					<Heading size="xlarge" level="2">
						RPA-grupper
					</Heading>
					<BodyLong>
						Konfigurer Entra ID-grupper som identifiserer RPA-brukere (roboter). Medlemmer synkroniseres automatisk
						daglig.
					</BodyLong>
				</div>
				<HStack gap="space-4" align="center">
					<Button
						variant="tertiary"
						size="small"
						icon={<PlusIcon aria-hidden />}
						onClick={() => addModalRef.current?.showModal()}
					>
						Legg til gruppe
					</Button>
					<Link to="/admin">← Tilbake til admin</Link>
				</HStack>
			</HStack>

			<GroupTable groups={groups} />

			<AuditLogSection auditLog={auditLog} />

			<AddGroupModal modalRef={addModalRef} existingGroupIds={groups.map((g) => g.groupId)} />
		</VStack>
	)
}

// ─── Add Group Modal ──────────────────────────────────────────────────────────

interface GroupSearchResult {
	id: string
	displayName: string
}

function AddGroupModal({
	modalRef,
	existingGroupIds,
}: {
	modalRef: React.RefObject<HTMLDialogElement | null>
	existingGroupIds: string[]
}) {
	const searchFetcher = useFetcher<{ results: GroupSearchResult[] }>()
	const addFetcher = useFetcher<{ success?: boolean; error?: string }>()
	const [searchValue, setSearchValue] = useState("")
	const [addingGroupId, setAddingGroupId] = useState<string | null>(null)
	const [dismissedError, setDismissedError] = useState(false)
	const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null)

	const isSearching = searchFetcher.state === "loading"
	const isAdding = addFetcher.state === "submitting"
	const searchResults = searchFetcher.data?.results ?? []
	const addError = !dismissedError ? addFetcher.data?.error : undefined

	const handleSearch = useCallback(
		(value: string) => {
			setSearchValue(value)
			if (searchTimeoutRef.current) {
				clearTimeout(searchTimeoutRef.current)
			}
			if (value.trim().length < 2) {
				return
			}
			searchTimeoutRef.current = setTimeout(() => {
				searchFetcher.load(`/api/graph/groups?q=${encodeURIComponent(value.trim())}`)
			}, 300)
		},
		[searchFetcher],
	)

	const handleAddGroup = useCallback(
		(group: GroupSearchResult) => {
			setAddingGroupId(group.id)
			setDismissedError(false)
			addFetcher.submit({ intent: "add-group", groupId: group.id, groupName: group.displayName }, { method: "post" })
		},
		[addFetcher],
	)

	// Close modal and reset on successful add
	useEffect(() => {
		if (addFetcher.data?.success && addFetcher.state === "idle") {
			setSearchValue("")
			setAddingGroupId(null)
			modalRef.current?.close()
		}
	}, [addFetcher.data, addFetcher.state, modalRef])

	// Cleanup debounce on unmount
	useEffect(() => {
		return () => {
			if (searchTimeoutRef.current) {
				clearTimeout(searchTimeoutRef.current)
			}
		}
	}, [])

	const handleClose = () => {
		setSearchValue("")
		setAddingGroupId(null)
		setDismissedError(true)
		modalRef.current?.close()
	}

	return (
		<Modal ref={modalRef} header={{ heading: "Legg til RPA-gruppe" }} onClose={handleClose}>
			<Modal.Body>
				<VStack gap="space-4">
					{addError && (
						<Alert variant="error" size="small">
							{addError}
						</Alert>
					)}
					<Search
						label="Søk etter Entra ID-gruppe"
						value={searchValue}
						onChange={handleSearch}
						onClear={() => {
							if (searchTimeoutRef.current) {
								clearTimeout(searchTimeoutRef.current)
							}
							setSearchValue("")
						}}
						disabled={isAdding}
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
							{isSearching ? (
								<BodyShort size="small">Søker…</BodyShort>
							) : searchResults.length === 0 ? (
								<BodyShort size="small">Ingen grupper funnet.</BodyShort>
							) : (
								<Table size="small">
									<Table.Body>
										{searchResults.map((group) => {
											const alreadyAdded = existingGroupIds.includes(group.id)
											return (
												<Table.Row key={group.id}>
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
														{alreadyAdded ? (
															<Tag variant="neutral" size="small">
																Allerede lagt til
															</Tag>
														) : (
															<Button
																variant="tertiary"
																size="xsmall"
																onClick={() => handleAddGroup(group)}
																loading={isAdding && addingGroupId === group.id}
																disabled={isAdding}
															>
																Legg til
															</Button>
														)}
													</Table.DataCell>
												</Table.Row>
											)
										})}
									</Table.Body>
								</Table>
							)}
						</section>
					)}
				</VStack>
			</Modal.Body>
			<Modal.Footer>
				<Button variant="secondary" size="small" onClick={handleClose}>
					Lukk
				</Button>
			</Modal.Footer>
		</Modal>
	)
}

// ─── Group Table ──────────────────────────────────────────────────────────────

interface GroupWithStats {
	id: string
	groupId: string
	groupName: string | null
	createdBy: string
	createdAt: Date
	memberCount: number
	lastSyncedAt: string | null
}

function GroupTable({ groups }: { groups: GroupWithStats[] }) {
	const [removeTarget, setRemoveTarget] = useState<GroupWithStats | null>(null)

	if (groups.length === 0) {
		return (
			<Alert variant="info" size="small">
				Ingen RPA-grupper er konfigurert ennå. Bruk «Legg til gruppe»-knappen for å legge til en Entra ID-gruppe.
			</Alert>
		)
	}

	return (
		<>
			{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable container needs keyboard access */}
			<section className="table-scroll" tabIndex={0} aria-label="RPA-grupper">
				<Table size="small">
					<Table.Header>
						<Table.Row>
							<Table.HeaderCell>Gruppenavn</Table.HeaderCell>
							<Table.HeaderCell>Medlemmer</Table.HeaderCell>
							<Table.HeaderCell>Sist synkronisert</Table.HeaderCell>
							<Table.HeaderCell>Lagt til av</Table.HeaderCell>
							<Table.HeaderCell>Handlinger</Table.HeaderCell>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{groups.map((group) => (
							<GroupRow key={group.id} group={group} onRemove={() => setRemoveTarget(group)} />
						))}
					</Table.Body>
				</Table>
			</section>

			<RemoveGroupModal group={removeTarget} onClose={() => setRemoveTarget(null)} />
		</>
	)
}

function GroupRow({ group, onRemove }: { group: GroupWithStats; onRemove: () => void }) {
	return (
		<Table.Row>
			<Table.DataCell>
				<VStack gap="space-1">
					<HStack gap="space-1" align="center">
						<BodyShort size="small" weight="semibold">
							{group.groupName ?? "Ukjent gruppenavn"}
						</BodyShort>
						<CopyButton copyText={group.groupName ?? group.groupId} size="xsmall" />
					</HStack>
					<HStack gap="space-1" align="center">
						<Detail textColor="subtle" style={{ fontFamily: "monospace" }}>
							{group.groupId}
						</Detail>
						<CopyButton copyText={group.groupId} size="xsmall" />
					</HStack>
				</VStack>
			</Table.DataCell>
			<Table.DataCell>
				<Tag variant={group.memberCount > 0 ? "info" : "neutral"} size="small">
					{group.memberCount}
				</Tag>
			</Table.DataCell>
			<Table.DataCell>
				{group.lastSyncedAt ? (
					<Detail>{new Date(group.lastSyncedAt).toLocaleString("nb-NO")}</Detail>
				) : (
					<Detail textColor="subtle">Ikke synkronisert</Detail>
				)}
			</Table.DataCell>
			<Table.DataCell>
				<Detail>{group.createdBy}</Detail>
			</Table.DataCell>
			<Table.DataCell>
				<HStack gap="space-2">
					<Button variant="tertiary" size="xsmall" onClick={onRemove}>
						Fjern
					</Button>
				</HStack>
			</Table.DataCell>
		</Table.Row>
	)
}

// ─── Remove Group Modal ───────────────────────────────────────────────────────

function RemoveGroupModal({ group, onClose }: { group: GroupWithStats | null; onClose: () => void }) {
	const fetcher = useFetcher<{ success?: boolean; error?: string }>()
	const isSubmitting = fetcher.state === "submitting"

	useEffect(() => {
		if (fetcher.data?.success && fetcher.state === "idle") {
			onClose()
		}
	}, [fetcher.data, fetcher.state, onClose])

	if (!group) return null

	return (
		<Modal open onClose={onClose} header={{ heading: "Fjern RPA-gruppe" }}>
			<Modal.Body>
				<VStack gap="space-4">
					{fetcher.data?.error && (
						<Alert variant="error" size="small">
							{fetcher.data.error}
						</Alert>
					)}
					<BodyLong>
						Er du sikker på at du vil fjerne gruppen <strong>{group.groupName ?? group.groupId}</strong>?
					</BodyLong>
					<BodyLong size="small">
						Gruppen og alle dens {group.memberCount} medlemmer vil bli arkivert. Dette kan ikke angres.
					</BodyLong>
				</VStack>
			</Modal.Body>
			<Modal.Footer>
				<fetcher.Form method="post">
					<input type="hidden" name="intent" value="remove-group" />
					<input type="hidden" name="groupDbId" value={group.id} />
					<HStack gap="space-4">
						<Button variant="danger" size="small" type="submit" loading={isSubmitting}>
							Fjern gruppe
						</Button>
						<Button variant="tertiary" size="small" type="button" onClick={onClose}>
							Avbryt
						</Button>
					</HStack>
				</fetcher.Form>
			</Modal.Footer>
		</Modal>
	)
}

// ─── Audit Log Section ────────────────────────────────────────────────────────

interface AuditEntry {
	id: string
	action: string
	performedBy: string
	performedAt: Date
	newValue: string | null
}

function AuditLogSection({ auditLog }: { auditLog: AuditEntry[] }) {
	if (auditLog.length === 0) return null

	return (
		<ReadMore header="Synkroniseringslogg" defaultOpen={false}>
			<Table size="small">
				<Table.Header>
					<Table.Row>
						<Table.HeaderCell>Tidspunkt</Table.HeaderCell>
						<Table.HeaderCell>Detaljer</Table.HeaderCell>
						<Table.HeaderCell>Utført av</Table.HeaderCell>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{auditLog.map((entry) => {
						let details: { groupsSynced?: number; totalAdded?: number; totalArchived?: number } | null = null
						try {
							details = entry.newValue ? JSON.parse(entry.newValue) : null
						} catch {
							// Malformed JSON — show fallback
						}
						return (
							<Table.Row key={entry.id}>
								<Table.DataCell>
									<Detail>{new Date(entry.performedAt).toLocaleString("nb-NO")}</Detail>
								</Table.DataCell>
								<Table.DataCell>
									{details ? (
										<Detail>
											{details.groupsSynced} grupper synkronisert, +{details.totalAdded} lagt til, −
											{details.totalArchived} arkivert
										</Detail>
									) : (
										<Detail textColor="subtle">Ingen detaljer</Detail>
									)}
								</Table.DataCell>
								<Table.DataCell>
									<Detail>{entry.performedBy}</Detail>
								</Table.DataCell>
							</Table.Row>
						)
					})}
				</Table.Body>
			</Table>
		</ReadMore>
	)
}
