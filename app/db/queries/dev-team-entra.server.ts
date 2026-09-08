import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm"
import { db } from "../connection.server"
import { isUniqueViolation } from "../pg-errors.server"
import { devTeamEntraMembers, devTeams, ELEVATED_TEAM_ROLES, userRoles, users } from "../schema/organization"
import { writeAuditLog } from "./audit.server"

/** Transaksjons-håndtak — bevisst IKKE unionert med `typeof db` her: denne funksjonen skal alltid
 * kjøres inni en eksisterende transaksjon (se dokumentasjon under), og en snevrere type gjør det
 * umulig å ved en feil kalle den utenfor en `db.transaction()` og dermed miste atomisitet mellom
 * rollearkivering og audit-logg. */
type TxExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Tilbakekaller aktive elevated-roller (Tech Lead/Produktleder) for navIdent-er som ikke lenger
 * er aktive medlemmer av teamets koblede Entra ID-gruppe. Manuell tildeling av disse rollene for
 * Entra-koblede team krever aktivt gruppemedlemskap ved tildelingstidspunktet (jf. #707), men uten
 * denne oppryddingen ville rollen «henge igjen» i KISS på ubestemt tid etter at noen forlater
 * gruppen. Må kalles i samme transaksjon som arkiveringen av devTeamEntraMembers-radene.
 */
async function revokeElevatedRolesForDepartedMembers(
	tx: TxExecutor,
	devTeamId: string,
	departedNavIdents: string[],
	performedBy: string,
	syncJobId?: string,
): Promise<number> {
	if (departedNavIdents.length === 0) return 0

	const rows = await tx
		.select({ roleId: userRoles.id, role: userRoles.role, navIdent: users.navIdent })
		.from(userRoles)
		.innerJoin(users, eq(userRoles.userId, users.id))
		.where(
			and(
				eq(userRoles.devTeamId, devTeamId),
				isNull(userRoles.archivedAt),
				inArray(userRoles.role, ELEVATED_TEAM_ROLES),
				inArray(users.navIdent, departedNavIdents),
			),
		)
	if (rows.length === 0) return 0

	const now = new Date()
	let revokedCount = 0
	for (const row of rows) {
		const [archived] = await tx
			.update(userRoles)
			.set({ archivedAt: now, archivedBy: performedBy })
			.where(and(eq(userRoles.id, row.roleId), isNull(userRoles.archivedAt)))
			.returning({ id: userRoles.id })

		// Raden kan ha blitt arkivert av en samtidig operasjon (f.eks. en admin som fjerner rollen
		// manuelt) mellom SELECT-en over og denne UPDATE-en — hopp over audit-logging i så fall for
		// å unngå en misvisende duplikat-oppføring for en mutasjon som ikke faktisk skjedde her.
		if (!archived) continue
		revokedCount++

		await writeAuditLog(
			{
				action: "user_role_revoked",
				entityType: "user_role",
				entityId: row.roleId,
				previousValue: JSON.stringify({ navIdent: row.navIdent, role: row.role, devTeamId }),
				newValue: null,
				metadata: { reason: "entra_membership_lapsed" },
				performedBy,
				syncJobId,
			},
			tx,
		)
	}

	return revokedCount
}

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

			// Relink til en annen gruppe gjør cachet medlemskap fra forrige gruppe
			// ugyldig umiddelbart — vent ikke på neste planlagte sync.
			if (before.entraGroupId && before.entraGroupId !== entraGroupId) {
				const now = new Date()
				const archivedRows = await tx
					.update(devTeamEntraMembers)
					.set({ archivedAt: now, archivedBy: performedBy, updatedBy: performedBy, updatedAt: now })
					.where(and(eq(devTeamEntraMembers.devTeamId, devTeamId), isNull(devTeamEntraMembers.archivedAt)))
					.returning({ id: devTeamEntraMembers.id, navIdent: devTeamEntraMembers.navIdent })
				if (archivedRows.length > 0) {
					await writeAuditLog(
						{
							action: "entra_team_members_synced",
							entityType: "team",
							entityId: devTeamId,
							newValue: JSON.stringify({
								added: 0,
								updated: 0,
								archived: archivedRows.length,
								reason: "group_relinked",
							}),
							performedBy,
						},
						tx,
					)
					await revokeElevatedRolesForDepartedMembers(
						tx,
						devTeamId,
						archivedRows.map((r) => r.navIdent),
						performedBy,
					)
				}
			}

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
		const archivedRows = await tx
			.update(devTeamEntraMembers)
			.set({ archivedAt: now, archivedBy: performedBy, updatedBy: performedBy, updatedAt: now })
			.where(and(eq(devTeamEntraMembers.devTeamId, devTeamId), isNull(devTeamEntraMembers.archivedAt)))
			.returning({ id: devTeamEntraMembers.id })

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

		if (archivedRows.length > 0) {
			await writeAuditLog(
				{
					action: "entra_team_members_synced",
					entityType: "team",
					entityId: devTeamId,
					newValue: JSON.stringify({ added: 0, updated: 0, archived: archivedRows.length, reason: "group_unlinked" }),
					performedBy,
				},
				tx,
			)
		}
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
	/** Antall elevated-roller (Tech Lead/Produktleder) automatisk tilbakekalt fordi innehaveren ikke lenger er aktivt gruppemedlem. */
	rolesRevoked: number
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
			return { added: 0, updated: 0, archived: 0, rolesRevoked: 0, skipped: true }
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

		const rolesRevoked = await revokeElevatedRolesForDepartedMembers(
			tx,
			devTeamId,
			toArchive.map((m) => m.navIdent),
			performedBy,
			syncJobId,
		)

		if (added > 0 || archived > 0 || updated > 0) {
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

		return { added, updated, archived, rolesRevoked, skipped: false }
	})
}

/**
 * Arkiverer all cachet medlemskap for et team umiddelbart — brukes når Entra-gruppen er slettet.
 *
 * Tilbakekaller BEVISST ikke elevated-roller her (i motsetning til syncDevTeamEntraMembers og
 * linkEntraGroupToTeam): at hele gruppen forsvinner fra Graph er en tvetydig hendelse — kan skyldes
 * at noen ved en feil slettet gruppen i Entra (opplevd i praksis), ikke nødvendigvis at teammedlemmene
 * faktisk skal miste tilgangen sin. Rollene blir stående urørt til gruppen evt. gjenopprettes og
 * re-kobles (linkEntraGroupToTeam), eller til en admin bevisst fjerner dem manuelt.
 */
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
					newValue: JSON.stringify({ added: 0, updated: 0, archived: archivedRows.length, reason: "group_deleted" }),
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

/** Alle team-ID-er en navIdent er aktivt automatisk medlem av — brukt til å bygge effektiv autorisasjon per request.
 * Ekskluderer arkiverte team, siden archiveTeam() ikke arkiverer dev_team_entra_members. */
export async function getActiveDevTeamIdsForNavIdent(navIdent: string): Promise<string[]> {
	const rows = await db
		.select({ devTeamId: devTeamEntraMembers.devTeamId })
		.from(devTeamEntraMembers)
		.innerJoin(devTeams, eq(devTeams.id, devTeamEntraMembers.devTeamId))
		.where(
			and(
				eq(devTeamEntraMembers.navIdent, navIdent),
				isNull(devTeamEntraMembers.archivedAt),
				isNull(devTeams.archivedAt),
			),
		)
	return rows.map((r) => r.devTeamId)
}
