import {
	clearDevTeamEntraMembers,
	getDevTeamsWithEntraGroup,
	syncDevTeamEntraMembers,
} from "~/db/queries/dev-team-entra.server"
import { fetchTeamEntraMembers } from "./graph.server"
import { withAdvisoryLock } from "./lock.server"
import { logger } from "./logger.server"

export interface EntraTeamSyncResult {
	teamsSynced: number
	teamsGroupDeleted: number
	totalAdded: number
	totalArchived: number
	totalRolesRevoked: number
}

/**
 * Synker automatisk teammedlemskap fra Entra ID-grupper koblet til team.
 *
 * Graph-kall skjer utenfor advisory-låsen (langsomme HTTP-kall skal ikke
 * holde en DB-tilkobling). Per team: 404 (gruppe slettet) tømmer cachen
 * umiddelbart, alle andre feil beholder eksisterende cache uendret og
 * prøves på nytt neste kjøring. Query-laget re-verifiserer at teamet
 * fortsatt er koblet til samme Entra-gruppe før mutasjon, for å unngå å
 * skrive cache for en gruppe som er koblet fra mellom Graph-kallet og
 * denne skrivingen.
 */
export async function runEntraTeamMemberSync(options: { jobId?: string } = {}): Promise<EntraTeamSyncResult | null> {
	const teams = await getDevTeamsWithEntraGroup()
	if (teams.length === 0) {
		logger.info("[entra-team-sync] Ingen team koblet til Entra-gruppe — hopper over")
		return { teamsSynced: 0, teamsGroupDeleted: 0, totalAdded: 0, totalArchived: 0, totalRolesRevoked: 0 }
	}

	const fetched: Array<{
		team: (typeof teams)[number]
		members: Awaited<ReturnType<typeof fetchTeamEntraMembers>>
	}> = []

	for (const team of teams) {
		try {
			const members = await fetchTeamEntraMembers(team.entraGroupId)
			fetched.push({ team, members })
		} catch (err) {
			logger.error(
				`[entra-team-sync] Graph-kall feilet for team "${team.teamName}" (${team.entraGroupId}) — beholder eksisterende cache`,
				err instanceof Error ? err : new Error(String(err)),
			)
		}
	}

	if (fetched.length === 0) {
		logger.warn("[entra-team-sync] Alle Graph-kall feilet — ingenting å synke")
		return { teamsSynced: 0, teamsGroupDeleted: 0, totalAdded: 0, totalArchived: 0, totalRolesRevoked: 0 }
	}

	const result = await withAdvisoryLock("entra-team-member-sync", async () => {
		let teamsSynced = 0
		let teamsGroupDeleted = 0
		let totalAdded = 0
		let totalArchived = 0
		let totalRolesRevoked = 0

		for (const { team, members } of fetched) {
			try {
				if (members === null) {
					const { archived, skipped } = await clearDevTeamEntraMembers(
						team.devTeamId,
						team.entraGroupId,
						"system:entra-team-sync",
						options.jobId,
					)
					if (skipped) {
						logger.info(`[entra-team-sync] Team "${team.teamName}" ble av-/omkoblet mens synken pågikk — hopper over`)
						continue
					}
					teamsGroupDeleted++
					totalArchived += archived
					logger.warn(
						`[entra-team-sync] Entra-gruppe ${team.entraGroupId} for team "${team.teamName}" finnes ikke lenger — tømmer cache`,
					)
					continue
				}

				const diff = await syncDevTeamEntraMembers(
					team.devTeamId,
					team.entraGroupId,
					members,
					"system:entra-team-sync",
					options.jobId,
				)
				if (diff.skipped) {
					logger.info(`[entra-team-sync] Team "${team.teamName}" ble av-/omkoblet mens synken pågikk — hopper over`)
					continue
				}
				teamsSynced++
				totalAdded += diff.added
				totalArchived += diff.archived
				totalRolesRevoked += diff.rolesRevoked

				if (diff.added > 0 || diff.archived > 0) {
					logger.info(
						`[entra-team-sync] Team "${team.teamName}": +${diff.added} added, -${diff.archived} archived, ${diff.updated} updated`,
					)
				}
				if (diff.rolesRevoked > 0) {
					logger.info(
						`[entra-team-sync] Team "${team.teamName}": ${diff.rolesRevoked} elevated-rolle(r) tilbakekalt (medlemskap i Entra-gruppen opphørt)`,
					)
				}
			} catch (err) {
				logger.error(
					`[entra-team-sync] Kunne ikke synke team "${team.teamName}" (${team.devTeamId})`,
					err instanceof Error ? err : new Error(String(err)),
				)
			}
		}

		return { teamsSynced, teamsGroupDeleted, totalAdded, totalArchived, totalRolesRevoked }
	})

	if (result === null) {
		logger.info("[entra-team-sync] Hoppet over — annen pod holder låsen")
		return null
	}

	return result
}

/**
 * Synker ett enkelt team umiddelbart — brukes rett etter at et team kobles til
 * en Entra ID-gruppe, slik at admin ikke må vente på neste planlagte kjøring
 * (opptil 30 min) for å se medlemmene. Feil her er ikke blokkerende for selve
 * koblingen; periodisk synk tar seg av det ved neste kjøring uansett.
 */
export async function syncSingleDevTeamEntraGroup(
	devTeamId: string,
	entraGroupId: string,
	performedBy: string,
): Promise<void> {
	try {
		const members = await fetchTeamEntraMembers(entraGroupId)
		const result = await withAdvisoryLock("entra-team-member-sync", async () => {
			if (members === null) {
				await clearDevTeamEntraMembers(devTeamId, entraGroupId, performedBy)
				return
			}
			await syncDevTeamEntraMembers(devTeamId, entraGroupId, members, performedBy)
		})

		if (result === null) {
			logger.info(`[entra-team-sync] Hoppet over umiddelbar synk for team ${devTeamId} — annen pod holder låsen`)
		}
	} catch (error) {
		logger.error(
			`[entra-team-sync] Umiddelbar synk feilet for team ${devTeamId} (gruppe ${entraGroupId})`,
			error instanceof Error ? error : new Error(String(error)),
		)
	}
}
