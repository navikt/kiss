import { BodyLong, Heading, Table, Tag, VStack } from "@navikt/ds-react"
import { useState } from "react"

interface TeamMember {
	username: string
	role: string
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

function permissionTag(permission: string) {
	const variants: Record<string, "warning" | "error" | "success" | "info" | "neutral"> = {
		admin: "error",
		maintain: "warning",
		push: "success",
		write: "success",
		triage: "info",
		pull: "neutral",
		read: "neutral",
	}
	return (
		<Tag variant={variants[permission] ?? "neutral"} size="xsmall">
			{permission}
		</Tag>
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
	}
	return labels[action] ?? action
}

function formatChangeDetails(entry: ChangeLogEntry): string {
	try {
		const prev = entry.previousValue ? JSON.parse(entry.previousValue) : null
		const next = entry.newValue ? JSON.parse(entry.newValue) : null

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
				<Table.DataCell>{permissionTag(team.permission)}</Table.DataCell>
				<Table.DataCell>{team.members.length}</Table.DataCell>
				<Table.DataCell>{new Date(team.syncedAt).toLocaleDateString("nb-NO")}</Table.DataCell>
			</Table.Row>
			{expanded &&
				team.members.map((member) => (
					<Table.Row key={`${team.id}-${member.username}`}>
						<Table.DataCell style={{ paddingLeft: "2.5rem" }}>
							<a href={`https://github.com/${member.username}`} target="_blank" rel="noopener noreferrer">
								{member.username}
							</a>
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

	if (!hasData && changeLog.length === 0) {
		return <BodyLong>Ingen GitHub-tilgangsdata synkronisert ennå.</BodyLong>
	}

	return (
		<VStack gap="space-8">
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
									<Table.HeaderCell scope="col">Brukernavn</Table.HeaderCell>
									<Table.HeaderCell scope="col">Tilgang</Table.HeaderCell>
									<Table.HeaderCell scope="col">Sist synkronisert</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{collaborators.map((collab) => (
									<Table.Row key={collab.id}>
										<Table.DataCell>
											<a href={`https://github.com/${collab.username}`} target="_blank" rel="noopener noreferrer">
												{collab.username}
											</a>
										</Table.DataCell>
										<Table.DataCell>{permissionTag(collab.permission)}</Table.DataCell>
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
