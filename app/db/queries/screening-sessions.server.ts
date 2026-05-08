import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import type { NavUser } from "~/lib/auth.server"
import { logger } from "../../lib/logger.server"
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

/** Like getScreeningSession but includes archived sessions (for admin ownership checks). */
export async function getScreeningSessionForAdmin(sessionId: string) {
	const [session] = await db.select().from(screeningSessions).where(eq(screeningSessions.id, sessionId)).limit(1)
	return session ?? null
}

export async function getScreeningSessionsForApp(applicationId: string, includeArchived = false) {
	const conditions = [eq(screeningSessions.applicationId, applicationId)]
	if (!includeArchived) {
		conditions.push(isNull(screeningSessions.archivedAt))
	}

	const sessions = await db
		.select()
		.from(screeningSessions)
		.where(and(...conditions))
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
		// Verify session exists and is not completed (lock row to prevent race with completion)
		const [session] = await tx
			.select({ status: screeningSessions.status })
			.from(screeningSessions)
			.where(and(eq(screeningSessions.id, params.sessionId), isNull(screeningSessions.archivedAt)))
			.for("update")
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
	return db.transaction(async (tx) => {
		// Verify session is still editable (guards against TOCTOU race with completion)
		const [session] = await tx
			.select({ status: screeningSessions.status })
			.from(screeningSessions)
			.where(and(eq(screeningSessions.id, params.sessionId), isNull(screeningSessions.archivedAt)))
			.for("update")
			.limit(1)

		if (!session) throw new Error("Screening-sesjon ikke funnet")
		if (session.status !== "draft") throw new Error("Kan ikke endre data i en fullført screening-sesjon")

		// Economy classification uses a partial unique index — upsert to update existing row
		if (params.intent === "save-economy-classification") {
			const result = await tx.execute(sql`
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

		const [op] = await tx
			.insert(screeningSessionOperations)
			.values({
				sessionId: params.sessionId,
				intent: params.intent,
				payload: params.payload,
				performedBy: params.performedBy,
			})
			.returning()
		return op
	})
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

	// Acquire advisory lock to prevent concurrent completion attempts
	const { withAdvisoryLock } = await import("~/lib/lock.server")
	const result = await withAdvisoryLock(`screening-complete-${sessionId}`, async () => {
		// Mark session as completed early to freeze concurrent writes.
		// saveScreeningSessionAnswer checks status in its transaction,
		// stageOperation uses FOR UPDATE lock + status check.
		const [frozen] = await db
			.update(screeningSessions)
			.set({
				status: "completed",
				completedAt: new Date(),
				completedBy: performedBy,
				updatedAt: new Date(),
				updatedBy: performedBy,
			})
			.where(
				and(
					eq(screeningSessions.id, sessionId),
					eq(screeningSessions.status, "draft"),
					isNull(screeningSessions.archivedAt),
				),
			)
			.returning()

		if (!frozen) throw new Error("Screening-sesjon ikke funnet eller er allerede fullført")

		try {
			// Get unreplayed staged operations (skip already-replayed ops on retry)
			const stagedOps = await db
				.select()
				.from(screeningSessionOperations)
				.where(and(eq(screeningSessionOperations.sessionId, sessionId), isNull(screeningSessionOperations.replayedAt)))
				.orderBy(asc(screeningSessionOperations.createdAt))

			// Pre-populate stagedIdMap from already-replayed add ops (for retry scenarios)
			const stagedIdMap = new Map<string, string>()
			const replayedAddOps = await db
				.select()
				.from(screeningSessionOperations)
				.where(
					and(
						eq(screeningSessionOperations.sessionId, sessionId),
						isNotNull(screeningSessionOperations.replayedAt),
						sql`${screeningSessionOperations.intent} IN ('add-persistence', 'add-manual-group')`,
					),
				)
			for (const op of replayedAddOps) {
				const payload = op.payload as Record<string, string>
				if (op.intent === "add-persistence") {
					const type = payload.persistenceType
					const name = payload.persistenceName
					if (type && name) {
						const { applicationPersistence } = await import("~/db/schema/applications")
						const [found] = await db
							.select({ id: applicationPersistence.id })
							.from(applicationPersistence)
							.where(
								and(
									eq(applicationPersistence.applicationId, frozen.applicationId),
									eq(applicationPersistence.type, type as (typeof applicationPersistence.type.enumValues)[number]),
									eq(applicationPersistence.name, name),
								),
							)
							.orderBy(sql`${applicationPersistence.archivedAt} NULLS FIRST`)
							.limit(1)
						if (found) stagedIdMap.set(`staged-${op.id}`, found.id)
					}
				}
				if (op.intent === "add-manual-group") {
					const groupId = payload.groupId
					if (groupId) {
						const { applicationManualGroups } = await import("~/db/schema/applications")
						const [found] = await db
							.select({ id: applicationManualGroups.id })
							.from(applicationManualGroups)
							.where(
								and(
									eq(applicationManualGroups.applicationId, frozen.applicationId),
									eq(applicationManualGroups.groupId, groupId),
								),
							)
							.orderBy(sql`${applicationManualGroups.archivedAt} NULLS FIRST`)
							.limit(1)
						if (found) stagedIdMap.set(`staged-${op.id}`, found.id)
					}
				}
			}

			// Replay staged operations, mapping fake staged IDs to real DB IDs
			if (stagedOps.length > 0) {
				const { handleComplianceIntent } = await import(
					"~/routes/applikasjoner.$appId.screening.$sessionId/compliance-intents.server"
				)

				for (const op of stagedOps) {
					const formData = new FormData()
					const payload = op.payload as Record<string, string>
					for (const [key, value] of Object.entries(payload)) {
						if (value != null) {
							const resolved = value.startsWith("staged-") ? (stagedIdMap.get(value) ?? value) : value
							formData.set(key, String(resolved))
						}
					}

					// Skip ops that reference unresolvable staged IDs
					if (op.intent === "archive-persistence" || op.intent === "update-persistence-classification") {
						const pid = formData.get("persistenceId") as string
						if (pid?.startsWith("staged-")) continue
					}
					if (op.intent === "remove-manual-group") {
						const gid = formData.get("manualGroupId") as string
						if (gid?.startsWith("staged-")) continue
					}

					let replayResult: unknown
					try {
						replayResult = await handleComplianceIntent(op.intent, formData, frozen.applicationId, authedUser, {
							skipAuthChecks: true,
							skipSync: true,
						})
					} catch (e) {
						if (e instanceof Response) {
							const body = await e.text()
							throw new Error(`Replay av «${op.intent}» feilet: ${body}`)
						}
						throw e
					}

					// Check for non-throwing failure responses from data() (returns DataWithResponseInit, not Response)
					if (replayResult != null && typeof replayResult === "object" && "data" in replayResult) {
						const body = (replayResult as { data: Record<string, unknown> }).data
						if (body && body.success === false) {
							const payloadDebug = JSON.stringify(op.payload)
							throw new Error(
								`Kunne ikke fullføre screening: operasjonen «${op.intent}» feilet: ${body.error || `ukjent feil (payload: ${payloadDebug})`}`,
							)
						}
					}

					// After add operations, map staged ID → real ID for subsequent ops
					if (op.intent === "add-persistence") {
						const type = payload.persistenceType
						const name = payload.persistenceName
						if (type && name) {
							const { applicationPersistence } = await import("~/db/schema/applications")
							const [created] = await db
								.select({ id: applicationPersistence.id })
								.from(applicationPersistence)
								.where(
									and(
										eq(applicationPersistence.applicationId, frozen.applicationId),
										eq(applicationPersistence.type, type as (typeof applicationPersistence.type.enumValues)[number]),
										eq(applicationPersistence.name, name),
										isNull(applicationPersistence.archivedAt),
									),
								)
								.limit(1)
							if (created) {
								stagedIdMap.set(`staged-${op.id}`, created.id)
							}
						}
					}
					if (op.intent === "add-manual-group") {
						const groupId = payload.groupId
						if (groupId) {
							const { applicationManualGroups } = await import("~/db/schema/applications")
							const [created] = await db
								.select({ id: applicationManualGroups.id })
								.from(applicationManualGroups)
								.where(
									and(
										eq(applicationManualGroups.applicationId, frozen.applicationId),
										eq(applicationManualGroups.groupId, groupId),
										isNull(applicationManualGroups.archivedAt),
									),
								)
								.limit(1)
							if (created) {
								stagedIdMap.set(`staged-${op.id}`, created.id)
							}
						}
					}

					// Mark this op as replayed so it won't be re-applied on retry
					await db
						.update(screeningSessionOperations)
						.set({ replayedAt: new Date() })
						.where(eq(screeningSessionOperations.id, op.id))
				}
			}

			// Copy session answers to active screening_answers in a transaction
			return await db.transaction(async (tx) => {
				const sessionAnswers = await tx
					.select()
					.from(screeningSessionAnswers)
					.where(eq(screeningSessionAnswers.sessionId, sessionId))

				if (sessionAnswers.length > 0) {
					await tx
						.insert(screeningAnswers)
						.values(
							sessionAnswers.map((answer) => ({
								applicationId: frozen.applicationId,
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

				await writeAuditLog(
					{
						action: "screening_session_completed",
						entityType: "screening_session",
						entityId: sessionId,
						metadata: {
							answersCount: sessionAnswers.length,
						},
						performedBy,
					},
					tx,
				)

				return frozen
			})
		} catch (err) {
			// Rollback: revert session status to draft if replay or answer copy failed
			try {
				await db
					.update(screeningSessions)
					.set({
						status: "draft",
						completedAt: null,
						completedBy: null,
						updatedAt: new Date(),
						updatedBy: performedBy,
					})
					.where(eq(screeningSessions.id, sessionId))
			} catch (rollbackErr) {
				logger.error("[screening-complete] Rollback failed — session may be stuck as completed", { error: rollbackErr })
			}
			throw err
		}
	})

	if (result === null) {
		throw new Error("En annen bruker fullfører denne screeningen samtidig. Prøv igjen.")
	}

	return result
}

// ─── Archive (Delete) ────────────────────────────────────────────────────

export async function archiveScreeningSession(sessionId: string, performedBy: string, reason: string) {
	return db.transaction(async (tx) => {
		const [archived] = await tx
			.update(screeningSessions)
			.set({
				archivedAt: new Date(),
				archivedBy: performedBy,
				archiveReason: reason,
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
					newValue: JSON.stringify({ reason }),
					performedBy,
				},
				tx,
			)
		}

		return archived ?? null
	})
}

export async function restoreScreeningSession(sessionId: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [restored] = await tx
			.update(screeningSessions)
			.set({
				archivedAt: null,
				archivedBy: null,
				archiveReason: null,
				updatedAt: new Date(),
				updatedBy: performedBy,
			})
			.where(and(eq(screeningSessions.id, sessionId), isNotNull(screeningSessions.archivedAt)))
			.returning()

		if (restored) {
			await writeAuditLog(
				{
					action: "screening_session_restored",
					entityType: "screening_session",
					entityId: sessionId,
					performedBy,
				},
				tx,
			)
		}

		return restored ?? null
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
			.for("update")
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
