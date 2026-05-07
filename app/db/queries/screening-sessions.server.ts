import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import type { NavUser } from "~/lib/auth.server"
import { db } from "../connection.server"
import {
	screeningAnswers,
	screeningSessionAnswers,
	screeningSessionOperations,
	screeningSessionParticipants,
	screeningSessions,
} from "../schema/screening"
import { writeAuditLog } from "./audit.server"

// ─── State Snapshot ──────────────────────────────────────────────────────

/** Captures the current application state (persistence, groups, oracle roles, economy) as a snapshot for a screening session. */
export async function captureStateSnapshot(appId: string, userGroups: string[] = []) {
	const [{ getAppPersistence, getManualGroupsForApp, getGroupAssessmentsForApp, getApplicationDetail }] =
		await Promise.all([import("~/db/queries/nais.server")])

	const [persistenceRaw, manualGroups, groupAssessments, appDetail] = await Promise.all([
		getAppPersistence(appId),
		getManualGroupsForApp(appId),
		getGroupAssessmentsForApp(appId),
		getApplicationDetail(appId),
	])

	// Persistence
	const persistence = persistenceRaw.map((p) => ({
		id: p.id,
		type: p.type,
		name: p.name,
		dataClassification: p.dataClassification,
		manuallyAdded: p.manuallyAdded,
	}))

	// Entra ID groups
	const naisGroupIds: string[] = []
	if (appDetail) {
		for (const auth of appDetail.authIntegrations) {
			if (auth.groups) {
				const groups = JSON.parse(auth.groups) as string[]
				naisGroupIds.push(...groups)
			}
		}
	}
	const naisGroupIdSet = new Set(naisGroupIds)
	const manualGroupIdSet = new Set(manualGroups.map((g) => g.groupId))
	const ghostGroupIds = groupAssessments
		.filter((a) => !naisGroupIdSet.has(a.groupId) && !manualGroupIdSet.has(a.groupId))
		.map((a) => a.groupId)
	const allGroupIds = [...new Set([...naisGroupIds, ...manualGroups.map((g) => g.groupId), ...ghostGroupIds])]

	const { resolveGroupNames } = await import("~/lib/graph.server")
	const groupNames = await resolveGroupNames(allGroupIds)

	const assessmentsByGroupId: Record<string, { criticality: string; updatedBy: string; updatedAt: string }> = {}
	for (const a of groupAssessments) {
		assessmentsByGroupId[a.groupId] = {
			criticality: a.criticality,
			updatedBy: a.updatedBy,
			updatedAt: a.updatedAt.toISOString(),
		}
	}
	const entraGroupsData = {
		naisGroupIds,
		manualGroups: manualGroups.map((g) => ({ ...g, createdAt: g.createdAt.toISOString() })),
		ghostGroupIds,
		groupNames,
		assessmentsByGroupId,
	}

	// Oracle roles
	let oracleRolesData: {
		roles: Array<{ instanceId: string; roleName: string; authType: string | null; common: boolean | null }>
		assessments: Record<string, { criticality: string; updatedBy: string; updatedAt: string }>
	} = { roles: [], assessments: {} }

	try {
		const { getOracleInstancesForApp } = await import("~/db/queries/audit-evidence.server")
		const { getOracleRoles, getOracleInstances, shouldAssessRole } = await import("~/lib/oracle-revisjon.server")
		const { filterInstancesByAccess } = await import("~/lib/oracle-access.server")
		const { getOracleRoleAssessments } = await import("~/db/queries/oracle-roles.server")

		const allInstances = await getOracleInstances()
		const instanceGroupMap = new Map(allInstances.map((i) => [i.id, i]))

		const appInstances = await getOracleInstancesForApp(appId)
		const filteredInstances = filterInstancesByAccess(
			appInstances
				.filter((inst) => instanceGroupMap.has(inst.instanceId))
				.map((inst) => ({ ...inst, group: instanceGroupMap.get(inst.instanceId)?.group ?? null })),
			userGroups,
		)

		const roleResults = await Promise.allSettled(filteredInstances.map((inst) => getOracleRoles(inst.instanceId)))

		const allRoles: typeof oracleRolesData.roles = []
		for (let i = 0; i < filteredInstances.length; i++) {
			const result = roleResults[i]
			if (result.status === "fulfilled" && result.value) {
				for (const role of result.value.roles) {
					if (!shouldAssessRole(role)) continue
					allRoles.push({
						instanceId: filteredInstances[i].instanceId,
						roleName: role.name,
						authType: role.authType ?? null,
						common: role.common ?? null,
					})
				}
			}
		}

		const allAssessments = await getOracleRoleAssessments(appId)
		const accessibleInstanceIds = new Set(filteredInstances.map((inst) => inst.instanceId))
		const assessments: typeof allAssessments = {}
		for (const [key, value] of Object.entries(allAssessments)) {
			const instanceId = key.split(":")[0]
			if (accessibleInstanceIds.has(instanceId)) {
				assessments[key] = value
			}
		}
		oracleRolesData = { roles: allRoles, assessments }
	} catch {
		// Oracle roles are optional — if fetching fails, snapshot with empty data
	}

	// Economy classification
	let economyClassification: {
		id: string
		isEconomySystem: boolean
		economySystemType: string | null
		justification: string
		validFrom: string
		validUntil: string
		isExpired: boolean
	} | null = null

	try {
		const { getEconomyClassification } = await import("~/db/queries/economy-classification.server")
		const existing = await getEconomyClassification(appId)
		if (existing) {
			economyClassification = {
				id: existing.id,
				isEconomySystem: existing.isEconomySystem,
				economySystemType: existing.economySystemType,
				justification: existing.justification,
				validFrom: existing.validFrom.toISOString(),
				validUntil: existing.validUntil.toISOString(),
				isExpired: existing.validUntil < new Date(),
			}
		}
	} catch {
		// Economy classification is optional
	}

	return {
		persistence,
		entraGroupsData,
		oracleRolesData,
		economyClassification,
		capturedAt: new Date().toISOString(),
	}
}

// ─── Create ──────────────────────────────────────────────────────────────

export async function createScreeningSession(params: {
	applicationId: string
	title: string
	participants: Array<{ userIdent: string; userName: string | null }>
	stateSnapshot?: Record<string, unknown>
	performedBy: string
}) {
	return db.transaction(async (tx) => {
		const [session] = await tx
			.insert(screeningSessions)
			.values({
				applicationId: params.applicationId,
				title: params.title,
				stateSnapshot: params.stateSnapshot ?? null,
				createdBy: params.performedBy,
				updatedBy: params.performedBy,
			})
			.returning()

		if (params.participants.length > 0) {
			await tx.insert(screeningSessionParticipants).values(
				params.participants.map((p) => ({
					sessionId: session.id,
					userIdent: p.userIdent,
					userName: p.userName,
				})),
			)
		}

		await writeAuditLog(
			{
				action: "screening_session_created",
				entityType: "screening_session",
				entityId: session.id,
				newValue: JSON.stringify({ title: params.title, participants: params.participants }),
				performedBy: params.performedBy,
			},
			tx,
		)

		return session
	})
}

// ─── Read ────────────────────────────────────────────────────────────────

export async function getScreeningSession(sessionId: string) {
	const [session] = await db
		.select()
		.from(screeningSessions)
		.where(and(eq(screeningSessions.id, sessionId), isNull(screeningSessions.archivedAt)))
		.limit(1)

	if (!session) return null

	const participants = await db
		.select()
		.from(screeningSessionParticipants)
		.where(and(eq(screeningSessionParticipants.sessionId, sessionId), isNull(screeningSessionParticipants.archivedAt)))

	const answers = await db
		.select()
		.from(screeningSessionAnswers)
		.where(eq(screeningSessionAnswers.sessionId, sessionId))

	return { ...session, participants, answers }
}

export async function getScreeningSessionsForApp(applicationId: string) {
	const sessions = await db
		.select()
		.from(screeningSessions)
		.where(and(eq(screeningSessions.applicationId, applicationId), isNull(screeningSessions.archivedAt)))
		.orderBy(desc(screeningSessions.createdAt))

	const sessionIds = sessions.map((s) => s.id)
	if (sessionIds.length === 0) return []

	const allParticipants = await db
		.select()
		.from(screeningSessionParticipants)
		.where(
			and(inArray(screeningSessionParticipants.sessionId, sessionIds), isNull(screeningSessionParticipants.archivedAt)),
		)

	const participantsBySession = new Map<string, typeof allParticipants>()
	for (const p of allParticipants) {
		const list = participantsBySession.get(p.sessionId) ?? []
		list.push(p)
		participantsBySession.set(p.sessionId, list)
	}

	return sessions.map((session) => ({
		...session,
		participants: participantsBySession.get(session.id) ?? [],
	}))
}

// ─── Save Answer ─────────────────────────────────────────────────────────

export async function saveScreeningSessionAnswer(params: {
	sessionId: string
	questionId: string
	answer: string | null
	comment: string | null
	link: string | null
	performedBy: string
}) {
	await db.transaction(async (tx) => {
		// Verify session exists and is not completed (within transaction for consistency)
		const [session] = await tx
			.select({ status: screeningSessions.status })
			.from(screeningSessions)
			.where(and(eq(screeningSessions.id, params.sessionId), isNull(screeningSessions.archivedAt)))
			.limit(1)

		if (!session) throw new Error("Screening-sesjon ikke funnet")
		if (session.status === "completed") throw new Error("Kan ikke endre svar i fullført screening")

		await tx
			.insert(screeningSessionAnswers)
			.values({
				sessionId: params.sessionId,
				questionId: params.questionId,
				answer: params.answer,
				comment: params.comment,
				link: params.link,
				answeredBy: params.performedBy,
			})
			.onConflictDoUpdate({
				target: [screeningSessionAnswers.sessionId, screeningSessionAnswers.questionId],
				set: {
					answer: params.answer,
					comment: params.comment,
					link: params.link,
					answeredBy: params.performedBy,
					answeredAt: new Date(),
				},
			})

		await writeAuditLog(
			{
				action: "screening_answer_saved",
				entityType: "screening_session_answer",
				entityId: `${params.sessionId}/${params.questionId}`,
				newValue: JSON.stringify({ questionId: params.questionId, answer: params.answer }),
				performedBy: params.performedBy,
			},
			tx,
		)
	})
}

// ─── Staged Operations ───────────────────────────────────────────────────

export async function stageOperation(params: {
	sessionId: string
	intent: string
	payload: Record<string, unknown>
	performedBy: string
}) {
	// Economy classification uses a partial unique index — upsert to update existing row
	if (params.intent === "save-economy-classification") {
		const result = await db.execute(sql`
			INSERT INTO screening_session_operations (session_id, intent, payload, performed_by)
			VALUES (${params.sessionId}, ${params.intent}, ${JSON.stringify(params.payload)}::jsonb, ${params.performedBy})
			ON CONFLICT (session_id) WHERE intent = 'save-economy-classification'
			DO UPDATE SET
				payload = EXCLUDED.payload,
				performed_by = EXCLUDED.performed_by,
				created_at = now()
			RETURNING *
		`)
		return result.rows[0]
	}

	const [op] = await db
		.insert(screeningSessionOperations)
		.values({
			sessionId: params.sessionId,
			intent: params.intent,
			payload: params.payload,
			performedBy: params.performedBy,
		})
		.returning()
	return op
}

export async function getStagedOperations(sessionId: string) {
	return db
		.select()
		.from(screeningSessionOperations)
		.where(eq(screeningSessionOperations.sessionId, sessionId))
		.orderBy(asc(screeningSessionOperations.createdAt))
}

// ─── Complete ────────────────────────────────────────────────────────────

/** Complete a screening session: replays staged operations, copies answers, and marks session as completed. */
export async function completeScreeningSession(sessionId: string, authedUser: NavUser) {
	const performedBy = authedUser.navIdent

	// Get staged operations before transaction (they need to be replayed outside the tx
	// since handleComplianceIntent does its own DB writes)
	const stagedOps = await db
		.select()
		.from(screeningSessionOperations)
		.where(eq(screeningSessionOperations.sessionId, sessionId))
		.orderBy(asc(screeningSessionOperations.createdAt))

	// Replay staged operations
	if (stagedOps.length > 0) {
		const { handleComplianceIntent } = await import(
			"~/routes/applikasjoner.$appId.screening.$sessionId/compliance-intents.server"
		)

		// Get session to find applicationId
		const [session] = await db
			.select()
			.from(screeningSessions)
			.where(and(eq(screeningSessions.id, sessionId), isNull(screeningSessions.archivedAt)))
			.limit(1)
		if (!session) throw new Error("Screening-sesjon ikke funnet")
		if (session.status === "completed") throw new Error("Screening-sesjon er allerede fullført")

		for (const op of stagedOps) {
			const formData = new FormData()
			const payload = op.payload as Record<string, string>
			for (const [key, value] of Object.entries(payload)) {
				if (value != null) formData.set(key, String(value))
			}
			try {
				await handleComplianceIntent(op.intent, formData, session.applicationId, authedUser)
			} catch (err) {
				if (err instanceof Response) {
					const body = await err.text().catch(() => "ukjent feil")
					throw new Error(
						`Kunne ikke fullføre screening: operasjonen «${op.intent}» feilet med status ${err.status}: ${body}`,
					)
				}
				throw err
			}
		}
	}

	return db.transaction(async (tx) => {
		// Get session
		const [session] = await tx
			.select()
			.from(screeningSessions)
			.where(and(eq(screeningSessions.id, sessionId), isNull(screeningSessions.archivedAt)))
			.limit(1)

		if (!session) throw new Error("Screening-sesjon ikke funnet")
		if (session.status === "completed") throw new Error("Screening-sesjon er allerede fullført")

		// Get session answers
		const sessionAnswers = await tx
			.select()
			.from(screeningSessionAnswers)
			.where(eq(screeningSessionAnswers.sessionId, sessionId))

		// Copy answers to active screening_answers (batch upsert)
		if (sessionAnswers.length > 0) {
			await tx
				.insert(screeningAnswers)
				.values(
					sessionAnswers.map((answer) => ({
						applicationId: session.applicationId,
						questionId: answer.questionId,
						answer: answer.answer,
						comment: answer.comment,
						link: answer.link,
						answeredBy: answer.answeredBy,
						answeredAt: answer.answeredAt,
					})),
				)
				.onConflictDoUpdate({
					target: [screeningAnswers.applicationId, screeningAnswers.questionId],
					set: {
						answer: sql`excluded.answer`,
						comment: sql`excluded.comment`,
						link: sql`excluded.link`,
						answeredBy: sql`excluded.answered_by`,
						answeredAt: sql`excluded.answered_at`,
					},
				})
		}

		// Mark session as completed
		const [updated] = await tx
			.update(screeningSessions)
			.set({
				status: "completed",
				completedAt: new Date(),
				completedBy: performedBy,
				updatedAt: new Date(),
				updatedBy: performedBy,
			})
			.where(eq(screeningSessions.id, sessionId))
			.returning()

		await writeAuditLog(
			{
				action: "screening_session_completed",
				entityType: "screening_session",
				entityId: sessionId,
				metadata: { answersCount: sessionAnswers.length, stagedOpsCount: stagedOps.length },
				performedBy,
			},
			tx,
		)

		return updated
	})
}

// ─── Archive (Delete) ────────────────────────────────────────────────────

export async function archiveScreeningSession(sessionId: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [archived] = await tx
			.update(screeningSessions)
			.set({
				archivedAt: new Date(),
				archivedBy: performedBy,
				updatedAt: new Date(),
				updatedBy: performedBy,
			})
			.where(and(eq(screeningSessions.id, sessionId), isNull(screeningSessions.archivedAt)))
			.returning()

		if (archived) {
			await writeAuditLog(
				{
					action: "screening_session_archived",
					entityType: "screening_session",
					entityId: sessionId,
					performedBy,
				},
				tx,
			)
		}

		return archived ?? null
	})
}

// ─── Update Participants ─────────────────────────────────────────────────

export async function updateScreeningSessionParticipants(
	sessionId: string,
	participants: Array<{ userIdent: string; userName: string | null }>,
	performedBy: string,
) {
	await db.transaction(async (tx) => {
		// Verify session exists and is editable
		const [session] = await tx
			.select()
			.from(screeningSessions)
			.where(and(eq(screeningSessions.id, sessionId), isNull(screeningSessions.archivedAt)))
			.limit(1)

		if (!session) throw new Error("Screening-sesjon ikke funnet")
		if (session.status === "completed") throw new Error("Kan ikke endre deltakere på en fullført sesjon")

		// Get existing active participants
		const existing = await tx
			.select()
			.from(screeningSessionParticipants)
			.where(
				and(eq(screeningSessionParticipants.sessionId, sessionId), isNull(screeningSessionParticipants.archivedAt)),
			)

		const existingIdents = new Set(existing.map((p) => p.userIdent))
		const newIdents = new Set(participants.map((p) => p.userIdent))

		// Archive removed participants
		const toRemove = existing.filter((p) => !newIdents.has(p.userIdent))
		for (const p of toRemove) {
			await tx
				.update(screeningSessionParticipants)
				.set({ archivedAt: new Date(), archivedBy: performedBy })
				.where(eq(screeningSessionParticipants.id, p.id))

			await writeAuditLog(
				{
					action: "screening_session_participant_removed",
					entityType: "screening_session",
					entityId: sessionId,
					previousValue: JSON.stringify({ userIdent: p.userIdent, userName: p.userName }),
					performedBy,
				},
				tx,
			)
		}

		// Add new participants
		const toAdd = participants.filter((p) => !existingIdents.has(p.userIdent))
		for (const p of toAdd) {
			const [inserted] = await tx
				.insert(screeningSessionParticipants)
				.values({
					sessionId,
					userIdent: p.userIdent,
					userName: p.userName,
				})
				.onConflictDoNothing()
				.returning({ id: screeningSessionParticipants.id })

			if (inserted) {
				await writeAuditLog(
					{
						action: "screening_session_participant_added",
						entityType: "screening_session",
						entityId: sessionId,
						newValue: JSON.stringify({ userIdent: p.userIdent, userName: p.userName }),
						performedBy,
					},
					tx,
				)
			}
		}
	})
}
