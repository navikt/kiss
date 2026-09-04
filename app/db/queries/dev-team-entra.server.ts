import { and, eq, isNotNull, isNull } from "drizzle-orm"
import { db } from "../connection.server"
import { isUniqueViolation } from "../pg-errors.server"
import { devTeamEntraMembers, devTeams } from "../schema/organization"
import { writeAuditLog } from "./audit.server"

export interface DevTeamEntraSyncTarget {
	devTeamId: string
	entraGroupId: string
	teamName: string
}

/** Alle aktive team koblet til en Entra ID-gruppe — inngang for periodisk synk. */
export async function getDevTeamsWithEntraGroup(): Promise<DevTeamEntraSyncTarget[]> {
	const rows = await db
		.select({ devTeamId: devTeams.id, entraGroupId: devTeams.entraGroupId, teamName: devTeams.name })
		.from(devTeams)
		.where(and(isNull(devTeams.archivedAt), isNotNull(devTeams.entraGroupId)))
	return rows.map((r) => ({ devTeamId: r.devTeamId, entraGroupId: r.entraGroupId as string, teamName: r.teamName }))
}

/**
 * Kobler et team til en Entra ID-gruppe. Én gruppe kan kun være koblet til ett
 * aktivt team (håndhevet av partiell unik indeks) — race håndteres eksplisitt
 * siden UI-et ikke kan garantere det på forhånd.
 */
export async function linkEntraGroupToTeam(
	devTeamId: string,
	entraGroupId: string,
	entraGroupName: string | null,
	performedBy: string,
) {
	return db.transaction(async (tx) => {
		try {
			const [before] = await tx
				.select({ entraGroupId: devTeams.entraGroupId, entraGroupName: devTeams.entraGroupName })
				.from(devTeams)
				.where(and(eq(devTeams.id, devTeamId), isNull(devTeams.archivedAt)))
				.for("update")
			if (!before) throw new Error(`Team ikke funnet eller arkivert: ${devTeamId}`)

			const [team] = await tx
				.update(devTeams)
				.set({ entraGroupId, entraGroupName, updatedBy: performedBy, updatedAt: new Date() })
				.where(and(eq(devTeams.id, devTeamId), isNull(devTeams.archivedAt)))
				.returning()
			if (!team) throw new Error(`Team ikke funnet eller arkivert: ${devTeamId}`)

			await writeAuditLog(
				{
					action: "entra_group_linked_to_team",
					entityType: "team",
					entityId: devTeamId,
					previousValue: JSON.stringify({
						entraGroupId: before.entraGroupId,
						entraGroupName: before.entraGroupName,
					}),
					newValue: JSON.stringify({ entraGroupId, entraGroupName }),
					performedBy,
				},
				tx,
			)
			return team
		} catch (error) {
			if (isUniqueViolation(error)) {
				throw new Error("Denne Entra ID-gruppen er allerede koblet til et annet team")
			}
			throw error
		}
	})
}

/** Fjerner Entra-gruppekoblingen fra et team og arkiverer all cachet automatisk medlemskap. */
export async function unlinkEntraGroupFromTeam(devTeamId: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [before] = await tx
			.select({ entraGroupId: devTeams.entraGroupId, entraGroupName: devTeams.entraGroupName })
			.from(devTeams)
			.where(and(eq(devTeams.id, devTeamId), isNull(devTeams.archivedAt)))
			.for("update")
		if (!before) throw new Error(`Team ikke funnet eller arkivert: ${devTeamId}`)

		const [team] = await tx
			.update(devTeams)
			.set({ entraGroupId: null, entraGroupName: null, updatedBy: performedBy, updatedAt: new Date() })
			.where(and(eq(devTeams.id, devTeamId), isNull(devTeams.archivedAt)))
			.returning()
		if (!team) throw new Error(`Team ikke funnet eller arkivert: ${devTeamId}`)

		const now = new Date()
		await tx
			.update(devTeamEntraMembers)
			.set({ archivedAt: now, archivedBy: performedBy, updatedBy: performedBy, updatedAt: now })
			.where(and(eq(devTeamEntraMembers.devTeamId, devTeamId), isNull(devTeamEntraMembers.archivedAt)))

		await writeAuditLog(
			{
				action: "entra_group_unlinked_from_team",
				entityType: "team",
				entityId: devTeamId,
				previousValue: JSON.stringify({
					entraGroupId: before.entraGroupId,
					entraGroupName: before.entraGroupName,
				}),
				newValue: null,
				performedBy,
			},
			tx,
		)
		return team
	})
}

export interface DevTeamEntraMemberInput {
	navIdent: string
	displayName: string | null
	mail: string | null
}

export interface DevTeamEntraSyncDiff {
	added: number
	updated: number
	archived: number
	/** true når teamet ble av-/omkoblet til en annen Entra-gruppe mellom Graph-henting og DB-skriving — ingen mutasjon ble utført. */
	skipped: boolean
}

/**
 * Synker cachet medlemsliste for et team mot Graph-resultatet: oppdaterer/
 * reaktiverer nåværende medlemmer og arkiverer de som er borte. Aldri hard
 * delete — historikk over hvem som har hatt automatisk tilgang bevares.
 *
 * Låser og re-verifiserer teamets entraGroupId mot `expectedEntraGroupId` inne
 * i samme transaksjon som mutasjonen, for å unngå at et team som re-/avkobles
 * mellom Graph-kallet og denne skrivingen får medlemskap for feil gruppe.
 */
export async function syncDevTeamEntraMembers(
	devTeamId: string,
	expectedEntraGroupId: string,
	members: DevTeamEntraMemberInput[],
	performedBy: string,
	syncJobId?: string,
): Promise<DevTeamEntraSyncDiff> {
	return db.transaction(async (tx) => {
		const [team] = await tx
			.select({ entraGroupId: devTeams.entraGroupId })
			.from(devTeams)
			.where(and(eq(devTeams.id, devTeamId), isNull(devTeams.archivedAt)))
			.for("update")
		if (!team || team.entraGroupId !== expectedEntraGroupId) {
			return { added: 0, updated: 0, archived: 0, skipped: true }
		}

		const now = new Date()
		// Dedupliser på navIdent — flere Entra-medlemmer kan i sjeldne tilfeller
		// mappe til samme navIdent (f.eks. via nøstede grupper), og iterering over
		// råinput ville da forsøke å sette inn samme rad to ganger.
		const uniqueMembers = [...new Map(members.map((m) => [m.navIdent, m])).values()]

		const existingActive = await tx
			.select({ id: devTeamEntraMembers.id, navIdent: devTeamEntraMembers.navIdent })
			.from(devTeamEntraMembers)
			.where(and(eq(devTeamEntraMembers.devTeamId, devTeamId), isNull(devTeamEntraMembers.archivedAt)))
		const existingIdents = new Set(existingActive.map((m) => m.navIdent))
		const newIdents = new Set(uniqueMembers.map((m) => m.navIdent))

		let added = 0
		let updated = 0
		let archived = 0

		for (const member of uniqueMembers) {
			if (existingIdents.has(member.navIdent)) {
				await tx
					.update(devTeamEntraMembers)
					.set({
						displayName: member.displayName,
						mail: member.mail,
						syncedAt: now,
						updatedBy: performedBy,
						updatedAt: now,
					})
					.where(
						and(
							eq(devTeamEntraMembers.devTeamId, devTeamId),
							eq(devTeamEntraMembers.navIdent, member.navIdent),
							isNull(devTeamEntraMembers.archivedAt),
						),
					)
				updated++
				continue
			}

			const [reactivated] = await tx
				.update(devTeamEntraMembers)
				.set({
					displayName: member.displayName,
					mail: member.mail,
					syncedAt: now,
					updatedBy: performedBy,
					updatedAt: now,
					archivedAt: null,
					archivedBy: null,
				})
				.where(
					and(
						eq(devTeamEntraMembers.devTeamId, devTeamId),
						eq(devTeamEntraMembers.navIdent, member.navIdent),
						isNotNull(devTeamEntraMembers.archivedAt),
					),
				)
				.returning({ id: devTeamEntraMembers.id })

			if (reactivated) {
				added++
			} else {
				await tx.insert(devTeamEntraMembers).values({
					devTeamId,
					navIdent: member.navIdent,
					displayName: member.displayName,
					mail: member.mail,
					syncedAt: now,
					createdBy: performedBy,
					updatedBy: performedBy,
				})
				added++
			}
		}

		const toArchive = existingActive.filter((m) => !newIdents.has(m.navIdent))
		for (const member of toArchive) {
			await tx
				.update(devTeamEntraMembers)
				.set({ archivedAt: now, archivedBy: performedBy, updatedBy: performedBy, updatedAt: now })
				.where(eq(devTeamEntraMembers.id, member.id))
			archived++
		}

		if (added > 0 || archived > 0) {
			await writeAuditLog(
				{
					action: "entra_team_members_synced",
					entityType: "team",
					entityId: devTeamId,
					newValue: JSON.stringify({ added, updated, archived }),
					performedBy,
					syncJobId,
				},
				tx,
			)
		}

		return { added, updated, archived, skipped: false }
	})
}

/** Arkiverer all cachet medlemskap for et team umiddelbart — brukes når Entra-gruppen er slettet. */
export async function clearDevTeamEntraMembers(
	devTeamId: string,
	expectedEntraGroupId: string,
	performedBy: string,
	syncJobId?: string,
): Promise<{ archived: number; skipped: boolean }> {
	return db.transaction(async (tx) => {
		const [team] = await tx
			.select({ entraGroupId: devTeams.entraGroupId })
			.from(devTeams)
			.where(and(eq(devTeams.id, devTeamId), isNull(devTeams.archivedAt)))
			.for("update")
		if (!team || team.entraGroupId !== expectedEntraGroupId) {
			return { archived: 0, skipped: true }
		}

		const now = new Date()
		const archivedRows = await tx
			.update(devTeamEntraMembers)
			.set({ archivedAt: now, archivedBy: performedBy, updatedBy: performedBy, updatedAt: now })
			.where(and(eq(devTeamEntraMembers.devTeamId, devTeamId), isNull(devTeamEntraMembers.archivedAt)))
			.returning({ id: devTeamEntraMembers.id })

		if (archivedRows.length > 0) {
			await writeAuditLog(
				{
					action: "entra_team_members_synced",
					entityType: "team",
					entityId: devTeamId,
					metadata: { reason: "group_deleted", archived: archivedRows.length },
					performedBy,
					syncJobId,
				},
				tx,
			)
		}

		return { archived: archivedRows.length, skipped: false }
	})
}

/** Aktive automatiske medlemmer for et team — brukes av UI og autorisasjonsoppslag. */
export async function getActiveDevTeamEntraMembers(devTeamId: string) {
	return db
		.select({
			navIdent: devTeamEntraMembers.navIdent,
			displayName: devTeamEntraMembers.displayName,
			mail: devTeamEntraMembers.mail,
			syncedAt: devTeamEntraMembers.syncedAt,
		})
		.from(devTeamEntraMembers)
		.where(and(eq(devTeamEntraMembers.devTeamId, devTeamId), isNull(devTeamEntraMembers.archivedAt)))
		.orderBy(devTeamEntraMembers.displayName)
}

/** Sjekk om en navIdent er et aktivt automatisk medlem av et gitt team. */
export async function isActiveDevTeamEntraMember(devTeamId: string, navIdent: string): Promise<boolean> {
	const [row] = await db
		.select({ id: devTeamEntraMembers.id })
		.from(devTeamEntraMembers)
		.where(
			and(
				eq(devTeamEntraMembers.devTeamId, devTeamId),
				eq(devTeamEntraMembers.navIdent, navIdent),
				isNull(devTeamEntraMembers.archivedAt),
			),
		)
		.limit(1)
	return !!row
}
