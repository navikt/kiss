import { and, desc, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm"
import type { RoutineFrequency } from "../../lib/routine-frequencies"
import { frequencyDays } from "../../lib/routine-frequencies"
import { isValidUuid } from "../../lib/utils"
import { db } from "../connection.server"
import { monitoredApplications } from "../schema/applications"
import { auditLog } from "../schema/audit"
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
import { screeningAnswers, screeningQuestions } from "../schema/screening"
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
	category: string | null
	approvalStatus: ApprovalStatus
	lastApproval: { validFrom: Date; validUntil: Date } | null
}

export interface RulesetDetail extends RulesetListItem {
	sectionId: string
	sectionName: string
	sourceRulesetId: string | null
	replacedByRulesetId: string | null
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
		requirement: string | null
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
		.orderBy(desc(userRoles.createdAt))
		.limit(1)
	return row ?? null
}

// ─── Queries ──────────────────────────────────────────────────────────────

type RulesetEnrichment = {
	latestByRuleset: Map<string, { validFrom: Date; validUntil: Date }>
	controlsByRuleset: Map<string, Array<{ id: string; controlId: string; shortTitle: string | null }>>
}

async function enrichRulesetsWithApprovalsAndControls(rulesetIds: string[]): Promise<RulesetEnrichment> {
	const [latestApprovals, allControls] = await Promise.all([
		db
			.selectDistinctOn([rulesetApprovals.rulesetId], {
				rulesetId: rulesetApprovals.rulesetId,
				validFrom: rulesetApprovals.validFrom,
				validUntil: rulesetApprovals.validUntil,
			})
			.from(rulesetApprovals)
			.where(inArray(rulesetApprovals.rulesetId, rulesetIds))
			.orderBy(rulesetApprovals.rulesetId, desc(rulesetApprovals.validFrom)),
		db
			.select({
				rulesetId: rulesetControls.rulesetId,
				id: frameworkControls.id,
				controlId: frameworkControls.controlId,
				shortTitle: frameworkControls.shortTitle,
			})
			.from(rulesetControls)
			.innerJoin(frameworkControls, eq(rulesetControls.controlId, frameworkControls.id))
			.where(and(inArray(rulesetControls.rulesetId, rulesetIds), isNull(rulesetControls.archivedAt)))
			.orderBy(frameworkControls.controlId),
	])

	const latestByRuleset = new Map<string, { validFrom: Date; validUntil: Date }>()
	for (const a of latestApprovals) {
		latestByRuleset.set(a.rulesetId, { validFrom: a.validFrom, validUntil: a.validUntil })
	}

	const controlsByRuleset = new Map<string, Array<{ id: string; controlId: string; shortTitle: string | null }>>()
	for (const c of allControls) {
		const arr = controlsByRuleset.get(c.rulesetId) ?? []
		arr.push({ id: c.id, controlId: c.controlId, shortTitle: c.shortTitle })
		controlsByRuleset.set(c.rulesetId, arr)
	}

	return { latestByRuleset, controlsByRuleset }
}

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
			category: r.category ?? null,
			approvalStatus: computeApprovalStatus(
				r.status as RulesetStatus,
				latest ? { validUntil: latest.validUntil } : null,
			),
			lastApproval: latest ? { validFrom: latest.validFrom, validUntil: latest.validUntil } : null,
		}
	})
}

/**
 * Returns the set of ruleset IDs that an application has opted into via screening.
 * Two paths:
 * 1. Question has rulesetId pointing to a ruleset and the app has answered it
 * 2. Question has answerType='ruleset' and the answer IS the ruleset ID
 */
export async function getRulesetIdsSelectedByApp(applicationId: string): Promise<Set<string>> {
	// Resolve primary application inheritance (child apps inherit screening from parent)
	const [app] = await db
		.select({ primaryApplicationId: monitoredApplications.primaryApplicationId })
		.from(monitoredApplications)
		.where(eq(monitoredApplications.id, applicationId))
		.limit(1)
	const screeningAppId = app?.primaryApplicationId ?? applicationId

	const [answeredRows, selectedRows] = await Promise.all([
		db
			.selectDistinct({ rulesetId: screeningQuestions.rulesetId })
			.from(screeningAnswers)
			.innerJoin(
				screeningQuestions,
				and(
					eq(screeningQuestions.id, screeningAnswers.questionId),
					isNull(screeningQuestions.archivedAt),
					eq(screeningQuestions.status, "approved"),
				),
			)
			.where(
				and(
					eq(screeningAnswers.applicationId, screeningAppId),
					isNotNull(screeningQuestions.rulesetId),
					isNotNull(screeningAnswers.answer),
				),
			),
		db
			.selectDistinct({ rulesetId: screeningAnswers.answer })
			.from(screeningAnswers)
			.innerJoin(
				screeningQuestions,
				and(
					eq(screeningQuestions.id, screeningAnswers.questionId),
					isNull(screeningQuestions.archivedAt),
					eq(screeningQuestions.status, "approved"),
					eq(screeningQuestions.answerType, "ruleset"),
				),
			)
			.where(and(eq(screeningAnswers.applicationId, screeningAppId), isNotNull(screeningAnswers.answer))),
	])

	const ids = new Set<string>()
	for (const r of answeredRows) {
		if (r.rulesetId) ids.add(r.rulesetId)
	}
	for (const r of selectedRows) {
		if (r.rulesetId && isValidUuid(r.rulesetId)) ids.add(r.rulesetId)
	}
	return ids
}

/**
 * Returns full ruleset details for rulesets an app has opted into via screening.
 * Reuses getRulesetIdsSelectedByApp for ID resolution, then fetches details + approvals.
 */
export async function getRulesetsSelectedByApp(applicationId: string): Promise<
	Array<{
		id: string
		code: string | null
		name: string
		description: string | null
		frequency: string
		status: string
		sectionId: string
		sectionSlug: string
		sectionName: string
		responsibleName: string | null
		responsibleRole: string | null
		approvalStatus: ApprovalStatus
		lastApproval: { validFrom: string; validUntil: string } | null
		controls: Array<{ id: string; controlId: string; shortTitle: string | null }>
	}>
> {
	const selectedIds = await getRulesetIdsSelectedByApp(applicationId)
	if (selectedIds.size === 0) return []

	const rows = await db
		.select({
			id: rulesets.id,
			code: rulesets.code,
			name: rulesets.name,
			description: rulesets.description,
			frequency: rulesets.frequency,
			status: rulesets.status,
			sectionId: rulesets.sectionId,
			sectionSlug: sections.slug,
			sectionName: sections.name,
			responsibleName: rulesets.responsibleName,
			responsibleRole: rulesets.responsibleRole,
		})
		.from(rulesets)
		.innerJoin(sections, eq(sections.id, rulesets.sectionId))
		.where(and(inArray(rulesets.id, [...selectedIds]), isNull(rulesets.archivedAt)))
		.orderBy(rulesets.name)

	if (rows.length === 0) return []

	const rulesetIds = rows.map((r) => r.id)
	const { latestByRuleset, controlsByRuleset } = await enrichRulesetsWithApprovalsAndControls(rulesetIds)

	return rows.map((r) => {
		const latest = latestByRuleset.get(r.id)
		return {
			id: r.id,
			code: r.code,
			name: r.name,
			description: r.description,
			frequency: r.frequency,
			status: r.status,
			sectionId: r.sectionId,
			sectionSlug: r.sectionSlug,
			sectionName: r.sectionName,
			responsibleName: r.responsibleName,
			responsibleRole: r.responsibleRole,
			approvalStatus: computeApprovalStatus(
				r.status as RulesetStatus,
				latest ? { validUntil: latest.validUntil } : null,
			),
			lastApproval: latest
				? { validFrom: latest.validFrom.toISOString(), validUntil: latest.validUntil.toISOString() }
				: null,
			controls: controlsByRuleset.get(r.id) ?? [],
		}
	})
}

/**
 * Find rulesets in a section that share at least one control with the given control IDs.
 * Used by the review wizard to show relevant rulesets with full detail.
 */
export async function getRulesetsLinkedToControls(
	controlIds: string[],
	sectionId: string,
): Promise<
	Array<{
		id: string
		code: string | null
		name: string
		description: string | null
		frequency: string
		status: string
		responsibleName: string | null
		responsibleRole: string | null
		approvalStatus: ApprovalStatus
		lastApproval: { validFrom: string; validUntil: string } | null
		controls: Array<{ id: string; controlId: string; shortTitle: string | null }>
	}>
> {
	if (controlIds.length === 0) return []

	const rows = await db
		.selectDistinct({
			id: rulesets.id,
			code: rulesets.code,
			name: rulesets.name,
			description: rulesets.description,
			frequency: rulesets.frequency,
			status: rulesets.status,
			responsibleName: rulesets.responsibleName,
			responsibleRole: rulesets.responsibleRole,
		})
		.from(rulesets)
		.innerJoin(rulesetControls, eq(rulesetControls.rulesetId, rulesets.id))
		.where(
			and(
				eq(rulesets.sectionId, sectionId),
				isNull(rulesets.archivedAt),
				isNull(rulesetControls.archivedAt),
				inArray(rulesetControls.controlId, controlIds),
			),
		)
		.orderBy(rulesets.name)

	if (rows.length === 0) return []

	const rulesetIds = rows.map((r) => r.id)
	const { latestByRuleset, controlsByRuleset } = await enrichRulesetsWithApprovalsAndControls(rulesetIds)

	return rows.map((r) => {
		const latest = latestByRuleset.get(r.id)
		return {
			id: r.id,
			code: r.code,
			name: r.name,
			description: r.description,
			frequency: r.frequency,
			status: r.status,
			responsibleName: r.responsibleName,
			responsibleRole: r.responsibleRole,
			approvalStatus: computeApprovalStatus(
				r.status as RulesetStatus,
				latest ? { validUntil: latest.validUntil } : null,
			),
			lastApproval: latest
				? { validFrom: latest.validFrom.toISOString(), validUntil: latest.validUntil.toISOString() }
				: null,
			controls: controlsByRuleset.get(r.id) ?? [],
		}
	})
}

export interface RulesetLinkedAtDate {
	id: string
	code: string | null
	name: string
	description: string | null
	status: string
	/** false when reconstructed from audit history for the given date, true when we had to fall back to the current linkage */
	isCurrentFallback: boolean
	/** nav-ident til den som sist godkjente regelsettet (nyeste `rulesetApprovals`-rad), eller null hvis ikke godkjent ennå */
	approvedBy: string | null
}

/**
 * Rekonstruerer hvilke regelsett som var koblet til en rutine på et gitt tidspunkt
 * (typisk `review.reviewedAt`), basert på `audit_log`-hendelsene
 * `ruleset_routine_added`/`ruleset_routine_removed` (skrevet med `metadata.routineId`).
 *
 * Koblinger mellom regelsett og rutine er IKKE låst etter at rutinen er godkjent —
 * `linkRoutineToRuleset`/`unlinkRoutineFromRuleset` sjekker kun regelsettets status,
 * ikke rutinens. Gjeldende kobling (`ruleset_routines`-tabellen) kan derfor avvike
 * fra det som faktisk gjaldt da en eldre gjennomgang ble utført.
 *
 * Faller tilbake til gjeldende koblede regelsett (`isCurrentFallback: true`) hvis vi
 * ikke finner NOEN `ruleset_routine_added`/`ruleset_routine_removed`-hendelse for
 * rutinen før `asOfDate` — dette skjer typisk for de eldste gjennomgangene, fra før
 * koblingen ble endret for første gang etter at audit-logging dekket denne handlingen.
 */
export async function getRulesetsLinkedToRoutineAtDate(
	routineId: string,
	asOfDate: Date,
): Promise<RulesetLinkedAtDate[]> {
	const relevantEvents = await db
		.select({
			action: auditLog.action,
			entityId: auditLog.entityId,
			metadata: auditLog.metadata,
			performedAt: auditLog.performedAt,
		})
		.from(auditLog)
		.where(
			and(
				inArray(auditLog.action, ["ruleset_routine_added", "ruleset_routine_removed"]),
				eq(auditLog.entityType, "ruleset_routine"),
				sql`${auditLog.metadata}::jsonb ->> 'routineId' = ${routineId}`,
				lte(auditLog.performedAt, asOfDate),
			),
		)
		.orderBy(auditLog.performedAt)

	let rulesetIds: string[]
	let usedFallback: boolean
	if (relevantEvents.length === 0) {
		const currentRows = await db
			.select({ rulesetId: rulesetRoutines.rulesetId })
			.from(rulesetRoutines)
			.where(and(eq(rulesetRoutines.routineId, routineId), isNull(rulesetRoutines.archivedAt)))
		rulesetIds = [...new Set(currentRows.map((r) => r.rulesetId))]
		usedFallback = true
	} else {
		const linked = new Set<string>()
		for (const event of relevantEvents) {
			// entityId på ruleset_routine_added/removed er rulesetId (se writeAuditLog-kallene i linkRoutineToRuleset/unlinkRoutineFromRuleset)
			if (event.action === "ruleset_routine_added") {
				linked.add(event.entityId)
			} else {
				linked.delete(event.entityId)
			}
		}
		rulesetIds = [...linked]
		usedFallback = false
	}

	if (rulesetIds.length === 0) return []

	const [rows, latestApprovals] = await Promise.all([
		db
			.select({
				id: rulesets.id,
				code: rulesets.code,
				name: rulesets.name,
				description: rulesets.description,
				status: rulesets.status,
			})
			.from(rulesets)
			.where(inArray(rulesets.id, rulesetIds))
			.orderBy(rulesets.name),
		db
			.selectDistinctOn([rulesetApprovals.rulesetId], {
				rulesetId: rulesetApprovals.rulesetId,
				approvedBy: rulesetApprovals.approvedBy,
			})
			.from(rulesetApprovals)
			.where(inArray(rulesetApprovals.rulesetId, rulesetIds))
			.orderBy(rulesetApprovals.rulesetId, desc(rulesetApprovals.validFrom)),
	])

	const approvedByRuleset = new Map(latestApprovals.map((a) => [a.rulesetId, a.approvedBy]))

	return rows.map((r) => ({
		...r,
		isCurrentFallback: usedFallback,
		approvedBy: approvedByRuleset.get(r.id) ?? null,
	}))
}

export interface RulesetMeta {
	id: string
	sectionId: string
	status: RulesetStatus
	archivedAt: Date | null
}

/**
 * Lett SELECT for action-guards: kun id, seksjon, status og arkiv-status.
 * Bruk denne i stedet for `getRulesetDetail` når du kun trenger å verifisere
 * at regelsettet finnes, tilhører riktig seksjon og har forventet status
 * (f.eks. `status === 'active'` før kopiering, eller ikke arkivert).
 */
export async function getRulesetMeta(rulesetId: string): Promise<RulesetMeta | null> {
	const [row] = await db
		.select({
			id: rulesets.id,
			sectionId: rulesets.sectionId,
			status: rulesets.status,
			archivedAt: rulesets.archivedAt,
		})
		.from(rulesets)
		.where(eq(rulesets.id, rulesetId))
		.limit(1)
	return row ?? null
}

/** Henter navn (for lineage-visning: forgjenger/erstatter) for en liste med regelsett-IDer. */
export async function getRulesetNamesByIds(
	ids: string[],
): Promise<Map<string, { name: string; status: RulesetStatus }>> {
	if (ids.length === 0) return new Map()
	const rows = await db
		.select({ id: rulesets.id, name: rulesets.name, status: rulesets.status })
		.from(rulesets)
		.where(inArray(rulesets.id, ids))
	return new Map(rows.map((r) => [r.id, { name: r.name, status: r.status }]))
}

export async function getRulesetById(
	rulesetId: string,
): Promise<{ id: string; sectionId: string; status: string; category: string | null } | null> {
	const [row] = await db
		.select({ id: rulesets.id, sectionId: rulesets.sectionId, status: rulesets.status, category: rulesets.category })
		.from(rulesets)
		.where(and(eq(rulesets.id, rulesetId), isNull(rulesets.archivedAt)))
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
			category: rulesets.category,
			sourceRulesetId: rulesets.sourceRulesetId,
			replacedByRulesetId: rulesets.replacedByRulesetId,
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
				requirement: frameworkControls.requirement,
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
		category: row.category ?? null,
		sourceRulesetId: row.sourceRulesetId,
		replacedByRulesetId: row.replacedByRulesetId,
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
			requirement: c.requirement,
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
 * Oppdaterer et regelsett. Kan **kun** endre regelsett med `status='draft'`
 * (dvs. som aldri har vært godkjent) — et regelsett som er eller har vært
 * `active` skal redigeres via `copyRuleset()` + `replaceRuleset()`, ikke
 * muteres direkte. Dette gjelder alle brukere, inkludert admin: en godkjent
 * versjon skal aldri kunne endres i etterkant uten en ny godkjenningsrunde.
 * Kjøres i transaksjon med `SELECT FOR UPDATE` på regelsett-raden slik at
 * status-sjekken serialiseres mot samtidig `approveRuleset`/`archiveRuleset`.
 * Returnerer `true` ved suksess, `false` hvis regelsettet ikke finnes, er
 * arkivert, eller ikke lenger er `draft`.
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
		category?: string | null
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
	if (input.category !== undefined) set.category = input.category

	return db.transaction(async (tx) => {
		const [locked] = await tx
			.select({ archivedAt: rulesets.archivedAt, status: rulesets.status })
			.from(rulesets)
			.where(eq(rulesets.id, rulesetId))
			.for("update")
			.limit(1)
		if (!locked || locked.archivedAt || locked.status !== "draft") return false

		const updated = await tx
			.update(rulesets)
			.set(set)
			.where(and(eq(rulesets.id, rulesetId), isNull(rulesets.archivedAt), eq(rulesets.status, "draft")))
			.returning({ id: rulesets.id })
		if (updated.length === 0) return false

		await writeAuditLog(
			{
				action: "ruleset_updated",
				entityType: "ruleset",
				entityId: rulesetId,
				newValue: JSON.stringify(set),
				performedBy: input.updatedBy,
			},
			tx,
		)
		return true
	})
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
 * `validUntil` basert på regelsettets faktiske frekvens (lest fra den låste
 * raden, ikke et kallested-argument — samme prinsipp som `replaceRuleset()`).
 * Returnerer `null` hvis regelsettet ikke finnes, er arkivert, eller ikke
 * lenger er `draft` (allerede godkjent). Bruker en transaksjon med
 * `SELECT FOR UPDATE` på regelsett-raden for å unngå TOCTOU mot samtidig
 * arkivering eller dobbel godkjenning.
 */
export async function approveRuleset(input: {
	rulesetId: string
	approvedBy: string
	approvedByName: string
	comment?: string
}): Promise<string | null> {
	const now = new Date()

	return db.transaction(async (tx) => {
		const [locked] = await tx
			.select({ status: rulesets.status, archivedAt: rulesets.archivedAt, frequency: rulesets.frequency })
			.from(rulesets)
			.where(eq(rulesets.id, input.rulesetId))
			.for("update")
			.limit(1)
		if (!locked || locked.archivedAt || locked.status !== "draft") return null

		const days = frequencyDays[locked.frequency as keyof typeof frequencyDays] ?? 365
		const validUntil = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)

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

		const [activated] = await tx
			.update(rulesets)
			.set({ status: "active", updatedAt: now, updatedBy: input.approvedBy })
			.where(and(eq(rulesets.id, input.rulesetId), eq(rulesets.status, "draft")))
			.returning({ id: rulesets.id })
		if (!activated) {
			throw new Response("Regelsettet ble endret av en annen operasjon under godkjenningen. Prøv igjen.", {
				status: 409,
			})
		}

		return row.id
	})
}

/**
 * Lager en draft-kopi av et eksisterende regelsett med alle aktive
 * kontrollkrav- og rutinekoblinger. Brukes som utgangspunkt for å redigere
 * et regelsett som er (eller har vært) godkjent — se `replaceRuleset()` for
 * hvordan kopien senere erstatter originalen. Samme mønster som
 * `copyRoutine()`. Returnerer `null` hvis kilderegelsettet ikke finnes.
 */
export async function copyRuleset(rulesetId: string, performedBy: string) {
	// Atomisk: archive-guard + lesing + INSERTs i samme tx med FOR SHARE-lås på
	// kilde-regelsettet, så samtidig archiveRuleset() blokkeres til vi har
	// kopiert ferdig. Henter kun feltene som trengs for kopiering (ikke
	// getRulesetDetail(), som også slår opp approvals/attachments/rolleinnehaver
	// utenfor tx — unødvendig arbeid og ikke lås-bundet til selve kopieringen).
	return db.transaction(async (tx) => {
		const [locked] = await tx
			.select({
				sectionId: rulesets.sectionId,
				name: rulesets.name,
				description: rulesets.description,
				responsibleIdent: rulesets.responsibleIdent,
				responsibleName: rulesets.responsibleName,
				responsibleRole: rulesets.responsibleRole,
				frequency: rulesets.frequency,
				category: rulesets.category,
				status: rulesets.status,
				archivedAt: rulesets.archivedAt,
			})
			.from(rulesets)
			.where(eq(rulesets.id, rulesetId))
			.for("share")
			.limit(1)
		if (!locked) return null
		if (locked.archivedAt) {
			throw new Response("Arkiverte regelsett kan ikke kopieres. Reaktiver regelsettet først.", { status: 403 })
		}
		if (locked.status !== "active") {
			throw new Response("Kun godkjente (aktive) regelsett kan kopieres for redigering.", { status: 400 })
		}

		const [controls, linkedRoutines] = await Promise.all([
			tx
				.select({ controlId: rulesetControls.controlId })
				.from(rulesetControls)
				.where(and(eq(rulesetControls.rulesetId, rulesetId), isNull(rulesetControls.archivedAt))),
			tx
				.select({ routineId: rulesetRoutines.routineId })
				.from(rulesetRoutines)
				.where(and(eq(rulesetRoutines.rulesetId, rulesetId), isNull(rulesetRoutines.archivedAt))),
		])

		const [copy] = await tx
			.insert(rulesets)
			.values({
				sectionId: locked.sectionId,
				code: null,
				name: locked.name,
				description: locked.description,
				responsibleIdent: locked.responsibleIdent,
				responsibleName: locked.responsibleName,
				responsibleRole: locked.responsibleRole,
				frequency: locked.frequency as RoutineFrequency,
				category: locked.category,
				status: "draft",
				sourceRulesetId: rulesetId,
				createdBy: performedBy,
				updatedBy: performedBy,
			})
			.returning()

		if (controls.length > 0) {
			await tx.insert(rulesetControls).values(controls.map((c) => ({ rulesetId: copy.id, controlId: c.controlId })))
		}

		if (linkedRoutines.length > 0) {
			await tx.insert(rulesetRoutines).values(
				linkedRoutines.map((r) => ({
					rulesetId: copy.id,
					routineId: r.routineId,
					createdBy: performedBy,
				})),
			)
		}

		await writeAuditLog(
			{
				action: "ruleset_copied",
				entityType: "ruleset",
				entityId: copy.id,
				newValue: JSON.stringify({ sourceRulesetId: rulesetId, name: copy.name }),
				metadata: { sourceRulesetId: rulesetId },
				performedBy,
			},
			tx,
		)

		return copy
	})
}

/**
 * Godkjenner en redigert kopi (`newRulesetId`, med `sourceRulesetId` som peker
 * til `oldRulesetId`) og erstatter den opprinnelige, godkjente versjonen.
 * Samme prinsipp som `replaceRoutine()` for rutiner: den gamle raden endres
 * aldri i etterkant — den arkiveres og merkes med `replacedByRulesetId`, mens
 * den nye raden aktiveres med en fersk godkjenningsrad. Alle koblinger
 * (kontrollkrav, rutiner) ligger allerede på kopien fra `copyRuleset()`, så
 * her arkiveres kun de gamle koblingene for å unngå to "aktive" koblingssett.
 *
 * Merk: `screeningAnswers`-svar av typen `answerType='ruleset'` som peker på
 * `oldRulesetId` migreres **ikke** automatisk — de forblir historisk korrekte
 * (viser hvilket regelsett appen fulgte på svartidspunktet). Appen må selv
 * velge/bekrefte det nye regelsettet for at det skal telle i fremtidig
 * compliance-vurdering.
 */
export async function replaceRuleset(input: {
	newRulesetId: string
	oldRulesetId: string
	approvedBy: string
	approvedByName: string
	comment?: string
}): Promise<string | null> {
	const { newRulesetId, oldRulesetId } = input
	if (newRulesetId === oldRulesetId) {
		throw new Response("Nytt og gammelt regelsett-ID kan ikke være det samme", { status: 400 })
	}

	const now = new Date()

	return db.transaction(async (tx) => {
		const [newLocked] = await tx
			.select({
				name: rulesets.name,
				status: rulesets.status,
				archivedAt: rulesets.archivedAt,
				sourceRulesetId: rulesets.sourceRulesetId,
				frequency: rulesets.frequency,
			})
			.from(rulesets)
			.where(eq(rulesets.id, newRulesetId))
			.for("update")
			.limit(1)
		if (!newLocked) throw new Response("Regelsettet som skal godkjennes ble ikke funnet", { status: 404 })
		if (newLocked.archivedAt) {
			throw new Response("Arkiverte regelsett kan ikke godkjennes. Reaktiver regelsettet først.", { status: 403 })
		}
		if (newLocked.status !== "draft") {
			throw new Response("Kun draft-regelsett kan godkjennes som erstatning", { status: 400 })
		}
		if (newLocked.sourceRulesetId !== oldRulesetId) {
			throw new Response("Regelsettet peker ikke på det opprinnelige regelsettet som skal erstattes", { status: 400 })
		}

		// Bruk regelsettets faktiske (nylig låste) frekvens for gyldighetsperioden,
		// ikke en frekvens oppgitt av kallestedet — sistnevnte kan være foreldet
		// hvis regelsettet ble redigert etter at kallestedet leste det, men før
		// denne transaksjonen tok låsen.
		const days = frequencyDays[newLocked.frequency as keyof typeof frequencyDays] ?? 365
		const validUntil = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)

		const [oldLocked] = await tx
			.select({ name: rulesets.name, status: rulesets.status, archivedAt: rulesets.archivedAt })
			.from(rulesets)
			.where(eq(rulesets.id, oldRulesetId))
			.for("update")
			.limit(1)
		if (!oldLocked) throw new Response("Regelsettet som skal erstattes ble ikke funnet", { status: 404 })
		if (oldLocked.archivedAt) {
			throw new Response("Kan ikke erstatte et arkivert regelsett.", { status: 400 })
		}
		if (oldLocked.status !== "active") {
			throw new Response("Kun et godkjent (aktivt) regelsett kan erstattes", { status: 400 })
		}

		const [row] = await tx
			.insert(rulesetApprovals)
			.values({
				rulesetId: newRulesetId,
				approvedBy: input.approvedBy,
				approvedByName: input.approvedByName,
				comment: input.comment ?? null,
				validFrom: now,
				validUntil,
			})
			.returning({ id: rulesetApprovals.id })

		const [activated] = await tx
			.update(rulesets)
			.set({ status: "active", updatedAt: now, updatedBy: input.approvedBy })
			.where(and(eq(rulesets.id, newRulesetId), eq(rulesets.status, "draft")))
			.returning({ id: rulesets.id })
		if (!activated) {
			// Skal ikke kunne skje siden raden er låst med FOR UPDATE ovenfor og
			// status allerede er validert til "draft" — men vi sjekker likevel
			// eksplisitt (forsvar i dybden mot fremtidige endringer i denne
			// funksjonen som fjerner låsen).
			throw new Response("Kunne ikke aktivere det nye regelsettet — status endret seg underveis", { status: 409 })
		}

		const [archived] = await tx
			.update(rulesets)
			.set({
				status: "archived",
				archivedAt: now,
				archivedBy: input.approvedBy,
				replacedByRulesetId: newRulesetId,
				replacedAt: now,
				updatedAt: now,
				updatedBy: input.approvedBy,
			})
			.where(and(eq(rulesets.id, oldRulesetId), isNull(rulesets.archivedAt)))
			.returning({ id: rulesets.id })
		if (!archived) {
			throw new Response("Kunne ikke arkivere det opprinnelige regelsettet — status endret seg underveis", {
				status: 409,
			})
		}

		// Arkiver gamle koblinger for å unngå to "aktive" koblingssett samtidig
		// (kopien fikk allerede egne, ferske koblinger i copyRuleset()).
		await tx
			.update(rulesetControls)
			.set({ archivedAt: now, archivedBy: input.approvedBy })
			.where(and(eq(rulesetControls.rulesetId, oldRulesetId), isNull(rulesetControls.archivedAt)))
		await tx
			.update(rulesetRoutines)
			.set({ archivedAt: now, archivedBy: input.approvedBy })
			.where(and(eq(rulesetRoutines.rulesetId, oldRulesetId), isNull(rulesetRoutines.archivedAt)))

		await writeAuditLog(
			{
				action: "ruleset_replaced",
				entityType: "ruleset",
				entityId: newRulesetId,
				previousValue: JSON.stringify({ id: oldRulesetId, name: oldLocked.name, status: oldLocked.status }),
				newValue: JSON.stringify({ id: newRulesetId, name: newLocked.name, status: "active" }),
				metadata: { replacedRulesetId: oldRulesetId },
				performedBy: input.approvedBy,
			},
			tx,
		)

		return row.id
	})
}

// ─── Control linking ──────────────────────────────────────────────────────

/**
 * Kobler et kontrollkrav til et regelsett. Kan **kun** gjøres på regelsett
 * med `status='draft'` — se `updateRuleset()` for begrunnelse (godkjent
 * innhold skal ikke kunne endres i etterkant, heller ikke av admin). Atomisk
 * guarded mot arkivering og statusendring via `SELECT FOR UPDATE` på
 * regelsett-raden. Returnerer `true` når operasjonen kjøres mot et
 * eksisterende draft-regelsett, `false` hvis regelsettet ikke finnes, er
 * arkivert, eller ikke lenger er `draft`.
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
			.select({ archivedAt: rulesets.archivedAt, status: rulesets.status })
			.from(rulesets)
			.where(eq(rulesets.id, rulesetId))
			.for("update")
			.limit(1)
		if (!locked || locked.archivedAt || locked.status !== "draft") return false
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
 * Fjerner en kobling fra et regelsett til et kontrollkrav. Kan **kun** gjøres
 * på regelsett med `status='draft'` (se `updateRuleset()`). Tar `rulesetId`
 * som parameter for å forhindre cross-resource-mutasjon (en stale `linkId`
 * skal ikke kunne ramme et regelsett i en annen seksjon). Idempotent:
 * returnerer `true` hvis koblingen allerede er fjernet (sluttilstand er den
 * ønskede). Returnerer `false` hvis regelsettet er arkivert, ikke finnes,
 * eller ikke lenger er `draft`.
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
			.select({ archivedAt: rulesets.archivedAt, status: rulesets.status })
			.from(rulesets)
			.where(eq(rulesets.id, rulesetId))
			.for("update")
			.limit(1)
		if (!locked || locked.archivedAt || locked.status !== "draft") return false
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
 * Kobler en rutine til et regelsett. Kan **kun** gjøres på regelsett med
 * `status='draft'` (se `updateRuleset()` for begrunnelse). Atomisk guarded
 * mot arkivering via `SELECT FOR UPDATE` på regelsett-raden og
 * `SELECT FOR SHARE` på rutine-raden, og verifiserer at rutinen tilhører
 * samme seksjon som regelsettet (kryss-seksjon-kobling avvises) og ikke selv
 * er arkivert. Returnerer `false` hvis regelsettet ikke finnes/er
 * arkivert/ikke lenger `draft`, eller hvis rutinen ikke finnes/er
 * arkivert/tilhører en annen seksjon.
 *
 * Merk: skjemaet har ingen unik begrensning på (ruleset_id, routine_id).
 * Idempotens sikres via `FOR UPDATE`-låsen + eksplisitt eksistens-sjekk
 * (samme mønster som for `linkControlToRuleset`); tradeoff er at parallelle
 * link/unlink-kall mot samme regelsett serialiseres.
 */
export async function linkRoutineToRuleset(rulesetId: string, routineId: string, createdBy: string): Promise<boolean> {
	return db.transaction(async (tx) => {
		const [locked] = await tx
			.select({ archivedAt: rulesets.archivedAt, sectionId: rulesets.sectionId, status: rulesets.status })
			.from(rulesets)
			.where(eq(rulesets.id, rulesetId))
			.for("update")
			.limit(1)
		if (!locked || locked.archivedAt || locked.status !== "draft") return false

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
 * Fjerner en rutinekobling fra et regelsett. Kan **kun** gjøres på regelsett
 * med `status='draft'` (se `updateRuleset()`). Tar `rulesetId` som parameter
 * for å forhindre cross-resource-mutasjon. Idempotent: returnerer `true`
 * også når koblingen allerede er fjernet. Returnerer `false` hvis regelsettet
 * er arkivert, ikke finnes, eller ikke lenger er `draft`.
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
			.select({ archivedAt: rulesets.archivedAt, status: rulesets.status })
			.from(rulesets)
			.where(eq(rulesets.id, rulesetId))
			.for("update")
			.limit(1)
		if (!locked || locked.archivedAt || locked.status !== "draft") return false
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
