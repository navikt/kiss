import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import type { RoutineFrequency } from "../../lib/routine-frequencies"
import { frequencyDays } from "../../lib/routine-frequencies"
import { db } from "../connection.server"
import { frameworkControls } from "../schema/framework"
import { sections, type UserRole, userRoles, users } from "../schema/organization"
import { routines } from "../schema/routines"
import {
	type RulesetStatus,
	rulesetApprovals,
	rulesetAttachments,
	rulesetControls,
	rulesetRoutines,
	rulesets,
} from "../schema/rulesets"
import { writeAuditLog } from "./audit.server"

// ─── Types ────────────────────────────────────────────────────────────────

export type ApprovalStatus = "draft" | "valid" | "expiring_soon" | "expired"

export interface RulesetListItem {
	id: string
	name: string
	description: string | null
	responsibleIdent: string | null
	responsibleName: string | null
	responsibleRole: string | null
	frequency: string
	status: RulesetStatus
	approvalStatus: ApprovalStatus
	lastApproval: { validFrom: Date; validUntil: Date } | null
}

export interface RulesetDetail extends RulesetListItem {
	sectionId: string
	sectionName: string
	resolvedResponsible: { navIdent: string; name: string } | null
	approvals: {
		id: string
		approvedBy: string
		approvedByName: string
		comment: string | null
		validFrom: Date
		validUntil: Date
		createdAt: Date
	}[]
	controls: {
		id: string
		linkId: string
		controlId: string
		shortTitle: string | null
	}[]
	linkedRoutines: {
		linkId: string
		routineId: string
		routineName: string
		createdBy: string
		createdAt: Date
	}[]
	attachments: {
		id: string
		fileName: string
		bucketPath: string
		contentType: string
		sizeBytes: number | null
		uploadedBy: string
		uploadedAt: Date
	}[]
	createdAt: Date
	createdBy: string
	updatedAt: Date
	updatedBy: string
}

// ─── Approval status calculation ──────────────────────────────────────────

const EXPIRING_SOON_DAYS = 30

function computeApprovalStatus(
	rulesetStatus: RulesetStatus,
	lastApproval: { validUntil: Date } | null,
): ApprovalStatus {
	if (rulesetStatus === "draft") return "draft"
	if (rulesetStatus === "archived") return "expired"
	if (!lastApproval) return "draft"

	const now = new Date()
	const until = new Date(lastApproval.validUntil)
	if (until < now) return "expired"

	const daysLeft = (until.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
	if (daysLeft <= EXPIRING_SOON_DAYS) return "expiring_soon"
	return "valid"
}

// ─── Role resolution ──────────────────────────────────────────────────────

/** Find the user holding a specific role in a section. Returns first match or null. */
export async function resolveRoleHolder(
	role: string,
	sectionId: string,
): Promise<{ navIdent: string; name: string } | null> {
	const [row] = await db
		.select({ navIdent: users.navIdent, name: users.name })
		.from(userRoles)
		.innerJoin(users, eq(userRoles.userId, users.id))
		.where(and(eq(userRoles.role, role as UserRole), eq(userRoles.sectionId, sectionId), isNull(userRoles.archivedAt)))
		.limit(1)
	return row ?? null
}

// ─── Queries ──────────────────────────────────────────────────────────────

export async function getRulesetsForSection(sectionId: string): Promise<RulesetListItem[]> {
	const rows = await db
		.select()
		.from(rulesets)
		.where(and(eq(rulesets.sectionId, sectionId), isNull(rulesets.archivedAt)))
		.orderBy(rulesets.name)

	if (rows.length === 0) return []

	const rulesetIds = rows.map((r) => r.id)
	const allApprovals = await db
		.select()
		.from(rulesetApprovals)
		.where(inArray(rulesetApprovals.rulesetId, rulesetIds))
		.orderBy(desc(rulesetApprovals.validFrom))

	const latestByRuleset = new Map<string, (typeof allApprovals)[0]>()
	for (const a of allApprovals) {
		if (!latestByRuleset.has(a.rulesetId)) {
			latestByRuleset.set(a.rulesetId, a)
		}
	}

	return rows.map((r) => {
		const latest = latestByRuleset.get(r.id)
		return {
			id: r.id,
			name: r.name,
			description: r.description,
			responsibleIdent: r.responsibleIdent,
			responsibleName: r.responsibleName,
			responsibleRole: r.responsibleRole,
			frequency: r.frequency,
			status: r.status as RulesetStatus,
			approvalStatus: computeApprovalStatus(
				r.status as RulesetStatus,
				latest ? { validUntil: latest.validUntil } : null,
			),
			lastApproval: latest ? { validFrom: latest.validFrom, validUntil: latest.validUntil } : null,
		}
	})
}

export interface RulesetMeta {
	id: string
	sectionId: string
	archivedAt: Date | null
}

/**
 * Lett SELECT for action-guards: kun id, seksjon og arkiv-status.
 * Bruk denne i stedet for `getRulesetDetail` når du kun trenger å verifisere
 * at regelsettet eksisterer, tilhører riktig seksjon og ikke er arkivert.
 */
export async function getRulesetMeta(rulesetId: string): Promise<RulesetMeta | null> {
	const [row] = await db
		.select({ id: rulesets.id, sectionId: rulesets.sectionId, archivedAt: rulesets.archivedAt })
		.from(rulesets)
		.where(eq(rulesets.id, rulesetId))
		.limit(1)
	return row ?? null
}

/**
 * Henter regelsett-detaljer inkludert tilknyttede kontroller, rutiner og
 * gjeldende godkjenningsstatus. Returnerer null hvis ikke funnet.
 */
export async function getRulesetDetail(rulesetId: string): Promise<RulesetDetail | null> {
	const [row] = await db
		.select({
			id: rulesets.id,
			sectionId: rulesets.sectionId,
			sectionName: sections.name,
			name: rulesets.name,
			description: rulesets.description,
			responsibleIdent: rulesets.responsibleIdent,
			responsibleName: rulesets.responsibleName,
			responsibleRole: rulesets.responsibleRole,
			frequency: rulesets.frequency,
			status: rulesets.status,
			createdAt: rulesets.createdAt,
			createdBy: rulesets.createdBy,
			updatedAt: rulesets.updatedAt,
			updatedBy: rulesets.updatedBy,
		})
		.from(rulesets)
		.innerJoin(sections, eq(rulesets.sectionId, sections.id))
		.where(eq(rulesets.id, rulesetId))

	if (!row) return null

	const [approvals, controls, attachments, linkedRoutineRows] = await Promise.all([
		db
			.select()
			.from(rulesetApprovals)
			.where(eq(rulesetApprovals.rulesetId, rulesetId))
			.orderBy(desc(rulesetApprovals.validFrom)),
		db
			.select({
				linkId: rulesetControls.id,
				id: frameworkControls.id,
				controlId: frameworkControls.controlId,
				shortTitle: frameworkControls.shortTitle,
			})
			.from(rulesetControls)
			.innerJoin(frameworkControls, eq(rulesetControls.controlId, frameworkControls.id))
			.where(and(eq(rulesetControls.rulesetId, rulesetId), isNull(rulesetControls.archivedAt)))
			.orderBy(frameworkControls.controlId),
		db
			.select()
			.from(rulesetAttachments)
			.where(eq(rulesetAttachments.rulesetId, rulesetId))
			.orderBy(rulesetAttachments.uploadedAt),
		db
			.select({
				linkId: rulesetRoutines.id,
				routineId: routines.id,
				routineName: routines.name,
				createdBy: rulesetRoutines.createdBy,
				createdAt: rulesetRoutines.createdAt,
			})
			.from(rulesetRoutines)
			.innerJoin(routines, eq(rulesetRoutines.routineId, routines.id))
			.where(and(eq(rulesetRoutines.rulesetId, rulesetId), isNull(rulesetRoutines.archivedAt)))
			.orderBy(routines.name),
	])

	const latestApproval = approvals[0] ?? null

	// Resolve role-based responsible to current holder
	const resolvedResponsible = row.responsibleRole ? await resolveRoleHolder(row.responsibleRole, row.sectionId) : null

	return {
		id: row.id,
		sectionId: row.sectionId,
		sectionName: row.sectionName,
		name: row.name,
		description: row.description,
		responsibleIdent: row.responsibleIdent,
		responsibleName: row.responsibleName,
		responsibleRole: row.responsibleRole,
		frequency: row.frequency,
		status: row.status as RulesetStatus,
		resolvedResponsible,
		approvalStatus: computeApprovalStatus(
			row.status as RulesetStatus,
			latestApproval ? { validUntil: latestApproval.validUntil } : null,
		),
		lastApproval: latestApproval
			? { validFrom: latestApproval.validFrom, validUntil: latestApproval.validUntil }
			: null,
		approvals: approvals.map((a) => ({
			id: a.id,
			approvedBy: a.approvedBy,
			approvedByName: a.approvedByName,
			comment: a.comment,
			validFrom: a.validFrom,
			validUntil: a.validUntil,
			createdAt: a.createdAt,
		})),
		controls: controls.map((c) => ({
			id: c.id,
			linkId: c.linkId,
			controlId: c.controlId,
			shortTitle: c.shortTitle,
		})),
		linkedRoutines: linkedRoutineRows.map((r) => ({
			linkId: r.linkId,
			routineId: r.routineId,
			routineName: r.routineName,
			createdBy: r.createdBy,
			createdAt: r.createdAt,
		})),
		attachments: attachments.map((a) => ({
			id: a.id,
			fileName: a.fileName,
			bucketPath: a.bucketPath,
			contentType: a.contentType,
			sizeBytes: a.sizeBytes,
			uploadedBy: a.uploadedBy,
			uploadedAt: a.uploadedAt,
		})),
		createdAt: row.createdAt,
		createdBy: row.createdBy,
		updatedAt: row.updatedAt,
		updatedBy: row.updatedBy,
	}
}

// ─── Mutations ────────────────────────────────────────────────────────────

/** Oppretter et nytt regelsett (status `draft`). Returnerer ny ruleset-ID. */
export async function createRuleset(input: {
	sectionId: string
	name: string
	description?: string
	responsibleIdent?: string
	responsibleName?: string
	responsibleRole?: string
	frequency: RoutineFrequency
	createdBy: string
}): Promise<string> {
	const [row] = await db
		.insert(rulesets)
		.values({
			sectionId: input.sectionId,
			name: input.name,
			description: input.description ?? null,
			responsibleIdent: input.responsibleIdent ?? null,
			responsibleName: input.responsibleName ?? null,
			responsibleRole: input.responsibleRole ?? null,
			frequency: input.frequency,
			createdBy: input.createdBy,
			updatedBy: input.createdBy,
		})
		.returning({ id: rulesets.id })
	return row.id
}

/**
 * Oppdaterer et regelsett. Guarded i DB-laget mot arkiverte rad — UPDATE
 * skjer kun hvis `archived_at IS NULL`, slik at TOCTOU mellom action og
 * mutasjon ikke kan utnyttes. Returnerer `true` ved suksess, `false` hvis
 * regelsettet ikke finnes eller er arkivert.
 */
export async function updateRuleset(
	rulesetId: string,
	input: {
		name?: string
		description?: string | null
		responsibleIdent?: string | null
		responsibleName?: string | null
		responsibleRole?: string | null
		frequency?: RoutineFrequency
		updatedBy: string
	},
): Promise<boolean> {
	const set: Record<string, unknown> = { updatedAt: new Date(), updatedBy: input.updatedBy }
	if (input.name !== undefined) set.name = input.name
	if (input.description !== undefined) set.description = input.description
	if (input.responsibleIdent !== undefined) set.responsibleIdent = input.responsibleIdent
	if (input.responsibleName !== undefined) set.responsibleName = input.responsibleName
	if (input.responsibleRole !== undefined) set.responsibleRole = input.responsibleRole
	if (input.frequency !== undefined) set.frequency = input.frequency

	const updated = await db
		.update(rulesets)
		.set(set)
		.where(and(eq(rulesets.id, rulesetId), isNull(rulesets.archivedAt)))
		.returning({ id: rulesets.id })
	return updated.length > 0
}

/**
 * Arkiver et regelsett (logisk sletting). Setter `archived_at`/`archived_by`
 * og `status='archived'`. Atomisk guarded UPDATE i transaksjon — idempotent:
 * re-arkivering returnerer det allerede arkiverte regelsettet uten audit-skriving.
 * Returnerer `null` hvis regelsettet ikke finnes.
 */
export async function archiveRuleset(rulesetId: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const now = new Date()
		const [archived] = await tx
			.update(rulesets)
			.set({
				status: "archived",
				archivedAt: now,
				archivedBy: performedBy,
				updatedAt: now,
				updatedBy: performedBy,
			})
			.where(and(eq(rulesets.id, rulesetId), isNull(rulesets.archivedAt)))
			.returning()

		if (!archived) {
			const [existing] = await tx.select().from(rulesets).where(eq(rulesets.id, rulesetId)).limit(1)
			if (!existing) return null
			return existing
		}

		await writeAuditLog(
			{
				action: "ruleset_archived",
				entityType: "ruleset",
				entityId: rulesetId,
				previousValue: JSON.stringify({ name: archived.name }),
				performedBy,
			},
			tx,
		)
		return archived
	})
}

/**
 * Reaktiver et arkivert regelsett. Status settes til `active` hvis det finnes
 * minst én godkjenning, ellers `draft`. Idempotent: re-aktivering av et aktivt
 * regelsett returnerer det uten audit-skriving.
 */
export async function unarchiveRuleset(rulesetId: string, performedBy: string) {
	return db.transaction(async (tx) => {
		// Status utledes atomisk i UPDATE via en CASE-EXISTS-subquery, slik at
		// vi ikke får TOCTOU mellom approval-sjekk og statussetting. Et regelsett
		// med _enhver_ godkjenning (også utløpte) settes til "active" — konsistent
		// med naturlig utløp, der status forblir "active" mens approvalStatus vises
		// som "expired" via computeApprovalStatus. Bare regelsett uten godkjenning
		// noensinne får status "draft".
		const now = new Date()
		const [unarchived] = await tx
			.update(rulesets)
			.set({
				status: sql<RulesetStatus>`CASE WHEN EXISTS (SELECT 1 FROM ${rulesetApprovals} WHERE ${rulesetApprovals.rulesetId} = ${rulesets.id}) THEN 'active' ELSE 'draft' END`,
				archivedAt: null,
				archivedBy: null,
				updatedAt: now,
				updatedBy: performedBy,
			})
			.where(and(eq(rulesets.id, rulesetId), isNotNull(rulesets.archivedAt)))
			.returning()

		if (!unarchived) {
			const [existing] = await tx.select().from(rulesets).where(eq(rulesets.id, rulesetId)).limit(1)
			if (!existing) return null
			return existing
		}

		await writeAuditLog(
			{
				action: "ruleset_unarchived",
				entityType: "ruleset",
				entityId: rulesetId,
				newValue: JSON.stringify({ name: unarchived.name, status: unarchived.status }),
				performedBy,
			},
			tx,
		)
		return unarchived
	})
}

/**
 * Godkjenner et regelsett ved å skrive en ny godkjenningsrad og sette
 * `validUntil` basert på frekvensen. Returnerer ID til godkjenningsraden,
 * eller `null` hvis regelsettet ikke finnes eller er arkivert. Bruker en
 * transaksjon med `SELECT FOR SHARE` på regelsett-raden for å unngå
 * TOCTOU mot samtidig arkivering.
 */
export async function approveRuleset(input: {
	rulesetId: string
	approvedBy: string
	approvedByName: string
	comment?: string
	frequency: string
}): Promise<string | null> {
	const now = new Date()
	const days = frequencyDays[input.frequency as keyof typeof frequencyDays] ?? 365
	const validUntil = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)

	return db.transaction(async (tx) => {
		const [locked] = await tx
			.select({ archivedAt: rulesets.archivedAt })
			.from(rulesets)
			.where(eq(rulesets.id, input.rulesetId))
			.for("share")
			.limit(1)
		if (!locked || locked.archivedAt) return null

		const [row] = await tx
			.insert(rulesetApprovals)
			.values({
				rulesetId: input.rulesetId,
				approvedBy: input.approvedBy,
				approvedByName: input.approvedByName,
				comment: input.comment ?? null,
				validFrom: now,
				validUntil,
			})
			.returning({ id: rulesetApprovals.id })

		// Aktiver regelsettet hvis det fortsatt er utkast.
		await tx
			.update(rulesets)
			.set({ status: "active", updatedAt: now, updatedBy: input.approvedBy })
			.where(and(eq(rulesets.id, input.rulesetId), eq(rulesets.status, "draft")))

		return row.id
	})
}

// ─── Control linking ──────────────────────────────────────────────────────

/**
 * Kobler et kontrollkrav til et regelsett. Atomisk guarded mot arkivering
 * via `SELECT FOR UPDATE` på regelsett-raden — blokkerer samtidig
 * `archiveRuleset` og serialiserer parallelle link/unlink-operasjoner mot
 * samme regelsett. Returnerer `true` når operasjonen kjøres mot et
 * eksisterende, ikke-arkivert regelsett, `false` hvis regelsettet ikke
 * finnes eller er arkivert.
 *
 * Merk: skjemaet har ingen unik begrensning på (ruleset_id, control_id),
 * så `onConflictDoNothing()` ville ikke forhindret duplikater. Idempotens
 * sikres i stedet via `FOR UPDATE`-låsen + eksplisitt eksistens-sjekk:
 * tradeoff er at samtidige link-/unlink-kall mot samme regelsett kjøres
 * sekvensielt, men det er akseptabelt siden link-mutasjoner er sjeldne.
 */
export async function linkControlToRuleset(
	rulesetId: string,
	controlId: string,
	performedBy: string,
): Promise<boolean> {
	return db.transaction(async (tx) => {
		const [locked] = await tx
			.select({ archivedAt: rulesets.archivedAt })
			.from(rulesets)
			.where(eq(rulesets.id, rulesetId))
			.for("update")
			.limit(1)
		if (!locked || locked.archivedAt) return false
		// Eksplisitt eksistens-sjekk under samme tx-lås: ruleset_controls har ingen
		// unik begrensning på (ruleset_id, control_id), så onConflictDoNothing gir
		// ingen reell idempotens. FOR UPDATE på regelsett-raden serialiserer
		// samtidige link-kall, slik at sjekk → insert ikke kan kappes av en
		// parallell transaksjon (FOR SHARE ville tillatt det).
		const [existing] = await tx
			.select({ id: rulesetControls.id })
			.from(rulesetControls)
			.where(
				and(
					eq(rulesetControls.rulesetId, rulesetId),
					eq(rulesetControls.controlId, controlId),
					isNull(rulesetControls.archivedAt),
				),
			)
			.limit(1)
		if (existing) return true
		await tx.insert(rulesetControls).values({ rulesetId, controlId })
		await writeAuditLog(
			{
				action: "ruleset_control_added",
				entityType: "ruleset_control",
				entityId: rulesetId,
				newValue: JSON.stringify({ rulesetId, controlId }),
				metadata: { controlId },
				performedBy,
			},
			tx,
		)
		return true
	})
}

/**
 * Fjerner en kobling fra et regelsett til et kontrollkrav. Tar `rulesetId`
 * som parameter for å forhindre cross-resource-mutasjon (en stale `linkId`
 * skal ikke kunne ramme et regelsett i en annen seksjon). Idempotent:
 * returnerer `true` hvis koblingen allerede er fjernet (sluttilstand er den
 * ønskede). Returnerer `false` hvis regelsettet er arkivert eller ikke finnes.
 */
export async function unlinkControlFromRuleset(
	rulesetId: string,
	linkId: string,
	performedBy: string,
): Promise<boolean> {
	return db.transaction(async (tx) => {
		// FOR UPDATE for å serialisere mot samtidige link/unlink-operasjoner på
		// samme regelsett (samme semantikk som linkControlToRuleset).
		const [locked] = await tx
			.select({ archivedAt: rulesets.archivedAt })
			.from(rulesets)
			.where(eq(rulesets.id, rulesetId))
			.for("update")
			.limit(1)
		if (!locked || locked.archivedAt) return false
		const archived = await tx
			.update(rulesetControls)
			.set({ archivedAt: new Date(), archivedBy: performedBy })
			.where(
				and(
					eq(rulesetControls.id, linkId),
					eq(rulesetControls.rulesetId, rulesetId),
					isNull(rulesetControls.archivedAt),
				),
			)
			.returning({ controlId: rulesetControls.controlId })
		if (archived.length === 0) return true
		await writeAuditLog(
			{
				action: "ruleset_control_removed",
				entityType: "ruleset_control",
				entityId: rulesetId,
				previousValue: JSON.stringify({ rulesetId, controlId: archived[0].controlId, linkId }),
				metadata: { controlId: archived[0].controlId, linkId },
				performedBy,
			},
			tx,
		)
		return true
	})
}

/** Get rulesets linked to a specific control (for the control detail page). */
export async function getRulesetsForControl(
	controlUuid: string,
): Promise<{ id: string; name: string; sectionSlug: string; sectionName: string; approvalStatus: ApprovalStatus }[]> {
	const rows = await db
		.select({
			id: rulesets.id,
			name: rulesets.name,
			status: rulesets.status,
			sectionSlug: sections.slug,
			sectionName: sections.name,
		})
		.from(rulesetControls)
		.innerJoin(rulesets, eq(rulesetControls.rulesetId, rulesets.id))
		.innerJoin(sections, eq(rulesets.sectionId, sections.id))
		.where(
			and(eq(rulesetControls.controlId, controlUuid), isNull(rulesetControls.archivedAt), isNull(rulesets.archivedAt)),
		)
		.orderBy(rulesets.name)

	if (rows.length === 0) return []

	const rulesetIds = rows.map((r) => r.id)
	const allApprovals = await db
		.select()
		.from(rulesetApprovals)
		.where(inArray(rulesetApprovals.rulesetId, rulesetIds))
		.orderBy(desc(rulesetApprovals.validFrom))

	const latestByRuleset = new Map<string, (typeof allApprovals)[0]>()
	for (const a of allApprovals) {
		if (!latestByRuleset.has(a.rulesetId)) {
			latestByRuleset.set(a.rulesetId, a)
		}
	}

	return rows.map((r) => {
		const latest = latestByRuleset.get(r.id)
		return {
			id: r.id,
			name: r.name,
			sectionSlug: r.sectionSlug,
			sectionName: r.sectionName,
			approvalStatus: computeApprovalStatus(
				r.status as RulesetStatus,
				latest ? { validUntil: latest.validUntil } : null,
			),
		}
	})
}

// ─── Routine linking ──────────────────────────────────────────────────────

/**
 * Kobler en rutine til et regelsett. Atomisk guarded mot arkivering via
 * `SELECT FOR UPDATE` på regelsett-raden og `SELECT FOR SHARE` på rutine-raden,
 * og verifiserer at rutinen tilhører samme seksjon som regelsettet
 * (kryss-seksjon-kobling avvises) og ikke selv er arkivert. Returnerer `false`
 * hvis regelsettet ikke finnes/er arkivert eller hvis rutinen ikke
 * finnes/er arkivert/tilhører en annen seksjon.
 *
 * Merk: skjemaet har ingen unik begrensning på (ruleset_id, routine_id).
 * Idempotens sikres via `FOR UPDATE`-låsen + eksplisitt eksistens-sjekk
 * (samme mønster som for `linkControlToRuleset`); tradeoff er at parallelle
 * link/unlink-kall mot samme regelsett serialiseres.
 */
export async function linkRoutineToRuleset(rulesetId: string, routineId: string, createdBy: string): Promise<boolean> {
	return db.transaction(async (tx) => {
		const [locked] = await tx
			.select({ archivedAt: rulesets.archivedAt, sectionId: rulesets.sectionId })
			.from(rulesets)
			.where(eq(rulesets.id, rulesetId))
			.for("update")
			.limit(1)
		if (!locked || locked.archivedAt) return false

		const [routine] = await tx
			.select({ sectionId: routines.sectionId, archivedAt: routines.archivedAt })
			.from(routines)
			.where(eq(routines.id, routineId))
			.for("share")
			.limit(1)
		if (!routine || routine.sectionId !== locked.sectionId || routine.archivedAt) return false

		// Eksplisitt eksistens-sjekk: ruleset_routines har ingen unik begrensning
		// på (ruleset_id, routine_id), så onConflictDoNothing gir ingen reell
		// idempotens. FOR UPDATE på regelsett-raden serialiserer samtidige
		// link-kall slik at vi ikke skriver duplikater eller falske audit-rader.
		const [existing] = await tx
			.select({ id: rulesetRoutines.id })
			.from(rulesetRoutines)
			.where(
				and(
					eq(rulesetRoutines.rulesetId, rulesetId),
					eq(rulesetRoutines.routineId, routineId),
					isNull(rulesetRoutines.archivedAt),
				),
			)
			.limit(1)
		if (existing) return true

		await tx.insert(rulesetRoutines).values({ rulesetId, routineId, createdBy })
		await writeAuditLog(
			{
				action: "ruleset_routine_added",
				entityType: "ruleset_routine",
				entityId: rulesetId,
				newValue: JSON.stringify({ rulesetId, routineId }),
				metadata: { routineId },
				performedBy: createdBy,
			},
			tx,
		)
		return true
	})
}

/**
 * Fjerner en rutinekobling fra et regelsett. Tar `rulesetId` som parameter
 * for å forhindre cross-resource-mutasjon. Idempotent: returnerer `true`
 * også når koblingen allerede er fjernet. Returnerer `false` hvis regelsettet
 * er arkivert eller ikke finnes.
 */
export async function unlinkRoutineFromRuleset(
	rulesetId: string,
	linkId: string,
	performedBy: string,
): Promise<boolean> {
	return db.transaction(async (tx) => {
		// FOR UPDATE for å serialisere mot samtidige link/unlink-operasjoner på
		// samme regelsett (samme semantikk som linkRoutineToRuleset).
		const [locked] = await tx
			.select({ archivedAt: rulesets.archivedAt })
			.from(rulesets)
			.where(eq(rulesets.id, rulesetId))
			.for("update")
			.limit(1)
		if (!locked || locked.archivedAt) return false
		const archived = await tx
			.update(rulesetRoutines)
			.set({ archivedAt: new Date(), archivedBy: performedBy })
			.where(
				and(
					eq(rulesetRoutines.id, linkId),
					eq(rulesetRoutines.rulesetId, rulesetId),
					isNull(rulesetRoutines.archivedAt),
				),
			)
			.returning({ routineId: rulesetRoutines.routineId })
		if (archived.length === 0) return true
		await writeAuditLog(
			{
				action: "ruleset_routine_removed",
				entityType: "ruleset_routine",
				entityId: rulesetId,
				previousValue: JSON.stringify({ rulesetId, routineId: archived[0].routineId, linkId }),
				metadata: { routineId: archived[0].routineId, linkId },
				performedBy,
			},
			tx,
		)
		return true
	})
}
