import type { LoaderFunctionArgs } from "react-router"
import { data } from "react-router"
import { getApplicationDetail, getGroupAssessmentsForApp, getManualGroupsForApp } from "~/db/queries/nais.server"
import { getOracleRoleAssessments } from "~/db/queries/oracle-roles.server"
import { getRulesetsForSection } from "~/db/queries/rulesets.server"
import { getScreeningDataForApp, getScreeningQuestionsByIds } from "~/db/queries/screening.server"
import { getScreeningSession, getStagedOperations } from "~/db/queries/screening-sessions.server"
import type { DataClassification, PersistenceType } from "~/db/schema/applications"
import { getAuthenticatedUser } from "~/lib/auth.server"
import { isAdmin } from "~/lib/authorization.server"
import { resolveGroupNames } from "~/lib/graph.server"
import { renderMarkdown } from "~/lib/markdown.server"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const appId = params.appId
	const sessionId = params.sessionId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })
	if (!sessionId) throw new Response("Mangler sesjon-ID", { status: 400 })

	const user = await getAuthenticatedUser(request)
	const canAdmin = user ? isAdmin(user) : false

	const [session, screeningData, appDetail, stagedOps] = await Promise.all([
		getScreeningSession(sessionId),
		getScreeningDataForApp(appId),
		getApplicationDetail(appId),
		getStagedOperations(sessionId),
	])

	if (!session) throw new Response("Screening-sesjon ikke funnet", { status: 404 })
	if (session.applicationId !== appId) throw new Response("Sesjon tilhører ikke denne applikasjonen", { status: 403 })
	if (!appDetail) throw new Response("Applikasjon ikke funnet", { status: 404 })

	// For completed sessions, use the state snapshot as baseline (historical view).
	// For in-progress sessions, load live data as baseline (current state preview).
	const useSnapshot = session.status === "completed" && session.stateSnapshot != null
	const snapshot = useSnapshot ? (session.stateSnapshot as Record<string, unknown>) : null

	// For completed sessions with a question snapshot, use it to preserve historical fidelity:
	// questions added/archived/changed after session completion won't affect the historical view.
	type SnapshotQuestion = {
		id: string
		questionText: string
		description: string | null
		sectionId: string | null
		displayOrder: number
		answerType: string
		choices: Array<{
			id: string
			label: string
			requiresComment: boolean
			requiresLink: boolean
			routineSelections: Array<{
				effectId: string
				controlTextId: string
				controlName: string | null
				presetRoutineId: string | null
				presetRoutineName: string | null
				routines: Array<{ id: string; name: string; sectionId: string }>
				selectedRoutineId: string | null
			}>
		}>
		affectedControls: string[]
		rulesetCategoryFilter?: string | null
	}
	const rawSnapshotQuestions = snapshot?.questions
	const snapshotQuestions: SnapshotQuestion[] | null = Array.isArray(rawSnapshotQuestions)
		? (rawSnapshotQuestions as SnapshotQuestion[])
		: null

	// Use snapshot questions for completed sessions, live questions otherwise
	const questionsToUse = snapshotQuestions ?? screeningData.questions

	// Build persistence data if needed
	const hasPersistenceQuestion = questionsToUse.some((q) => q.answerType === "persistence")
	let persistence: Array<{
		id: string
		type: PersistenceType
		name: string
		dataClassification: DataClassification | null
		manuallyAdded: boolean
	}> = []
	if (hasPersistenceQuestion) {
		if (snapshot?.persistence) {
			persistence = snapshot.persistence as typeof persistence
		} else if (!useSnapshot) {
			const { getAppPersistence } = await import("~/db/queries/nais.server")
			const raw = await getAppPersistence(appId)
			persistence = raw.map((p) => ({
				id: p.id,
				type: p.type,
				name: p.name,
				dataClassification: p.dataClassification,
				manuallyAdded: p.manuallyAdded,
			}))
		}
	}

	// Build ruleset options if needed
	const hasRulesetQuestion = questionsToUse.some((q) => q.answerType === "ruleset")
	let rulesetOptions: { id: string; name: string; category: string | null }[] = []
	if (hasRulesetQuestion) {
		// For completed sessions with a ruleset snapshot, use it to preserve historical names.
		// If the snapshot exists but lacks rulesetOptions (session completed before this field was added),
		// fall back to live data so ruleset names still resolve correctly.
		if (snapshot?.rulesetOptions && Array.isArray(snapshot.rulesetOptions)) {
			// Legacy snapshots may lack category — normalise to include it
			rulesetOptions = (snapshot.rulesetOptions as { id: string; name: string; category?: string | null }[]).map(
				(rs) => ({ id: rs.id, name: rs.name, category: rs.category ?? null }),
			)
		} else if (screeningData.sectionIds.length > 0) {
			const allRulesets = await Promise.all(screeningData.sectionIds.map((sid) => getRulesetsForSection(sid)))
			const seen = new Set<string>()
			for (const sectionRulesets of allRulesets) {
				for (const rs of sectionRulesets) {
					if (!seen.has(rs.id) && rs.status === "active") {
						seen.add(rs.id)
						rulesetOptions.push({ id: rs.id, name: rs.name, category: rs.category ?? null })
					}
				}
			}
		}
	}

	// Entra ID groups data
	const hasEntraGroupsQuestion = questionsToUse.some((q) => q.answerType === "entra_id_groups")
	let entraGroupsData: {
		naisGroupIds: string[]
		manualGroups: Array<{ id: string; groupId: string; groupName: string | null; createdBy: string; createdAt: string }>
		ghostGroupIds: string[]
		groupNames: Record<string, string>
		assessmentsByGroupId: Record<string, { criticality: string; updatedBy: string; updatedAt: string }>
	} = { naisGroupIds: [], manualGroups: [], ghostGroupIds: [], groupNames: {}, assessmentsByGroupId: {} }

	if (hasEntraGroupsQuestion) {
		if (snapshot?.entraGroupsData) {
			entraGroupsData = snapshot.entraGroupsData as typeof entraGroupsData
		} else if (!useSnapshot) {
			const [manualGroups, groupAssessments] = await Promise.all([
				getManualGroupsForApp(appId),
				getGroupAssessmentsForApp(appId),
			])
			const naisGroupIds: string[] = []
			for (const auth of appDetail.authIntegrations) {
				if (auth.groups) {
					const groups = JSON.parse(auth.groups) as string[]
					naisGroupIds.push(...groups)
				}
			}
			const naisGroupIdSet = new Set(naisGroupIds)
			const manualGroupIdSet = new Set(manualGroups.map((g) => g.groupId))
			const ghostGroupIds = groupAssessments
				.filter((a) => !naisGroupIdSet.has(a.groupId) && !manualGroupIdSet.has(a.groupId))
				.map((a) => a.groupId)
			const allGroupIds = [...new Set([...naisGroupIds, ...manualGroups.map((g) => g.groupId), ...ghostGroupIds])]
			const groupNames = await resolveGroupNames(allGroupIds)
			const assessmentsByGroupId: Record<string, { criticality: string; updatedBy: string; updatedAt: string }> = {}
			for (const a of groupAssessments) {
				assessmentsByGroupId[a.groupId] = {
					criticality: a.criticality,
					updatedBy: a.updatedBy,
					updatedAt: a.updatedAt.toISOString(),
				}
			}
			entraGroupsData = {
				naisGroupIds,
				manualGroups: manualGroups.map((g) => ({ ...g, createdAt: g.createdAt.toISOString() })),
				ghostGroupIds,
				groupNames,
				assessmentsByGroupId,
			}
		}
	}

	// Oracle roles data
	const hasOracleRolesQuestion = questionsToUse.some((q) => q.answerType === "oracle_roles")
	let oracleRolesData: {
		roles: Array<{ instanceId: string; roleName: string; authType: string | null; common: boolean | null }>
		assessments: Record<string, { criticality: string; updatedBy: string; updatedAt: string }>
	} = { roles: [], assessments: {} }

	if (hasOracleRolesQuestion) {
		if (snapshot?.oracleRolesData) {
			oracleRolesData = snapshot.oracleRolesData as typeof oracleRolesData
		} else if (!useSnapshot) {
			const { getOracleInstancesForApp } = await import("~/db/queries/audit-evidence.server")
			const { getOracleRoles, getOracleInstances, shouldAssessRole } = await import("~/lib/oracle-revisjon.server")
			const { filterInstancesByAccess } = await import("~/lib/oracle-access.server")

			const allInstances = await getOracleInstances()
			const instanceGroupMap = new Map(allInstances.map((i) => [i.id, i]))

			const appInstances = await getOracleInstancesForApp(appId)
			const filteredInstances = filterInstancesByAccess(
				appInstances
					.filter((inst) => instanceGroupMap.has(inst.instanceId))
					.map((inst) => ({ ...inst, group: instanceGroupMap.get(inst.instanceId)?.group ?? null })),
				user?.groups ?? [],
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
		}
	}

	// Economy system classification
	const hasEconomySystemQuestion = questionsToUse.some((q) => q.answerType === "economy_system")
	let economyClassification: {
		id: string
		isEconomySystem: boolean
		economySystemType: string | null
		justification: string
		validFrom: string
		validUntil: string
		isExpired: boolean
	} | null = null

	if (hasEconomySystemQuestion) {
		if (snapshot?.economyClassification) {
			economyClassification = snapshot.economyClassification as unknown as typeof economyClassification
		} else if (!useSnapshot) {
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
		}
	}

	// Apply staged operations to create preview state
	for (const op of stagedOps) {
		const p = op.payload as Record<string, string>
		switch (op.intent) {
			case "add-persistence": {
				const type = p.persistenceType as PersistenceType
				const name = p.persistenceName
				const classification = (p.dataClassification as DataClassification) || null
				if (type && name) {
					persistence.push({
						id: `staged-${op.id}`,
						type,
						name,
						dataClassification: classification,
						manuallyAdded: true,
					})
				}
				break
			}
			case "archive-persistence": {
				const persistenceId = p.persistenceId
				persistence = persistence.filter((e) => e.id !== persistenceId)
				break
			}
			case "unarchive-persistence": {
				// Cannot preview unarchive without fetching archived entries
				break
			}
			case "update-persistence-classification": {
				const persistenceId = p.persistenceId
				const classification = (p.dataClassification as DataClassification) || null
				const entry = persistence.find((e) => e.id === persistenceId)
				if (entry) entry.dataClassification = classification
				break
			}
			case "add-manual-group": {
				const groupId = p.groupId
				const groupName = p.groupName || null
				if (groupId) {
					entraGroupsData.manualGroups.push({
						id: `staged-${op.id}`,
						groupId,
						groupName,
						createdBy: op.performedBy,
						createdAt: op.createdAt.toISOString(),
					})
					entraGroupsData.groupNames[groupId] = groupName || `Gruppe ${groupId.slice(0, 8)}…`
				}
				break
			}
			case "remove-manual-group": {
				const manualGroupId = p.manualGroupId
				entraGroupsData.manualGroups = entraGroupsData.manualGroups.filter((g) => g.id !== manualGroupId)
				break
			}
			case "set-group-criticality": {
				const groupId = p.groupId
				const criticality = p.criticality
				if (groupId && criticality) {
					entraGroupsData.assessmentsByGroupId[groupId] = {
						criticality,
						updatedBy: op.performedBy,
						updatedAt: op.createdAt.toISOString(),
					}
				}
				break
			}
			case "set-oracle-role-criticality": {
				const instanceId = p.instanceId
				const roleName = p.roleName
				const criticality = p.criticality
				if (instanceId && roleName && criticality) {
					const key = `${instanceId}:${roleName.toUpperCase().trim()}`
					oracleRolesData.assessments[key] = {
						criticality,
						updatedBy: op.performedBy,
						updatedAt: op.createdAt.toISOString(),
					}
				}
				break
			}
			case "save-economy-classification": {
				const isEconomySystem = p.isEconomySystem === "ja"
				economyClassification = {
					id: `staged-${op.id}`,
					isEconomySystem,
					economySystemType: isEconomySystem ? p.economySystemType : null,
					justification: p.justification || "",
					validFrom: new Date().toISOString(),
					validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
					isExpired: false,
				}
				break
			}
			case "selectRoutine": {
				const choiceEffectId = p.choiceEffectId
				const routineId = p.routineId || null
				if (choiceEffectId) {
					for (const q of screeningData.questions) {
						for (const c of q.choices) {
							const rs = c.routineSelections?.find((r) => r.effectId === choiceEffectId)
							if (rs) {
								rs.selectedRoutineId = routineId
							}
						}
					}
				}
				break
			}
		}
	}

	// Map session answers by questionId
	const sessionAnswersMap = new Map(session.answers.map((a) => [a.questionId, a]))

	// Fallback map for sectionId: old snapshots were stored before sectionId was added to the snapshot schema,
	// and archived questions are not included in screeningData.questions. For any snapshot question missing
	// from live data, do a single DB lookup (including archived) to retrieve sectionId.
	const liveSectionIdByQuestionId = new Map(screeningData.questions.map((q) => [q.id, q.sectionId ?? null]))
	const missingIds = questionsToUse.filter((q) => !q.sectionId && !liveSectionIdByQuestionId.has(q.id)).map((q) => q.id)
	if (missingIds.length > 0) {
		const archived = await getScreeningQuestionsByIds(missingIds)
		for (const q of archived) {
			liveSectionIdByQuestionId.set(q.id, q.sectionId ?? null)
		}
	}

	// Build the screening list from the chosen questions (snapshot or live), overlaying session answers.
	// Explicit field mapping avoids type confusion between snapshot questions (no answer fields)
	// and live questions (which include app-level answers that must be replaced with session answers).
	const screening = questionsToUse.map((q) => {
		const sessionAnswer = sessionAnswersMap.get(q.id)
		return {
			id: q.id,
			questionText: q.questionText,
			description: q.description,
			sectionId: q.sectionId ?? liveSectionIdByQuestionId.get(q.id) ?? null,
			displayOrder: q.displayOrder,
			answerType: q.answerType,
			rulesetCategoryFilter: q.rulesetCategoryFilter ?? null,
			choices: q.choices,
			affectedControls: q.affectedControls,
			descriptionHtml: renderMarkdown(q.description),
			answer: sessionAnswer ? sessionAnswer.answer : null,
			answerComment: sessionAnswer ? sessionAnswer.comment : null,
			answerLink: sessionAnswer ? sessionAnswer.link : null,
			answeredBy: sessionAnswer ? sessionAnswer.answeredBy : null,
			answeredAt: sessionAnswer ? (sessionAnswer.answeredAt?.toISOString() ?? null) : null,
		}
	})

	return data({
		appId,
		appName: appDetail.app.name,
		hasQuestionSnapshot: snapshotQuestions !== null,
		session: {
			id: session.id,
			title: session.title,
			status: session.status,
			participants: session.participants.map((p) => ({
				id: p.id,
				userIdent: p.userIdent,
				userName: p.userName,
			})),
		},
		screening,
		persistence,
		rulesetOptions,
		entraGroupsData,
		oracleRolesData,
		economyClassification,
		canAdmin,
	})
}
