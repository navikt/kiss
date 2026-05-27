import { z } from "zod"
import { RPA_DECISION_VALUES, type RpaDecision } from "~/db/schema/routines"

export const RPA_STAGED_DATA_ACTIVITY_TYPE = "rpa_user_maintenance" as const
export const RPA_STAGED_DATA_SCHEMA_VERSION = 1 as const

export const rpaStagedUserMatchSources = ["nais", "manual"] as const
export type RpaStagedUserMatchSource = (typeof rpaStagedUserMatchSources)[number]

// ─── UI Types ─────────────────────────────────────────────────────────────────
// These are used by RpaUserMaintenanceSection and conversion functions below.

export type RpaUserEntry = {
	userObjectId: string
	displayName: string | null
	userPrincipalName: string | null
	accountEnabled: boolean | null
	rpaGroupName: string | null
	matchSource: "nais" | "manual" | "removed"
}

export type RpaUserAssessmentEntry = {
	id: string
	owner: string | null
	needComment: string | null
	criticalityComment: string | null
	securityComment: string | null
	decision: RpaDecision | null
	decisionDeadline: string | null
}

export type RpaMaintenanceData = {
	users: RpaUserEntry[]
	assessments: Record<string, RpaUserAssessmentEntry>
}

// ─── Staged Data Types ────────────────────────────────────────────────────────

export type RpaStagedUser = {
	userObjectId: string
	displayName: string | null
	userPrincipalName: string | null
	accountEnabled: boolean | null
	rpaGroupName: string | null
	/** How the user was matched. Null when isGone=true. */
	matchSource: RpaStagedUserMatchSource | null
	/** True when user no longer appears in app access but had a prior assessment. */
	isGone: boolean
	owner: string | null
	needComment: string | null
	criticalityComment: string | null
	securityComment: string | null
	decision: RpaDecision | null
	/** ISO date string YYYY-MM-DD. Only set when decision is avvikles or endres. */
	decisionDeadline: string | null
}

export type RpaStagedData = {
	activityType: typeof RPA_STAGED_DATA_ACTIVITY_TYPE
	schemaVersion: typeof RPA_STAGED_DATA_SCHEMA_VERSION
	seededAt: string
	users: RpaStagedUser[]
}

export type RpaUserSnapshot = {
	users: Array<{
		userObjectId: string
		displayName: string | null
		isGone: boolean
		matchSource: RpaStagedUserMatchSource | null
		decision: RpaDecision | null
	}>
}

export type RpaStagedDataPatch = {
	op: "set-assessment"
	userObjectId: string
	owner?: string | null
	needComment?: string | null
	criticalityComment?: string | null
	securityComment?: string | null
	decision?: RpaDecision | null
	decisionDeadline?: string | null
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const rpaDecisionSchema = z.enum(RPA_DECISION_VALUES)
const rpaStagedUserMatchSourceSchema = z.enum(rpaStagedUserMatchSources)

const rpaStagedUserSchema = z.object({
	userObjectId: z.string().min(1),
	displayName: z.string().min(1).nullable(),
	userPrincipalName: z.string().min(1).nullable(),
	accountEnabled: z.boolean().nullable(),
	rpaGroupName: z.string().min(1).nullable(),
	matchSource: rpaStagedUserMatchSourceSchema.nullable(),
	isGone: z.boolean(),
	owner: z.string().min(1).nullable(),
	needComment: z.string().min(1).nullable(),
	criticalityComment: z.string().min(1).nullable(),
	securityComment: z.string().min(1).nullable(),
	decision: rpaDecisionSchema.nullable(),
	decisionDeadline: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.nullable(),
})

export const rpaStagedDataSchema = z
	.object({
		activityType: z.literal(RPA_STAGED_DATA_ACTIVITY_TYPE),
		schemaVersion: z.literal(RPA_STAGED_DATA_SCHEMA_VERSION),
		seededAt: z.string().datetime(),
		users: z.array(rpaStagedUserSchema),
	})
	.superRefine((data, ctx) => {
		const seen = new Set<string>()
		for (const [index, user] of data.users.entries()) {
			if (seen.has(user.userObjectId)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: `Duplikat userObjectId: ${user.userObjectId}`,
					path: ["users", index, "userObjectId"],
				})
			}
			seen.add(user.userObjectId)

			// Deadline requires decision = avvikles|endres
			if (user.decisionDeadline !== null && user.decision !== "avvikles" && user.decision !== "endres") {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "decisionDeadline krever decision = avvikles eller endres",
					path: ["users", index, "decisionDeadline"],
				})
			}

			// matchSource must be set for active users
			if (!user.isGone && user.matchSource === null) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "matchSource må være satt for aktive brukere",
					path: ["users", index, "matchSource"],
				})
			}

			// matchSource must be null for gone users (ghost consistency)
			if (user.isGone && user.matchSource !== null) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "matchSource må være null for borte brukere (isGone=true)",
					path: ["users", index, "matchSource"],
				})
			}
		}
	})

const rpaUserSnapshotSchema = z.object({
	users: z.array(
		z.object({
			userObjectId: z.string().min(1),
			displayName: z.string().min(1).nullable(),
			isGone: z.boolean(),
			matchSource: rpaStagedUserMatchSourceSchema.nullable(),
			decision: rpaDecisionSchema.nullable(),
		}),
	),
})

// ─── Parse functions ──────────────────────────────────────────────────────────

export function parseRpaStagedData(data: unknown): RpaStagedData {
	return rpaStagedDataSchema.parse(data)
}

export function parseRpaUserSnapshot(data: unknown): RpaUserSnapshot {
	return rpaUserSnapshotSchema.parse(data)
}

// ─── Snapshot helpers ─────────────────────────────────────────────────────────

export function toRpaUserSnapshot(data: RpaStagedData): RpaUserSnapshot {
	return {
		users: data.users.map((u) => ({
			userObjectId: u.userObjectId,
			displayName: u.displayName,
			isGone: u.isGone,
			matchSource: u.matchSource,
			decision: u.decision,
		})),
	}
}

// ─── UI conversion ────────────────────────────────────────────────────────────

/** Convert RpaStagedData to the RpaMaintenanceData format expected by the component. */
export function toRpaMaintenanceData(data: RpaStagedData): RpaMaintenanceData {
	const users: RpaUserEntry[] = data.users.map((u) => ({
		userObjectId: u.userObjectId,
		displayName: u.displayName,
		userPrincipalName: u.userPrincipalName,
		accountEnabled: u.accountEnabled,
		rpaGroupName: u.rpaGroupName,
		// Zod superRefine guarantees active users (isGone=false) have matchSource set
		matchSource: u.isGone ? "removed" : u.matchSource!,
	}))

	const assessments: Record<string, RpaUserAssessmentEntry> = {}
	for (const u of data.users) {
		assessments[u.userObjectId] = {
			id: u.userObjectId,
			owner: u.owner,
			needComment: u.needComment,
			criticalityComment: u.criticalityComment,
			securityComment: u.securityComment,
			decision: u.decision,
			decisionDeadline: u.decisionDeadline,
		}
	}

	return { users, assessments }
}

/**
 * Build read-only RpaMaintenanceData from snapshotAfter for completed legacy activities
 * that lack staged_data.
 */
export function buildReadOnlyRpaData(snapshotAfter: unknown): RpaMaintenanceData | null {
	if (!snapshotAfter || typeof snapshotAfter !== "object") return null
	const snapshot = snapshotAfter as { users?: unknown[] }
	if (!Array.isArray(snapshot.users)) return null

	const users: RpaUserEntry[] = []
	const assessments: Record<string, RpaUserAssessmentEntry> = {}

	for (const u of snapshot.users) {
		if (!u || typeof u !== "object" || !("userObjectId" in u)) continue
		const user = u as Record<string, unknown>
		// Skip rows with missing/invalid userObjectId to avoid "undefined"/"null" in UI
		const rawUserObjectId = user.userObjectId
		if (typeof rawUserObjectId !== "string" || rawUserObjectId.trim() === "") continue
		const userObjectId = rawUserObjectId.trim()
		// Validate isGone as boolean (handle string "false", missing field, etc.)
		const isGone = user.isGone === true
		// Use matchSource from snapshot if available, otherwise derive from isGone
		const rawMatchSource = typeof user.matchSource === "string" ? user.matchSource : null
		const matchSource = isGone
			? "removed"
			: rawMatchSource === "nais" || rawMatchSource === "manual"
				? rawMatchSource
				: "manual"

		users.push({
			userObjectId,
			displayName: typeof user.displayName === "string" ? user.displayName : null,
			userPrincipalName: null,
			accountEnabled: null,
			rpaGroupName: null,
			matchSource,
		})

		// Validate decision against known values to avoid invalid legacy data flowing to UI
		const rawDecision = typeof user.decision === "string" ? user.decision : null
		const validDecision =
			rawDecision && RPA_DECISION_VALUES.includes(rawDecision as RpaDecision) ? (rawDecision as RpaDecision) : null

		assessments[userObjectId] = {
			id: userObjectId,
			owner: null,
			needComment: null,
			criticalityComment: null,
			securityComment: null,
			decision: validDecision,
			decisionDeadline: null,
		}
	}

	// Always return data (even if empty) so UI can render empty state
	return { users, assessments }
}

// ─── Patch ────────────────────────────────────────────────────────────────────

export function applyRpaStagedDataPatch(data: RpaStagedData, patch: RpaStagedDataPatch): RpaStagedData {
	const parsed = parseRpaStagedData(data)
	const userIndex = parsed.users.findIndex((u) => u.userObjectId === patch.userObjectId)

	if (userIndex === -1) {
		throw new Error(`Fant ikke bruker ${patch.userObjectId} i staged_data`)
	}

	if (patch.op === "set-assessment") {
		const existing = parsed.users[userIndex]
		const users = parsed.users.map((u) => ({ ...u }))

		// Resolve new decision and deadline (deadline cleared when decision changes to non-deadline type)
		const newDecision = patch.decision !== undefined ? patch.decision : existing.decision
		let newDeadline = patch.decisionDeadline !== undefined ? patch.decisionDeadline : existing.decisionDeadline
		if (newDecision !== "avvikles" && newDecision !== "endres") {
			newDeadline = null
		}

		users[userIndex] = {
			...existing,
			...(patch.owner !== undefined && { owner: patch.owner }),
			...(patch.needComment !== undefined && { needComment: patch.needComment }),
			...(patch.criticalityComment !== undefined && { criticalityComment: patch.criticalityComment }),
			...(patch.securityComment !== undefined && { securityComment: patch.securityComment }),
			decision: newDecision,
			decisionDeadline: newDeadline,
		}

		return parseRpaStagedData({ ...parsed, users })
	}

	// NOTE: Cannot use `patch satisfies never` exhaustiveness check here because
	// TypeScript cannot narrow single-variant discriminated unions to never.
	// This is a known TypeScript limitation. The throw below is unreachable in practice.
	throw new Error("Ukjent patch-operasjon")
}
