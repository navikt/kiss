import { and, asc, eq, isNull } from "drizzle-orm"
import { db } from "../connection.server"
import {
	devTeams,
	type LandingPage,
	sections,
	type UserRole,
	userPreferences,
	userRoles,
	users,
} from "../schema/organization"
import { writeAuditLog } from "./audit.server"

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

export interface UserRoleEntry {
	id: string
	role: UserRole
	sectionId: string | null
	sectionName: string | null
	sectionSlug: string | null
	devTeamId: string | null
	devTeamName: string | null
	devTeamSlug: string | null
	devTeamSectionId: string | null
	createdAt: Date
	createdBy: string
}

export interface UserWithRoles {
	id: string
	navIdent: string
	name: string
	email: string | null
	lastLoginAt: Date | null
	roles: UserRoleEntry[]
}

/** Create or update a user record. Returns the user id. */
export async function upsertUser(navIdent: string, name: string, email?: string, tx?: DbExecutor): Promise<string> {
	const executor = tx ?? db
	const now = new Date()
	const [row] = await executor
		.insert(users)
		.values({ navIdent, name, email: email ?? null, lastLoginAt: now })
		.onConflictDoUpdate({
			target: users.navIdent,
			set: { name, email: email ?? null, lastLoginAt: now, updatedAt: now },
		})
		.returning({ id: users.id })
	return row.id
}

/** Get all DB roles for a given navIdent. */
export async function getUserRoles(navIdent: string): Promise<UserRoleEntry[]> {
	const rows = await db
		.select({
			id: userRoles.id,
			role: userRoles.role,
			sectionId: userRoles.sectionId,
			sectionName: sections.name,
			sectionSlug: sections.slug,
			devTeamId: userRoles.devTeamId,
			devTeamName: devTeams.name,
			devTeamSlug: devTeams.slug,
			devTeamSectionId: devTeams.sectionId,
			createdAt: userRoles.createdAt,
			createdBy: userRoles.createdBy,
		})
		.from(userRoles)
		.innerJoin(users, eq(userRoles.userId, users.id))
		.leftJoin(sections, eq(userRoles.sectionId, sections.id))
		.leftJoin(devTeams, eq(userRoles.devTeamId, devTeams.id))
		.where(and(eq(users.navIdent, navIdent), isNull(userRoles.archivedAt)))

	return rows.map((r) => ({
		...r,
		role: r.role as UserRole,
	}))
}

/**
 * Assign a role to a user. Hele operasjonen — inkludert upsertUser, guard og
 * INSERT i user_roles — kjører i én transaksjon. Avviser rollebinding mot
 * arkiverte/ikke-eksisterende seksjoner, og verifiserer også at devTeamId (om
 * satt) tilhører en aktiv seksjon. Seksjonsraden(e) låses med `SELECT ... FOR
 * SHARE` slik at en samtidig `archiveSection` ikke kan committe mellom guard
 * og INSERT.
 */
export async function assignRole(
	navIdent: string,
	name: string,
	role: UserRole,
	createdBy: string,
	sectionId?: string,
	devTeamId?: string,
): Promise<string> {
	return db.transaction(async (tx) => {
		const userId = await upsertUser(navIdent, name, undefined, tx)
		if (sectionId) {
			const [section] = await tx
				.select({ archivedAt: sections.archivedAt })
				.from(sections)
				.where(eq(sections.id, sectionId))
				.limit(1)
				.for("share")
			if (!section) throw new Error(`Seksjon med id ${sectionId} finnes ikke`)
			if (section.archivedAt) throw new Error(`Seksjon med id ${sectionId} er arkivert`)
		}
		if (devTeamId) {
			const [teamSection] = await tx
				.select({
					teamId: devTeams.id,
					teamArchivedAt: devTeams.archivedAt,
					sectionArchivedAt: sections.archivedAt,
				})
				.from(devTeams)
				.innerJoin(sections, eq(devTeams.sectionId, sections.id))
				.where(eq(devTeams.id, devTeamId))
				.limit(1)
				.for("share", { of: [devTeams, sections] })
			if (!teamSection) throw new Error(`Dev-team med id ${devTeamId} finnes ikke`)
			if (teamSection.teamArchivedAt) throw new Error(`Dev-team med id ${devTeamId} er arkivert`)
			if (teamSection.sectionArchivedAt) {
				throw new Error(`Dev-team med id ${devTeamId} tilhører en arkivert seksjon`)
			}
		}
		const [row] = await tx
			.insert(userRoles)
			.values({
				userId,
				role,
				sectionId: sectionId ?? null,
				devTeamId: devTeamId ?? null,
				createdBy,
			})
			.returning({ id: userRoles.id })

		await writeAuditLog(
			{
				action: "user_role_granted",
				entityType: "user_role",
				entityId: row.id,
				newValue: JSON.stringify({
					navIdent,
					role,
					sectionId: sectionId ?? null,
					devTeamId: devTeamId ?? null,
				}),
				performedBy: createdBy,
			},
			tx,
		)

		return row.id
	})
}

/**
 * Arkiverer (soft-delete) en rolletildeling. Tidligere ble raden hard-slettet.
 * Nå arkiverer vi den slik at vi bevarer sporbarhet på hvilke roller en bruker
 * har hatt. Wrappet i transaksjon med audit som del av samme tx — hvis
 * audit-skriving feiler rulles arkiveringen tilbake. Idempotent: hvis raden
 * allerede er arkivert (eller ikke finnes) returneres `null` uten audit.
 */
export async function removeRole(roleId: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [archived] = await tx
			.update(userRoles)
			.set({ archivedAt: new Date(), archivedBy: performedBy })
			.where(and(eq(userRoles.id, roleId), isNull(userRoles.archivedAt)))
			.returning()

		if (!archived) return null

		const [user] = await tx
			.select({ navIdent: users.navIdent })
			.from(users)
			.where(eq(users.id, archived.userId))
			.limit(1)

		await writeAuditLog(
			{
				action: "user_role_revoked",
				entityType: "user_role",
				entityId: roleId,
				previousValue: JSON.stringify({
					navIdent: user?.navIdent ?? archived.userId,
					role: archived.role,
					sectionId: archived.sectionId,
					devTeamId: archived.devTeamId,
				}),
				performedBy,
			},
			tx,
		)

		return archived
	})
}

/** List all users with their roles. */
export async function listUsersWithRoles(): Promise<UserWithRoles[]> {
	const allUsers = await db
		.select({
			id: users.id,
			navIdent: users.navIdent,
			name: users.name,
			email: users.email,
			lastLoginAt: users.lastLoginAt,
		})
		.from(users)
		.orderBy(users.name)

	const allRoles = await db
		.select({
			id: userRoles.id,
			userId: userRoles.userId,
			role: userRoles.role,
			sectionId: userRoles.sectionId,
			sectionName: sections.name,
			sectionSlug: sections.slug,
			devTeamId: userRoles.devTeamId,
			devTeamName: devTeams.name,
			devTeamSlug: devTeams.slug,
			devTeamSectionId: devTeams.sectionId,
			createdAt: userRoles.createdAt,
			createdBy: userRoles.createdBy,
		})
		.from(userRoles)
		.leftJoin(sections, eq(userRoles.sectionId, sections.id))
		.leftJoin(devTeams, eq(userRoles.devTeamId, devTeams.id))
		.where(isNull(userRoles.archivedAt))

	const rolesByUser = new Map<string, UserRoleEntry[]>()
	for (const r of allRoles) {
		const list = rolesByUser.get(r.userId) ?? []
		list.push({
			id: r.id,
			role: r.role as UserRole,
			sectionId: r.sectionId,
			sectionName: r.sectionName,
			sectionSlug: r.sectionSlug,
			devTeamId: r.devTeamId,
			devTeamName: r.devTeamName,
			devTeamSlug: r.devTeamSlug,
			devTeamSectionId: r.devTeamSectionId,
			createdAt: r.createdAt,
			createdBy: r.createdBy,
		})
		rolesByUser.set(r.userId, list)
	}

	return allUsers.map((u) => ({
		...u,
		roles: rolesByUser.get(u.id) ?? [],
	}))
}

/** Get all users with an active role in the given dev team, grouped by user. */
export async function getUsersForTeam(
	teamId: string,
): Promise<Array<{ navIdent: string; name: string; roles: UserRole[] }>> {
	const rows = await db
		.select({
			navIdent: users.navIdent,
			name: users.name,
			role: userRoles.role,
		})
		.from(userRoles)
		.innerJoin(users, eq(userRoles.userId, users.id))
		.where(and(eq(userRoles.devTeamId, teamId), isNull(userRoles.archivedAt)))
		.orderBy(asc(users.name), asc(users.navIdent), asc(userRoles.role))

	const byUser = new Map<string, { navIdent: string; name: string; roles: UserRole[] }>()
	for (const r of rows) {
		const entry = byUser.get(r.navIdent) ?? { navIdent: r.navIdent, name: r.name, roles: [] }
		entry.roles.push(r.role as UserRole)
		byUser.set(r.navIdent, entry)
	}
	return Array.from(byUser.values())
}

// ─── User preferences ────────────────────────────────────────────────────

export async function getUserLandingPage(navIdent: string): Promise<LandingPage> {
	const [row] = await db
		.select({ landingPage: userPreferences.landingPage })
		.from(userPreferences)
		.where(eq(userPreferences.navIdent, navIdent))
		.limit(1)
	return (row?.landingPage as LandingPage) ?? "dashboard"
}

export async function setUserLandingPage(navIdent: string, landingPage: LandingPage): Promise<void> {
	await db
		.insert(userPreferences)
		.values({ navIdent, landingPage, updatedAt: new Date() })
		.onConflictDoUpdate({
			target: userPreferences.navIdent,
			set: { landingPage, updatedAt: new Date() },
		})
}

/** List all dev teams (lightweight, for profile page). Arkiverte teams skjules som standard. */
export async function getAllDevTeams(options: { includeArchived?: boolean } = {}) {
	const where = options.includeArchived ? undefined : isNull(devTeams.archivedAt)
	return db
		.select({ id: devTeams.id, name: devTeams.name, sectionId: devTeams.sectionId })
		.from(devTeams)
		.where(where)
		.orderBy(devTeams.name)
}
