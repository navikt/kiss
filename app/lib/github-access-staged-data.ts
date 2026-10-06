import { z } from "zod"
import { normalizeGithubPermission, normalizeGithubUsername } from "./github-user-access"

export const GITHUB_ACCESS_STAGED_DATA_ACTIVITY_TYPE = "github_access_maintenance" as const
export const GITHUB_ACCESS_STAGED_DATA_SCHEMA_VERSION = 1 as const

export const githubAccessPermissionValues = ["admin", "maintain", "push", "write", "triage", "pull", "read"] as const
export type GithubAccessPermission = (typeof githubAccessPermissionValues)[number]

export type GithubAccessSubject = {
	username: string
	highestPermission: GithubAccessPermission | string
	directPermission: string | null
	viaTeams: Array<{ teamSlug: string; teamName: string; permission: string }>
	markedForRemoval: boolean
	removalMarkedBy: string | null
	removalMarkedAt: string | null
	permissionAdjustmentRequested: boolean
	targetPermission: string | null
	permissionAdjustmentMarkedBy: string | null
	permissionAdjustmentMarkedAt: string | null
}

export type GithubAccessStagedData = {
	activityType: typeof GITHUB_ACCESS_STAGED_DATA_ACTIVITY_TYPE
	schemaVersion: typeof GITHUB_ACCESS_STAGED_DATA_SCHEMA_VERSION
	seededAt: string
	dataSyncedAt: string | null
	gitRepository: string
	subjects: GithubAccessSubject[]
	confirmedBy: string | null
	confirmedAt: string | null
}

export type GithubAccessSnapshot = {
	type: typeof GITHUB_ACCESS_STAGED_DATA_ACTIVITY_TYPE
	schemaVersion: typeof GITHUB_ACCESS_STAGED_DATA_SCHEMA_VERSION
	gitRepository: string
	subjects: Array<{
		username: string
		highestPermission: string
		markedForRemoval: boolean
		removalMarkedBy: string | null
		removalMarkedAt: string | null
		permissionAdjustmentRequested: boolean
		targetPermission: string | null
		permissionAdjustmentMarkedBy: string | null
		permissionAdjustmentMarkedAt: string | null
	}>
	confirmedBy: string | null
	confirmedAt: string | null
}

export type GithubAccessStagedDataPatch =
	| {
			op: "mark-for-removal"
			username: string
			markedBy: string
			markedAt: string
	  }
	| {
			op: "unmark-for-removal"
			username: string
	  }
	| {
			op: "mark-for-adjustment"
			username: string
			targetPermission: string
			markedBy: string
			markedAt: string
	  }
	| {
			op: "unmark-for-adjustment"
			username: string
	  }
	| {
			op: "confirm-review"
			confirmedBy: string
			confirmedAt: string
	  }
	| {
			op: "unconfirm-review"
	  }

const dateOnlySchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/)
	.nullable()

const githubAccessSubjectSchema = z
	.object({
		username: z.string().min(1),
		highestPermission: z.string().min(1),
		directPermission: z.string().min(1).nullable(),
		viaTeams: z.array(
			z.object({
				teamSlug: z.string().min(1),
				teamName: z.string().min(1),
				permission: z.string().min(1),
			}),
		),
		markedForRemoval: z.boolean(),
		removalMarkedBy: z.string().min(1).nullable(),
		removalMarkedAt: dateOnlySchema,
		permissionAdjustmentRequested: z.boolean(),
		targetPermission: z.enum(githubAccessPermissionValues).nullable(),
		permissionAdjustmentMarkedBy: z.string().min(1).nullable(),
		permissionAdjustmentMarkedAt: dateOnlySchema,
	})
	.superRefine((subject, ctx) => {
		if (subject.permissionAdjustmentRequested && !subject.targetPermission?.trim()) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "targetPermission er påkrevd når permissionAdjustmentRequested er true",
				path: ["targetPermission"],
			})
		}
		if (subject.markedForRemoval && subject.permissionAdjustmentRequested) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "En person kan ikke være både markert for fjerning og for tilgangsjustering samtidig",
				path: ["permissionAdjustmentRequested"],
			})
		}
	})

export const githubAccessStagedDataSchema = z
	.object({
		activityType: z.literal(GITHUB_ACCESS_STAGED_DATA_ACTIVITY_TYPE),
		schemaVersion: z.literal(GITHUB_ACCESS_STAGED_DATA_SCHEMA_VERSION),
		seededAt: z.string().datetime(),
		dataSyncedAt: z.string().datetime().nullable(),
		gitRepository: z.string().min(1),
		subjects: z.array(githubAccessSubjectSchema),
		confirmedBy: z.string().min(1).nullable(),
		confirmedAt: z.string().datetime().nullable(),
	})
	.superRefine((data, ctx) => {
		const seen = new Set<string>()
		for (const [index, subject] of data.subjects.entries()) {
			const key = normalizeGithubUsername(subject.username)
			if (seen.has(key)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: `Duplicate username: ${subject.username}`,
					path: ["subjects", index, "username"],
				})
			}
			seen.add(key)
		}
	})

export function parseGithubAccessStagedData(data: unknown): GithubAccessStagedData {
	return githubAccessStagedDataSchema.parse(data)
}

export function isGithubAccessReviewComplete(data: GithubAccessStagedData): boolean {
	return data.confirmedAt !== null
}

export function toGithubAccessSnapshot(data: GithubAccessStagedData): GithubAccessSnapshot {
	return {
		type: GITHUB_ACCESS_STAGED_DATA_ACTIVITY_TYPE,
		schemaVersion: GITHUB_ACCESS_STAGED_DATA_SCHEMA_VERSION,
		gitRepository: data.gitRepository,
		subjects: data.subjects.map((subject) => ({
			username: subject.username,
			highestPermission: subject.highestPermission,
			markedForRemoval: subject.markedForRemoval,
			removalMarkedBy: subject.removalMarkedBy,
			removalMarkedAt: subject.removalMarkedAt,
			permissionAdjustmentRequested: subject.permissionAdjustmentRequested,
			targetPermission: subject.targetPermission,
			permissionAdjustmentMarkedBy: subject.permissionAdjustmentMarkedBy,
			permissionAdjustmentMarkedAt: subject.permissionAdjustmentMarkedAt,
		})),
		confirmedBy: data.confirmedBy,
		confirmedAt: data.confirmedAt,
	}
}

export function applyGithubAccessStagedDataPatch(
	data: GithubAccessStagedData,
	patch: GithubAccessStagedDataPatch,
): GithubAccessStagedData {
	const parsed = parseGithubAccessStagedData(data)

	if (patch.op === "confirm-review") {
		return parseGithubAccessStagedData({
			...parsed,
			confirmedBy: patch.confirmedBy,
			confirmedAt: patch.confirmedAt,
		})
	}

	if (patch.op === "unconfirm-review") {
		return parseGithubAccessStagedData({ ...parsed, confirmedBy: null, confirmedAt: null })
	}

	const subjects = parsed.subjects.map((subject) => ({ ...subject }))
	const index = subjects.findIndex(
		(subject) => normalizeGithubUsername(subject.username) === normalizeGithubUsername(patch.username),
	)
	if (index === -1) {
		throw new Error(`Fant ikke GitHub-bruker ${patch.username}`)
	}
	const existing = subjects[index]

	if (patch.op === "mark-for-removal") {
		subjects[index] = {
			...existing,
			markedForRemoval: true,
			removalMarkedBy: patch.markedBy,
			removalMarkedAt: patch.markedAt,
			permissionAdjustmentRequested: false,
			targetPermission: null,
			permissionAdjustmentMarkedBy: null,
			permissionAdjustmentMarkedAt: null,
		}
		return parseGithubAccessStagedData({ ...parsed, subjects })
	}

	if (patch.op === "unmark-for-removal") {
		subjects[index] = {
			...existing,
			markedForRemoval: false,
			removalMarkedBy: null,
			removalMarkedAt: null,
		}
		const shouldClearConfirmation = existing.markedForRemoval
		return parseGithubAccessStagedData({
			...parsed,
			subjects,
			...(shouldClearConfirmation && { confirmedBy: null, confirmedAt: null }),
		})
	}

	if (patch.op === "mark-for-adjustment") {
		if (normalizeGithubPermission(patch.targetPermission) === normalizeGithubPermission(existing.highestPermission)) {
			throw new Error(
				`Målnivået "${patch.targetPermission}" er det samme som gjeldende tilgangsnivå for ${patch.username}`,
			)
		}
		subjects[index] = {
			...existing,
			permissionAdjustmentRequested: true,
			targetPermission: patch.targetPermission,
			permissionAdjustmentMarkedBy: patch.markedBy,
			permissionAdjustmentMarkedAt: patch.markedAt,
			markedForRemoval: false,
			removalMarkedBy: null,
			removalMarkedAt: null,
		}
		return parseGithubAccessStagedData({ ...parsed, subjects })
	}

	if (patch.op === "unmark-for-adjustment") {
		subjects[index] = {
			...existing,
			permissionAdjustmentRequested: false,
			targetPermission: null,
			permissionAdjustmentMarkedBy: null,
			permissionAdjustmentMarkedAt: null,
		}
		const shouldClearConfirmation = existing.permissionAdjustmentRequested
		return parseGithubAccessStagedData({
			...parsed,
			subjects,
			...(shouldClearConfirmation && { confirmedBy: null, confirmedAt: null }),
		})
	}

	patch satisfies never
	throw new Error("Ukjent patch-operasjon")
}
