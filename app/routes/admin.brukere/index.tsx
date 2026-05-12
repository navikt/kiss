import { PlusIcon } from "@navikt/aksel-icons"
import {
	Alert,
	BodyLong,
	BodyShort,
	Button,
	Heading,
	HStack,
	Modal,
	Select,
	type SortState,
	Table,
	Tag,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { useMemo, useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, useActionData, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAllTeams } from "~/db/queries/applications.server"
import { getSections } from "~/db/queries/sections.server"
import { assignRole, listUsersWithRoles, removeRole, type UserWithRoles } from "~/db/queries/users.server"
import { roleScopeMap, type UserRole, userRoleEnum, userRoleLabels } from "~/db/schema/organization"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"

export async function loader({ request }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const [users, sections, teams] = await Promise.all([listUsersWithRoles(), getSections(), getAllTeams()])

	return data({
		users,
		sections: sections.map((s) => ({ id: s.id, name: s.name })),
		teams: teams.map((t) => ({ id: t.id, name: t.name, sectionId: t.sectionId })),
	})
}

type ActionResult = { success: true; message: string } | { success: false; error: string }

export async function action({ request }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const formData = await request.formData()
	const intent = formData.get("intent")

	switch (intent) {
		case "assign-role": {
			const navIdent = formData.get("navIdent")
			const name = formData.get("name")
			const role = formData.get("role")
			const sectionId = formData.get("sectionId") || undefined
			const devTeamId = formData.get("devTeamId") || undefined

			if (typeof navIdent !== "string" || !navIdent.trim() || typeof name !== "string" || !name.trim()) {
				return data<ActionResult>({
					success: false,
					error: "NAV-ident og navn er påkrevd.",
				})
			}
			if (typeof role !== "string" || !userRoleEnum.includes(role as UserRole)) {
				return data<ActionResult>({
					success: false,
					error: "Ugyldig rolle.",
				})
			}

			await assignRole(
				navIdent.trim().toUpperCase(),
				name.trim(),
				role as UserRole,
				authedUser.navIdent,
				typeof sectionId === "string" ? sectionId : undefined,
				typeof devTeamId === "string" ? devTeamId : undefined,
			)

			return data<ActionResult>({
				success: true,
				message: `Rolle «${userRoleLabels[role as UserRole]}» tildelt ${name.trim()}.`,
			})
		}

		case "remove-role": {
			const roleId = formData.get("roleId")
			if (
				typeof roleId !== "string" ||
				!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roleId)
			) {
				return data<ActionResult>({
					success: false,
					error: "Mangler eller ugyldig rolle-ID.",
				})
			}
			await removeRole(roleId, authedUser.navIdent)
			return data<ActionResult>({
				success: true,
				message: "Rolle fjernet.",
			})
		}

		default:
			return data<ActionResult>({
				success: false,
				error: "Ugyldig handling.",
			})
	}
}

function RemoveRoleModal({
	open,
	onClose,
	roleId,
	roleName,
	userName,
}: {
	open: boolean
	onClose: () => void
	roleId: string
	roleName: string
	userName: string
}) {
	return (
		<Modal open={open} onClose={onClose} header={{ heading: "Fjern rolle" }}>
			<Modal.Body>
				<BodyLong>
					Er du sikker på at du vil fjerne rollen «{roleName}» fra {userName}?
				</BodyLong>
			</Modal.Body>
			<Modal.Footer>
				<Form method="post" onSubmit={onClose}>
					<input type="hidden" name="intent" value="remove-role" />
					<input type="hidden" name="roleId" value={roleId} />
					<HStack gap="space-4">
						<Button type="submit" variant="danger">
							Fjern
						</Button>
						<Button type="button" variant="tertiary" onClick={onClose}>
							Avbryt
						</Button>
					</HStack>
				</Form>
			</Modal.Footer>
		</Modal>
	)
}

function AddRoleModal({
	open,
	onClose,
	user,
	sections,
	teams,
}: {
	open: boolean
	onClose: () => void
	user: UserWithRoles
	sections: Array<{ id: string; name: string }>
	teams: Array<{ id: string; name: string; sectionId: string }>
}) {
	const [selectedRole, setSelectedRole] = useState<UserRole | "">("")
	const [selectedSectionId, setSelectedSectionId] = useState("")

	const scope = selectedRole ? roleScopeMap[selectedRole] : null
	const showSection = scope === "section" || scope === "team"
	const showTeam = scope === "team"
	const filteredTeams = showTeam ? teams.filter((t) => t.sectionId === selectedSectionId) : []

	const handleClose = () => {
		setSelectedRole("")
		setSelectedSectionId("")
		onClose()
	}

	return (
		<Modal open={open} onClose={handleClose} header={{ heading: `Tildel rolle til ${user.name}` }}>
			<Form method="post" onSubmit={handleClose}>
				<Modal.Body>
					<input type="hidden" name="intent" value="assign-role" />
					<input type="hidden" name="navIdent" value={user.navIdent} />
					<input type="hidden" name="name" value={user.name} />
					<VStack gap="space-4">
						<Select
							label="Rolle"
							name="role"
							value={selectedRole}
							onChange={(e) => {
								setSelectedRole(e.target.value as UserRole | "")
								setSelectedSectionId("")
							}}
						>
							<option value="">Velg rolle</option>
							<optgroup label="Globale roller">
								{userRoleEnum
									.filter((r) => roleScopeMap[r] === "global")
									.map((r) => (
										<option key={r} value={r}>
											{userRoleLabels[r]}
										</option>
									))}
							</optgroup>
							<optgroup label="Seksjonsroller">
								{userRoleEnum
									.filter((r) => roleScopeMap[r] === "section")
									.map((r) => (
										<option key={r} value={r}>
											{userRoleLabels[r]}
										</option>
									))}
							</optgroup>
							<optgroup label="Teamroller">
								{userRoleEnum
									.filter((r) => roleScopeMap[r] === "team")
									.map((r) => (
										<option key={r} value={r}>
											{userRoleLabels[r]}
										</option>
									))}
							</optgroup>
						</Select>
						{showSection && (
							<Select
								label="Seksjon"
								name="sectionId"
								value={selectedSectionId}
								onChange={(e) => setSelectedSectionId(e.target.value)}
							>
								<option value="">Velg seksjon</option>
								{sections.map((s) => (
									<option key={s.id} value={s.id}>
										{s.name}
									</option>
								))}
							</Select>
						)}
						{showTeam && (
							<Select label="Team" name="devTeamId" disabled={!selectedSectionId}>
								<option value="">{selectedSectionId ? "Velg team" : "Velg seksjon først"}</option>
								{filteredTeams.map((t) => (
									<option key={t.id} value={t.id}>
										{t.name}
									</option>
								))}
							</Select>
						)}
					</VStack>
				</Modal.Body>
				<Modal.Footer>
					<HStack gap="space-4">
						<Button type="submit" variant="primary">
							Tildel rolle
						</Button>
						<Button type="button" variant="tertiary" onClick={handleClose}>
							Avbryt
						</Button>
					</HStack>
				</Modal.Footer>
			</Form>
		</Modal>
	)
}

function UserRow({
	user,
	sections,
	teams,
}: {
	user: UserWithRoles
	sections: Array<{ id: string; name: string }>
	teams: Array<{ id: string; name: string; sectionId: string }>
}) {
	const [removeOpen, setRemoveOpen] = useState<string | null>(null)
	const [addRoleOpen, setAddRoleOpen] = useState(false)

	return (
		<>
			<Table.Row>
				<Table.DataCell>{user.navIdent}</Table.DataCell>
				<Table.DataCell>{user.name}</Table.DataCell>
				<Table.DataCell>{user.email ?? "–"}</Table.DataCell>
				<Table.DataCell>
					{user.lastLoginAt
						? new Date(user.lastLoginAt).toLocaleString("nb-NO", {
								day: "2-digit",
								month: "2-digit",
								year: "numeric",
								hour: "2-digit",
								minute: "2-digit",
							})
						: "–"}
				</Table.DataCell>
				<Table.DataCell>
					<HStack gap="space-2" wrap align="center">
						{user.roles.length === 0 && (
							<BodyShort size="small" textColor="subtle">
								Ingen roller
							</BodyShort>
						)}
						{user.roles.map((r) => {
							const scope = r.sectionName ?? r.devTeamName
							return (
								<HStack key={r.id} gap="space-1" align="center">
									<Tag variant="info" size="xsmall">
										{userRoleLabels[r.role]}
										{scope ? ` (${scope})` : ""}
									</Tag>
									<Button
										variant="tertiary-neutral"
										size="xsmall"
										onClick={() => setRemoveOpen(r.id)}
										aria-label={`Fjern rolle ${userRoleLabels[r.role]}`}
									>
										✕
									</Button>
								</HStack>
							)
						})}
						<Button
							variant="tertiary"
							size="xsmall"
							icon={<PlusIcon aria-hidden />}
							onClick={() => setAddRoleOpen(true)}
							aria-label={`Legg til rolle for ${user.name}`}
						>
							Rolle
						</Button>
					</HStack>
				</Table.DataCell>
			</Table.Row>
			{user.roles.map((r) => (
				<RemoveRoleModal
					key={r.id}
					open={removeOpen === r.id}
					onClose={() => setRemoveOpen(null)}
					roleId={r.id}
					roleName={userRoleLabels[r.role]}
					userName={user.name}
				/>
			))}
			<AddRoleModal
				open={addRoleOpen}
				onClose={() => setAddRoleOpen(false)}
				user={user}
				sections={sections}
				teams={teams}
			/>
		</>
	)
}

export default function AdminBrukere() {
	const { users, sections, teams } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const [filter, setFilter] = useState("")
	const [sort, setSort] = useState<SortState | undefined>({ orderBy: "name", direction: "ascending" })

	const filtered = filter
		? users.filter(
				(u) =>
					u.navIdent.toLowerCase().includes(filter.toLowerCase()) ||
					u.name.toLowerCase().includes(filter.toLowerCase()),
			)
		: users

	const sorted = useMemo(() => {
		if (!sort) return filtered
		const dir = sort.direction === "ascending" ? 1 : -1
		return [...filtered].sort((a, b) => {
			switch (sort.orderBy) {
				case "navIdent":
					return dir * a.navIdent.localeCompare(b.navIdent)
				case "name":
					return dir * a.name.localeCompare(b.name)
				case "email":
					return dir * (a.email ?? "").localeCompare(b.email ?? "")
				case "lastLogin":
					return dir * (a.lastLoginAt ?? "").toString().localeCompare((b.lastLoginAt ?? "").toString())
				case "roles":
					return dir * (a.roles.length - b.roles.length)
				default:
					return 0
			}
		})
	}, [filtered, sort])

	const handleSort = (sortKey: string) => {
		setSort((prev) =>
			prev && prev.orderBy === sortKey
				? { orderBy: sortKey, direction: prev.direction === "ascending" ? "descending" : "ascending" }
				: { orderBy: sortKey, direction: "ascending" },
		)
	}

	return (
		<VStack gap="space-6">
			<Heading size="xlarge" level="2">
				Brukere og roller
			</Heading>
			<BodyLong>Administrer roller for brukere. Roller kan knyttes til en seksjon eller et team.</BodyLong>

			{actionData && "success" in actionData && actionData.success && (
				<Alert variant="success">{actionData.message}</Alert>
			)}
			{actionData && "success" in actionData && !actionData.success && (
				<Alert variant="error">{actionData.error}</Alert>
			)}

			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Brukere ({users.length})
				</Heading>
				<TextField
					label="Søk"
					description="Søk på NAV-ident eller navn"
					value={filter}
					onChange={(e) => setFilter(e.target.value)}
					htmlSize={30}
				/>
				{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
				<section className="table-scroll" tabIndex={0} aria-label="Brukere og roller">
					<Table size="small" sort={sort} onSortChange={handleSort}>
						<Table.Header>
							<Table.Row>
								<Table.ColumnHeader sortKey="navIdent" sortable scope="col">
									NAV-ident
								</Table.ColumnHeader>
								<Table.ColumnHeader sortKey="name" sortable scope="col">
									Navn
								</Table.ColumnHeader>
								<Table.ColumnHeader sortKey="email" sortable scope="col">
									E-post
								</Table.ColumnHeader>
								<Table.ColumnHeader sortKey="lastLogin" sortable scope="col">
									Sist logget inn
								</Table.ColumnHeader>
								<Table.ColumnHeader sortKey="roles" sortable scope="col">
									Roller
								</Table.ColumnHeader>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{sorted.map((u) => (
								<UserRow key={u.id} user={u} sections={sections} teams={teams} />
							))}
							{filtered.length === 0 && (
								<Table.Row>
									<Table.DataCell colSpan={5}>
										<BodyLong size="small" textColor="subtle">
											{filter ? "Ingen brukere matcher søket." : "Ingen brukere registrert ennå."}
										</BodyLong>
									</Table.DataCell>
								</Table.Row>
							)}
						</Table.Body>
					</Table>
				</section>
			</VStack>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
