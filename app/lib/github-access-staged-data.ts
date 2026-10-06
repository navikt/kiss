import { z } from "zod"

export const GITHUB_ACCESS_STAGED_DATA_ACTIVITY_TYPE = "github_access_maintenance" as const
export const GITHUB_ACCESS_STAGED_DATA_SCHEMA_VERSION = 1 as const

export const githubAccessPermissionValues = ["admin", "maintain", "push", "write", "triage", "pull", "read"] as const
export type GithubAccessPermission = (typeof githubAccessPermissionValues)[number]

/**
 * Én person med tilgang til repoet, flatet ut fra direkte collaborator-tilgang
 * og/eller medlemskap i ett eller flere GitHub-team (som igjen kan være synket
 * fra en Entra ID-gruppe av GitHub selv — medlemmene under er alltid de
 * konkrete personene, ikke bare team-/gruppenavnet).
 */
export type GithubAccessSubject = {
	username: string
	highestPermission: GithubAccessPermission | string
	directPermission: string | null
	viaTeams: Array<{ teamSlug: string; teamName: string; permission: string }>
	/** Fantes ikke i forrige gjennomgang (ny person eller ny tilgangsvei siden sist). */
	isNew: boolean
	/** Hadde tilgang ved forrige gjennomgang, men er ikke lenger å finne på GitHub. */
	isGone: boolean
	/**
	 * Reviewer har besluttet at tilgangen skal fjernes i løpet av DENNE gjennomgangen (i motsetning
	 * til `isGone`, som betyr at personen allerede var borte fra GitHub da rutinen ble startet).
	 * Ved fullføring av aktiviteten opprettes automatisk et preutfylt oppfølgingspunkt på
	 * rutinegjennomgangen — se `commitGithubAccessActivity`. KISS bekrefter ikke lenger fjerningen
	 * mot GitHub; det spores og følges opp via oppfølgingspunktet. Gjensidig utelukkende med
	 * tilgangsjustering.
	 */
	markedForRemoval: boolean
	removalMarkedBy: string | null
	/** Dato (YYYY-MM-DD) markeringen ble gjort. */
	removalMarkedAt: string | null
	/**
	 * Reviewer har besluttet at tilgangsnivået skal justeres (f.eks. fra admin til push) fordi
	 * arbeidsoppgavene har endret seg — i motsetning til fjerning betyr dette at personen fortsatt
	 * skal ha tilgang, bare på et annet nivå. Ved fullføring av aktiviteten opprettes automatisk et
	 * preutfylt oppfølgingspunkt på rutinegjennomgangen — se `commitGithubAccessActivity`. KISS
	 * bekrefter ikke lenger det nye tilgangsnivået mot GitHub; det spores og følges opp via
	 * oppfølgingspunktet. Gjensidig utelukkende med `markedForRemoval`.
	 */
	permissionAdjustmentRequested: boolean
	/** Obligatorisk når permissionAdjustmentRequested er true. */
	targetPermission: string | null
	permissionAdjustmentMarkedBy: string | null
	/** Dato (YYYY-MM-DD) markeringen ble gjort. */
	permissionAdjustmentMarkedAt: string | null
}

export type GithubAccessStagedData = {
	activityType: typeof GITHUB_ACCESS_STAGED_DATA_ACTIVITY_TYPE
	schemaVersion: typeof GITHUB_ACCESS_STAGED_DATA_SCHEMA_VERSION
	seededAt: string
	/** Tidspunktet for siste vellykkede synkronisering av Github-data (teams/medlemmer/collaborators)
	 *  for dette repoet, forut for at gjennomgangen ble startet. Null dersom ukjent (f.eks. eldre data
	 *  seedet før dette feltet ble innført). */
	dataSyncedAt: string | null
	gitRepository: string
	subjects: GithubAccessSubject[]
	/**
	 * Settes når reviewer bekrefter at HELE listen er gjennomgått — én samlet bekreftelse for
	 * gjennomgangen i stedet for separat godkjenning per person. Overskrives ved ny bekreftelse
	 * (f.eks. etter at en person er merket for fjerning/justering).
	 */
	confirmedBy: string | null
	confirmedAt: string | null
}

export type GithubAccessSnapshot = {
	gitRepository: string
	subjects: Array<{
		username: string
		highestPermission: string
		isGone: boolean
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
		isNew: z.boolean(),
		isGone: z.boolean(),
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
			if (seen.has(subject.username)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: `Duplicate username: ${subject.username}`,
					path: ["subjects", index, "username"],
				})
			}
			seen.add(subject.username)
		}
	})

export function parseGithubAccessStagedData(data: unknown): GithubAccessStagedData {
	return githubAccessStagedDataSchema.parse(data)
}

/** Fullføringskriterium: reviewer har bekreftet at HELE listen er gjennomgått. */
export function isGithubAccessReviewComplete(data: GithubAccessStagedData): boolean {
	return data.confirmedAt !== null
}

export function toGithubAccessSnapshot(data: GithubAccessStagedData): GithubAccessSnapshot {
	return {
		gitRepository: data.gitRepository,
		subjects: data.subjects.map((subject) => ({
			username: subject.username,
			highestPermission: subject.highestPermission,
			isGone: subject.isGone,
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
	const index = subjects.findIndex((subject) => subject.username === patch.username)
	if (index === -1) {
		throw new Error(`Fant ikke GitHub-bruker ${patch.username}`)
	}
	const existing = subjects[index]

	if (patch.op === "mark-for-removal") {
		if (existing.isGone) {
			throw new Error(`Kan ikke markere en allerede fjernet bruker ${patch.username} for fjerning`)
		}
		subjects[index] = {
			...existing,
			markedForRemoval: true,
			removalMarkedBy: patch.markedBy,
			removalMarkedAt: patch.markedAt,
			// Gjensidig utelukkende med tilgangsjustering.
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
		// Angring etter at listen er bekreftet gjenåpner personen for aktiv tilgang uten at
		// reviewer har sett denne konkrete tilstanden — krev ny bekreftelse av hele listen.
		return parseGithubAccessStagedData({ ...parsed, subjects, confirmedBy: null, confirmedAt: null })
	}

	if (patch.op === "mark-for-adjustment") {
		if (existing.isGone) {
			throw new Error(`Kan ikke markere en allerede fjernet bruker ${patch.username} for tilgangsjustering`)
		}
		subjects[index] = {
			...existing,
			permissionAdjustmentRequested: true,
			targetPermission: patch.targetPermission,
			permissionAdjustmentMarkedBy: patch.markedBy,
			permissionAdjustmentMarkedAt: patch.markedAt,
			// Gjensidig utelukkende med fjerning.
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
		// Angring etter at listen er bekreftet gjenåpner personen for aktiv tilgang uten at
		// reviewer har sett denne konkrete tilstanden — krev ny bekreftelse av hele listen.
		return parseGithubAccessStagedData({ ...parsed, subjects, confirmedBy: null, confirmedAt: null })
	}

	patch satisfies never
	throw new Error("Ukjent patch-operasjon")
}
