import { and, desc, eq, inArray, isNull } from "drizzle-orm"
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
		.where(and(eq(userRoles.role, role as UserRole), eq(userRoles.sectionId, sectionId)))
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
			.where(eq(rulesetControls.rulesetId, rulesetId))
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
			.where(eq(rulesetRoutines.rulesetId, rulesetId))
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
): Promise<void> {
	const set: Record<string, unknown> = { updatedAt: new Date(), updatedBy: input.updatedBy }
	if (input.name !== undefined) set.name = input.name
	if (input.description !== undefined) set.description = input.description
	if (input.responsibleIdent !== undefined) set.responsibleIdent = input.responsibleIdent
	if (input.responsibleName !== undefined) set.responsibleName = input.responsibleName
	if (input.responsibleRole !== undefined) set.responsibleRole = input.responsibleRole
	if (input.frequency !== undefined) set.frequency = input.frequency

	await db.update(rulesets).set(set).where(eq(rulesets.id, rulesetId))
}

export async function archiveRuleset(rulesetId: string, updatedBy: string): Promise<void> {
	await db
		.update(rulesets)
		.set({ status: "archived", archivedAt: new Date(), updatedAt: new Date(), updatedBy })
		.where(eq(rulesets.id, rulesetId))
}

/**
 * Godkjenner et regelsett ved å skrive en ny godkjenningsrad og sette
 * `validUntil` basert på frekvensen. Returnerer ID til godkjenningsraden.
 */
export async function approveRuleset(input: {
	rulesetId: string
	approvedBy: string
	approvedByName: string
	comment?: string
	frequency: string
}): Promise<string> {
	const now = new Date()
	const days = frequencyDays[input.frequency as keyof typeof frequencyDays] ?? 365
	const validUntil = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)

	const [row] = await db
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

	// Activate the ruleset if it's still in draft
	await db
		.update(rulesets)
		.set({ status: "active", updatedAt: now, updatedBy: input.approvedBy })
		.where(and(eq(rulesets.id, input.rulesetId), eq(rulesets.status, "draft")))

	return row.id
}

// ─── Control linking ──────────────────────────────────────────────────────

export async function linkControlToRuleset(rulesetId: string, controlId: string): Promise<void> {
	await db.insert(rulesetControls).values({ rulesetId, controlId }).onConflictDoNothing()
}

export async function unlinkControlFromRuleset(linkId: string): Promise<void> {
	await db.delete(rulesetControls).where(eq(rulesetControls.id, linkId))
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
		.where(and(eq(rulesetControls.controlId, controlUuid), isNull(rulesets.archivedAt)))
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

export async function linkRoutineToRuleset(rulesetId: string, routineId: string, createdBy: string): Promise<void> {
	await db.insert(rulesetRoutines).values({ rulesetId, routineId, createdBy }).onConflictDoNothing()
}

export async function unlinkRoutineFromRuleset(linkId: string): Promise<void> {
	await db.delete(rulesetRoutines).where(eq(rulesetRoutines.id, linkId))
}
