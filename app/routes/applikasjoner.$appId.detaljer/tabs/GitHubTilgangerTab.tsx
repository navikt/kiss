import { BodyLong, BodyShort, Detail, Heading, HStack, Link, Table, Tag, VStack } from "@navikt/ds-react"
import { useState } from "react"
import { GithubPermissionTag } from "~/components/GithubPermissionTag"
import { computeGithubUserAccess, type GithubUserAccess, githubProfileUrl } from "~/lib/github-user-access"

interface TeamMember {
	username: string
	role: string
	displayName?: string | null
	navIdent?: string | null
}

interface GitHubTeam {
	id: string
	teamSlug: string
	teamName: string
	permission: string
	syncedAt: string
	members: TeamMember[]
}

interface GitHubCollaborator {
	id: string
	username: string
	permission: string
	syncedAt: string
	displayName?: string | null
	navIdent?: string | null
}

interface ChangeLogEntry {
	id: string
	action: string
	previousValue: string | null
	newValue: string | null
	metadata: string | null
	performedBy: string
	performedAt: string
}

interface Props {
	teams: GitHubTeam[]
	collaborators: GitHubCollaborator[]
	changeLog: ChangeLogEntry[]
}

function GitHubUser({
	username,
	displayName,
	navIdent,
}: Pick<GithubUserAccess, "username" | "displayName" | "navIdent">) {
	const normalizedDisplayName = displayName?.trim() || null
	const normalizedNavIdent = navIdent?.trim() || null

	return (
		<VStack gap="space-1">
			{normalizedDisplayName && <BodyShort>{normalizedDisplayName}</BodyShort>}
			<HStack gap="space-2" align="center" wrap>
				<Link href={githubProfileUrl(username)} target="_blank" rel="noopener noreferrer">
					{normalizedDisplayName ? `@${username}` : username}
				</Link>
				{normalizedNavIdent && <Detail>{normalizedNavIdent}</Detail>}
			</HStack>
		</VStack>
	)
}

function UserSourcesContent({ user }: { user: GithubUserAccess }) {
	return (
		<VStack gap="space-4">
			{user.directPermission && (
				<HStack gap="space-2" align="center">
					<Detail weight="semibold">Direkte tilgang:</Detail>
					<Tag variant="alt3" size="xsmall">
						{user.directPermission}
					</Tag>
				</HStack>
			)}
			{user.viaTeams.length > 0 && (
				<VStack gap="space-1">
					<Detail weight="semibold">Via team:</Detail>
					{user.viaTeams.map((team) => (
						<HStack key={team.teamSlug} gap="space-2" align="center">
							<BodyShort size="small">{team.teamName || team.teamSlug}</BodyShort>
							<Tag variant="neutral" size="xsmall">
								{team.permission}
							</Tag>
						</HStack>
					))}
				</VStack>
			)}
		</VStack>
	)
}

function formatAction(action: string): string {
	const labels: Record<string, string> = {
		github_access_team_added: "Team lagt til",
		github_access_team_removed: "Team fjernet",
		github_access_team_permission_changed: "Team-tilgang endret",
		github_access_team_updated: "Team oppdatert",
		github_access_collaborator_added: "Bruker lagt til",
		github_access_collaborator_removed: "Bruker fjernet",
		github_access_collaborator_permission_changed: "Brukertilgang endret",
		github_access_team_member_added: "Teammedlem lagt til",
		github_access_team_member_removed: "Teammedlem fjernet",
		github_access_team_member_role_changed: "Teammedlem-rolle endret",
		github_access_sync_status_recorded: "Synkronisert mot GitHub",
	}
	return labels[action] ?? action
}

function formatChangeDetails(entry: ChangeLogEntry): string {
	try {
		const prev = entry.previousValue ? JSON.parse(entry.previousValue) : null
		const next = entry.newValue ? JSON.parse(entry.newValue) : null

		if (entry.action === "github_access_sync_status_recorded") {
			return next?.gitRepository ? `Repo: ${next.gitRepository}` : ""
		}

		// Team permission changed — show team + old → new permission (must be before generic permission_changed)
		if (entry.action === "github_access_team_permission_changed") {
			const teamName = next?.teamName ?? next?.teamSlug ?? prev?.teamSlug ?? ""
			const oldPerm = prev?.permission ?? ""
			const newPerm = next?.permission ?? ""
			return `Team: ${teamName} (${oldPerm} → ${newPerm})`
		}

		// Permission changed (collaborator) — show identifier + old → new
		if (entry.action.includes("permission_changed")) {
			const identifier = prev?.username ?? next?.username ?? ""
			const oldPerm = prev?.permission ?? ""
			const newPerm = next?.permission ?? ""
			return `${identifier}: ${oldPerm} → ${newPerm}`
		}

		// Team member role changed — show team + username + old → new role
		if (entry.action.includes("team_member_role_changed")) {
			const username = prev?.username ?? next?.username ?? ""
			const team = prev?.teamSlug ?? next?.teamSlug ?? ""
			const oldRole = prev?.role ?? ""
			const newRole = next?.role ?? ""
			return `${team}: ${username} ${oldRole} → ${newRole}`
		}

		// Team member added/removed — show team + username (role)
		if (entry.action.includes("team_member")) {
			const data = next ?? prev
			const team = data?.teamSlug ?? ""
			return `${team}: ${data?.username ?? ""} (${data?.role ?? ""})`
		}

		// Team updated (name change) — show old → new
		if (entry.action === "github_access_team_updated") {
			const oldName = prev?.teamName ?? prev?.teamSlug ?? ""
			const newName = next?.teamName ?? next?.teamSlug ?? ""
			return `Team: ${oldName} → ${newName}`
		}

		// Team added/removed
		if (next?.teamSlug) return `Team: ${next.teamName ?? next.teamSlug} (${next.permission ?? ""})`
		if (prev?.teamSlug) return `Team: ${prev.teamName ?? prev.teamSlug} (${prev.permission ?? ""})`

		// Collaborator added/removed
		if (next?.username) return `${next.username} (${next.permission ?? ""})`
		if (prev?.username) return `${prev.username} (${prev.permission ?? ""})`
	} catch {
		// Ignore JSON parse errors
	}
	return ""
}

function TeamRow({ team }: { team: GitHubTeam }) {
	const [expanded, setExpanded] = useState(false)
	const canExpand = team.members.length > 0

	return (
		<>
			<Table.Row>
				<Table.DataCell>
					{canExpand ? (
						<button
							type="button"
							onClick={() => setExpanded(!expanded)}
							aria-expanded={expanded}
							aria-label={`${expanded ? "Skjul" : "Vis"} medlemmer av ${team.teamName}`}
							style={{
								background: "none",
								border: "none",
								cursor: "pointer",
								padding: 0,
								font: "inherit",
								color: "inherit",
							}}
						>
							<span style={{ marginRight: "0.5rem" }}>{expanded ? "▼" : "▶"}</span>
							{team.teamName}
						</button>
					) : (
						team.teamName
					)}
				</Table.DataCell>
				<Table.DataCell>
					<GithubPermissionTag permission={team.permission} />
				</Table.DataCell>
				<Table.DataCell>{team.members.length}</Table.DataCell>
				<Table.DataCell>{new Date(team.syncedAt).toLocaleDateString("nb-NO")}</Table.DataCell>
			</Table.Row>
			{expanded &&
				team.members.map((member) => (
					<Table.Row key={`${team.id}-${member.username}`}>
						<Table.DataCell style={{ paddingLeft: "2.5rem" }}>
							<GitHubUser
								username={member.username}
								displayName={member.displayName ?? null}
								navIdent={member.navIdent ?? null}
							/>
						</Table.DataCell>
						<Table.DataCell>
							<Tag variant="neutral" size="xsmall">
								{member.role}
							</Tag>
						</Table.DataCell>
						<Table.DataCell />
						<Table.DataCell />
					</Table.Row>
				))}
		</>
	)
}

export function GitHubTilgangerTab({ teams, collaborators, changeLog }: Props) {
	const hasData = teams.length > 0 || collaborators.length > 0
	const allUsers = computeGithubUserAccess(teams, collaborators)

	if (!hasData && changeLog.length === 0) {
		return <BodyLong>Ingen GitHub-tilgangsdata synkronisert ennå.</BodyLong>
	}

	return (
		<VStack gap="space-8">
			{allUsers.length > 0 && (
				<section>
					<Heading size="small" spacing>
						Alle brukere med tilgang ({allUsers.length})
					</Heading>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollbar container for keyboard users */}
					<section className="table-scroll" tabIndex={0} aria-label="Alle GitHub-brukere med tilgang">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col" />
									<Table.HeaderCell scope="col">Bruker</Table.HeaderCell>
									<Table.HeaderCell scope="col">Høyeste tilgang</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{allUsers.map((user) => (
									<Table.ExpandableRow key={user.username} content={<UserSourcesContent user={user} />} colSpan={3}>
										<Table.DataCell>
											<GitHubUser username={user.username} displayName={user.displayName} navIdent={user.navIdent} />
										</Table.DataCell>
										<Table.DataCell>
											<GithubPermissionTag permission={user.highestPermission} />
										</Table.DataCell>
									</Table.ExpandableRow>
								))}
							</Table.Body>
						</Table>
					</section>
				</section>
			)}

			{teams.length > 0 && (
				<section>
					<Heading size="small" spacing>
						Team med tilgang
					</Heading>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollbar container for keyboard users */}
					<section className="table-scroll" tabIndex={0} aria-label="GitHub-team med tilgang">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Team</Table.HeaderCell>
									<Table.HeaderCell scope="col">Tilgang</Table.HeaderCell>
									<Table.HeaderCell scope="col">Medlemmer</Table.HeaderCell>
									<Table.HeaderCell scope="col">Sist synkronisert</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{teams.map((team) => (
									<TeamRow key={team.id} team={team} />
								))}
							</Table.Body>
						</Table>
					</section>
				</section>
			)}

			{collaborators.length > 0 && (
				<section>
					<Heading size="small" spacing>
						Individuelle brukere
					</Heading>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollbar container for keyboard users */}
					<section className="table-scroll" tabIndex={0} aria-label="Individuelle GitHub-brukere">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Bruker</Table.HeaderCell>
									<Table.HeaderCell scope="col">Tilgang</Table.HeaderCell>
									<Table.HeaderCell scope="col">Sist synkronisert</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{collaborators.map((collab) => (
									<Table.Row key={collab.id}>
										<Table.DataCell>
											<GitHubUser
												username={collab.username}
												displayName={collab.displayName ?? null}
												navIdent={collab.navIdent ?? null}
											/>
										</Table.DataCell>
										<Table.DataCell>
											<GithubPermissionTag permission={collab.permission} />
										</Table.DataCell>
										<Table.DataCell>{new Date(collab.syncedAt).toLocaleDateString("nb-NO")}</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				</section>
			)}

			{changeLog.length > 0 && (
				<section>
					<Heading size="small" spacing>
						Endringslogg
					</Heading>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollbar container for keyboard users */}
					<section className="table-scroll" tabIndex={0} aria-label="GitHub-tilgangs endringslogg">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Tidspunkt</Table.HeaderCell>
									<Table.HeaderCell scope="col">Handling</Table.HeaderCell>
									<Table.HeaderCell scope="col">Detaljer</Table.HeaderCell>
									<Table.HeaderCell scope="col">Utført av</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{changeLog.map((entry) => (
									<Table.Row key={entry.id}>
										<Table.DataCell>
											{new Date(entry.performedAt).toLocaleString("nb-NO", {
												day: "2-digit",
												month: "2-digit",
												year: "numeric",
												hour: "2-digit",
												minute: "2-digit",
											})}
										</Table.DataCell>
										<Table.DataCell>{formatAction(entry.action)}</Table.DataCell>
										<Table.DataCell>{formatChangeDetails(entry)}</Table.DataCell>
										<Table.DataCell>{entry.performedBy}</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				</section>
			)}
		</VStack>
	)
}
