import { and, count, desc, eq, isNull, sql } from "drizzle-orm"
import { getStatusLabel } from "~/lib/compliance-status"
import type { ParsedFramework } from "~/lib/excel-parser.server"
import { deriveCronFrequency } from "~/lib/frequency-mapping"
import { parseTechnologyElements } from "~/lib/technology-element-parser"
import { db } from "../connection.server"
import { monitoredApplications } from "../schema/applications"
import { complianceAssessments } from "../schema/compliance"
import {
	controlDependencies,
	controlPredefinedAnswers,
	controlTechnologyElements,
	frameworkControls,
	frameworkDomains,
	frameworkFieldHistory,
	frameworkRiskControlMappings,
	frameworkRisks,
	frameworkVersions,
	technologyElements,
} from "../schema/framework"
import { writeAuditLog } from "./audit.server"

/** Get the most recently applied framework version (for import page info). */
export async function getActiveFrameworkVersion() {
	const [version] = await db
		.select()
		.from(frameworkVersions)
		.where(eq(frameworkVersions.status, "applied"))
		.orderBy(desc(frameworkVersions.activatedAt))
		.limit(1)
	return version ?? null
}

/** Get domain summaries for live (non-archived) framework data. */
export async function getDomainSummaries() {
	const domains = await db
		.select()
		.from(frameworkDomains)
		.where(isNull(frameworkDomains.archivedAt))
		.orderBy(frameworkDomains.displayOrder)

	if (domains.length === 0) return []

	const [appCountRow] = await db
		.select({ count: count() })
		.from(monitoredApplications)
		.where(isNull(monitoredApplications.primaryApplicationId))
	const totalApps = appCountRow?.count ?? 0

	const result = []
	for (const domain of domains) {
		const [riskRow] = await db
			.select({ count: count() })
			.from(frameworkRisks)
			.where(and(eq(frameworkRisks.domainId, domain.id), isNull(frameworkRisks.archivedAt)))

		// Get controls for this domain via risk→control mappings
		const controlIds = await db
			.selectDistinctOn([frameworkRiskControlMappings.controlId], {
				id: frameworkRiskControlMappings.controlId,
			})
			.from(frameworkRiskControlMappings)
			.innerJoin(frameworkRisks, eq(frameworkRiskControlMappings.riskId, frameworkRisks.id))
			.innerJoin(frameworkControls, eq(frameworkRiskControlMappings.controlId, frameworkControls.id))
			.where(
				and(
					eq(frameworkRisks.domainId, domain.id),
					isNull(frameworkRisks.archivedAt),
					isNull(frameworkControls.archivedAt),
				),
			)

		const controlUuids = controlIds.map((c) => c.id)
		const controlCount = controlUuids.length

		let implemented = 0
		let partial = 0
		let notImplemented = 0
		let notRelevant = 0

		if (controlUuids.length > 0) {
			const [implRow] = await db
				.select({ count: count() })
				.from(complianceAssessments)
				.where(
					sql`${complianceAssessments.controlId} IN ${controlUuids} AND ${complianceAssessments.status} = 'implemented'`,
				)
			implemented = implRow?.count ?? 0

			const [partialRow] = await db
				.select({ count: count() })
				.from(complianceAssessments)
				.where(
					sql`${complianceAssessments.controlId} IN ${controlUuids} AND ${complianceAssessments.status} = 'partially_implemented'`,
				)
			partial = partialRow?.count ?? 0

			const [notImplRow] = await db
				.select({ count: count() })
				.from(complianceAssessments)
				.where(
					sql`${complianceAssessments.controlId} IN ${controlUuids} AND ${complianceAssessments.status} = 'not_implemented'`,
				)
			notImplemented = notImplRow?.count ?? 0

			const [notRelRow] = await db
				.select({ count: count() })
				.from(complianceAssessments)
				.where(
					sql`${complianceAssessments.controlId} IN ${controlUuids} AND ${complianceAssessments.status} = 'not_relevant'`,
				)
			notRelevant = notRelRow?.count ?? 0
		}

		// Count controls with gaps (at least one app not fully implemented)
		let controlsWithGaps = 0
		if (totalApps > 0 && controlUuids.length > 0) {
			for (const ctrlId of controlUuids) {
				const [implCount] = await db
					.select({ count: count() })
					.from(complianceAssessments)
					.where(
						sql`${complianceAssessments.controlId} = ${ctrlId} AND ${complianceAssessments.status} IN ('implemented', 'not_relevant')`,
					)
				if ((implCount?.count ?? 0) < totalApps) {
					controlsWithGaps++
				}
			}
		}

		result.push({
			code: domain.code,
			name: domain.name,
			riskCount: riskRow?.count ?? 0,
			controlCount,
			controlsWithGaps,
			totalAssessments: controlCount * totalApps,
			implemented,
			partial,
			notImplemented,
			notRelevant,
		})
	}

	return result
}

/** Get all live risks across all domains. */
export async function getAllRisks() {
	const rows = await db
		.select({
			riskId: frameworkRisks.riskId,
			shortTitle: frameworkRisks.shortTitle,
			description: frameworkRisks.description,
			domainCode: frameworkDomains.code,
			domainName: frameworkDomains.name,
			displayOrder: frameworkDomains.displayOrder,
		})
		.from(frameworkRisks)
		.innerJoin(frameworkDomains, eq(frameworkRisks.domainId, frameworkDomains.id))
		.where(and(isNull(frameworkRisks.archivedAt), isNull(frameworkDomains.archivedAt)))
		.orderBy(frameworkDomains.displayOrder, frameworkRisks.riskId)

	return rows.map((r) => ({
		riskId: r.riskId,
		name: r.shortTitle ?? r.description,
		description: r.description,
		domainCode: r.domainCode,
		domainName: r.domainName,
	}))
}

/** Get all live controls across all domains. */
export async function getAllControls() {
	const rows = await db
		.select({
			uuid: frameworkControls.id,
			controlId: frameworkControls.controlId,
			shortTitle: frameworkControls.shortTitle,
			requirement: frameworkControls.requirement,
		})
		.from(frameworkControls)
		.where(isNull(frameworkControls.archivedAt))
		.orderBy(frameworkControls.controlId)

	const controlUuids = rows.map((r) => r.uuid)
	const domainMap = await getControlDomainMap(controlUuids)

	return rows.map((r) => {
		const domains = domainMap.get(r.uuid) ?? []
		const primary = domains.sort((a, b) => a.displayOrder - b.displayOrder)[0]
		return {
			controlId: r.controlId,
			name: r.shortTitle ?? shortName(r.requirement, r.controlId),
			domainCode: primary?.domainCode ?? "",
			domainName: primary?.domainName ?? "",
		}
	})
}

/** Extract the short title from a requirement field (first line only). */
function shortName(requirement: string | null, fallback: string): string {
	if (!requirement) return fallback
	const firstLine = requirement.split("\n")[0].trim()
	return firstLine || fallback
}

/** Get a live domain with its risks and controls. */
export async function getDomainDetail(domainCode: string) {
	const [domain] = await db
		.select()
		.from(frameworkDomains)
		.where(sql`${frameworkDomains.archivedAt} IS NULL AND ${frameworkDomains.code} = ${domainCode.toUpperCase()}`)
		.limit(1)

	if (!domain) return null

	// Fetch all apps for compliance counting
	const allApps = await db
		.select({ id: monitoredApplications.id, name: monitoredApplications.name })
		.from(monitoredApplications)

	const risks = await db
		.select()
		.from(frameworkRisks)
		.where(and(eq(frameworkRisks.domainId, domain.id), isNull(frameworkRisks.archivedAt)))

	const risksWithControls = []
	for (const risk of risks) {
		const mappings = await db
			.select({ controlId: frameworkRiskControlMappings.controlId })
			.from(frameworkRiskControlMappings)
			.where(eq(frameworkRiskControlMappings.riskId, risk.id))

		const controls = []
		for (const mapping of mappings) {
			const [ctrl] = await db
				.select()
				.from(frameworkControls)
				.where(and(eq(frameworkControls.id, mapping.controlId), isNull(frameworkControls.archivedAt)))
			if (ctrl) {
				// Fetch compliance assessments for this control
				const assessments = await db
					.select({
						appId: complianceAssessments.applicationId,
						status: complianceAssessments.status,
					})
					.from(complianceAssessments)
					.where(eq(complianceAssessments.controlId, ctrl.id))

				const assessmentMap = new Map(assessments.map((a) => [a.appId, a.status]))
				let implemented = 0
				let partial = 0
				let notImplemented = 0
				const gaps: Array<{ appId: string; appName: string; status: string }> = []

				for (const app of allApps) {
					const status = assessmentMap.get(app.id)
					if (status === "implemented" || status === "not_relevant") {
						implemented++
					} else if (status === "partially_implemented") {
						partial++
						gaps.push({ appId: app.id, appName: app.name, status: getStatusLabel(status) })
					} else if (status === "not_implemented") {
						notImplemented++
						gaps.push({ appId: app.id, appName: app.name, status: getStatusLabel(status) })
					} else {
						gaps.push({ appId: app.id, appName: app.name, status: getStatusLabel(status) })
					}
				}

				controls.push({
					id: ctrl.controlId,
					name: ctrl.shortTitle ?? shortName(ctrl.requirement, ctrl.controlId),
					totalApps: allApps.length,
					implemented,
					partial,
					notImplemented,
					notAssessed: allApps.length - implemented - partial - notImplemented,
					gaps,
				})
			}
		}

		risksWithControls.push({
			id: risk.riskId,
			name: risk.shortTitle ?? risk.description,
			controls,
		})
	}

	return {
		code: domain.code,
		name: domain.name,
		risks: risksWithControls,
	}
}

/** Get full risk detail by risk ID string (e.g. "R-TS.01"). */
export async function getRiskDetail(riskIdStr: string) {
	const [risk] = await db
		.select({
			id: frameworkRisks.id,
			riskId: frameworkRisks.riskId,
			shortTitle: frameworkRisks.shortTitle,
			description: frameworkRisks.description,
			domainId: frameworkDomains.id,
			domainCode: frameworkDomains.code,
			domainName: frameworkDomains.name,
		})
		.from(frameworkRisks)
		.innerJoin(frameworkDomains, eq(frameworkRisks.domainId, frameworkDomains.id))
		.where(sql`${frameworkRisks.archivedAt} IS NULL AND ${frameworkRisks.riskId} = ${riskIdStr}`)
		.limit(1)

	if (!risk) return null

	const mappings = await db
		.select({ controlId: frameworkRiskControlMappings.controlId })
		.from(frameworkRiskControlMappings)
		.where(eq(frameworkRiskControlMappings.riskId, risk.id))

	const controls = []
	for (const mapping of mappings) {
		const [ctrl] = await db
			.select()
			.from(frameworkControls)
			.where(and(eq(frameworkControls.id, mapping.controlId), isNull(frameworkControls.archivedAt)))
		if (ctrl) {
			controls.push({
				id: ctrl.controlId,
				name: ctrl.shortTitle ?? shortName(ctrl.requirement, ctrl.controlId),
				domainCode: risk.domainCode,
			})
		}
	}

	return {
		riskId: risk.riskId,
		name: risk.shortTitle ?? shortName(risk.description, risk.riskId),
		description: risk.description,
		domainId: risk.domainId,
		domainCode: risk.domainCode,
		domainName: risk.domainName,
		controls,
	}
}

/** Get full control detail by control ID string (e.g. "K-ST.01"). */
export async function getControlDetail(controlIdStr: string) {
	const [ctrl] = await db
		.select()
		.from(frameworkControls)
		.where(sql`${frameworkControls.archivedAt} IS NULL AND ${frameworkControls.controlId} = ${controlIdStr}`)
		.limit(1)

	if (!ctrl) return null

	const answers = await db
		.select()
		.from(controlPredefinedAnswers)
		.where(eq(controlPredefinedAnswers.controlId, ctrl.id))
		.orderBy(controlPredefinedAnswers.displayOrder)

	return {
		uuid: ctrl.id,
		id: ctrl.controlId,
		name: ctrl.shortTitle ?? shortName(ctrl.requirement, ctrl.controlId),
		teknologielement: ctrl.technologyElement ?? "Ikke spesifisert",
		krav: ctrl.requirement ?? "Ikke spesifisert",
		ansvarlig: ctrl.responsible ?? "Ikke tildelt",
		rutine: ctrl.routine ?? "Ikke definert",
		frekvens: ctrl.frequency ?? "Ikke definert",
		kronologiskFrekvens: ctrl.cronFrequency ?? null,
		dokumentasjonskrav: ctrl.documentationRequirement ?? "Ikke spesifisert",
		testprosedyre: ctrl.testProcedure ?? "Ikke definert",
		avhengigheter: ctrl.dependencies ?? "Ingen kjente",
		referanser: ctrl.references ?? "Ikke spesifisert",
		vanligeFallgruver: ctrl.commonPitfalls ?? "Ikke dokumentert",
		predefinedAnswers: answers.map((a) => ({
			id: a.id,
			label: a.label,
			status: a.status,
			comment: a.comment,
			displayOrder: a.displayOrder,
		})),
	}
}

/** Update the short title of a risk. */
export async function updateRiskShortTitle(riskId: string, shortTitle: string, performedBy = "system") {
	const [risk] = await db
		.select()
		.from(frameworkRisks)
		.where(sql`${frameworkRisks.archivedAt} IS NULL AND ${frameworkRisks.riskId} = ${riskId}`)
		.limit(1)

	if (!risk) throw new Error(`Risiko ${riskId} finnes ikke.`)

	const previousValue = risk.shortTitle
	const newValue = shortTitle.trim() || null

	await db.update(frameworkRisks).set({ shortTitle: newValue }).where(eq(frameworkRisks.id, risk.id))

	await writeAuditLog({
		action: "risk_short_title_updated",
		entityType: "framework_risk",
		entityId: riskId,
		previousValue,
		newValue,
		performedBy,
	})
}

/** Update the short title of a control. */
export async function updateControlShortTitle(controlIdStr: string, shortTitle: string, performedBy = "system") {
	const [ctrl] = await db
		.select()
		.from(frameworkControls)
		.where(sql`${frameworkControls.archivedAt} IS NULL AND ${frameworkControls.controlId} = ${controlIdStr}`)
		.limit(1)

	if (!ctrl) throw new Error(`Kontroll ${controlIdStr} finnes ikke.`)

	const previousValue = ctrl.shortTitle
	const newValue = shortTitle.trim() || null

	await db.update(frameworkControls).set({ shortTitle: newValue }).where(eq(frameworkControls.id, ctrl.id))

	await writeAuditLog({
		action: "control_short_title_updated",
		entityType: "framework_control",
		entityId: controlIdStr,
		previousValue,
		newValue,
		performedBy,
	})
}

/** Editable fields on frameworkControls and their DB column names. */
const controlFieldMap: Record<string, keyof typeof frameworkControls.$inferInsert> = {
	shortTitle: "shortTitle",
	technologyElement: "technologyElement",
	requirement: "requirement",
	responsible: "responsible",
	routine: "routine",
	frequency: "frequency",
	cronFrequency: "cronFrequency",
	documentationRequirement: "documentationRequirement",
	testProcedure: "testProcedure",
	dependencies: "dependencies",
	references: "references",
	commonPitfalls: "commonPitfalls",
}

/** Update a single field on a control. */
export async function updateControlField(controlIdStr: string, fieldName: string, value: string, performedBy: string) {
	const column = controlFieldMap[fieldName]
	if (!column) throw new Error(`Ugyldig felt: ${fieldName}`)

	const [ctrl] = await db
		.select()
		.from(frameworkControls)
		.where(sql`${frameworkControls.archivedAt} IS NULL AND ${frameworkControls.controlId} = ${controlIdStr}`)
		.limit(1)

	if (!ctrl) throw new Error(`Kontroll ${controlIdStr} finnes ikke.`)

	const previousValue = (ctrl as Record<string, unknown>)[column] as string | null
	const newValue = value.trim() || null

	await db
		.update(frameworkControls)
		.set({ [column]: newValue })
		.where(eq(frameworkControls.id, ctrl.id))

	await writeAuditLog({
		action: "control_field_updated",
		entityType: "framework_control",
		entityId: controlIdStr,
		previousValue,
		newValue,
		metadata: { field: fieldName },
		performedBy,
	})
}

/** Update multiple fields on a control in one go. Only changed fields are written. */
export async function updateControlFields(controlIdStr: string, fields: Record<string, string>, performedBy: string) {
	const [ctrl] = await db
		.select()
		.from(frameworkControls)
		.where(sql`${frameworkControls.archivedAt} IS NULL AND ${frameworkControls.controlId} = ${controlIdStr}`)
		.limit(1)

	if (!ctrl) throw new Error(`Kontroll ${controlIdStr} finnes ikke.`)

	for (const [fieldName, value] of Object.entries(fields)) {
		const column = controlFieldMap[fieldName]
		if (!column) continue

		const previousValue = (ctrl as Record<string, unknown>)[column] as string | null
		const newValue = value.trim() || null

		if (previousValue === newValue) continue

		await db
			.update(frameworkControls)
			.set({ [column]: newValue })
			.where(eq(frameworkControls.id, ctrl.id))

		await writeAuditLog({
			action: "control_field_updated",
			entityType: "framework_control",
			entityId: controlIdStr,
			previousValue,
			newValue,
			metadata: { field: fieldName },
			performedBy,
		})
	}
}

/** Stage a framework import: create a pending version and compute the diff against live data. */
export async function stageFrameworkImport(
	parsed: ParsedFramework,
	fileName: string,
	uploadedBy: string,
	bucketPath: string,
): Promise<string> {
	// Supersede any existing pending imports
	await db.update(frameworkVersions).set({ status: "superseded" }).where(eq(frameworkVersions.status, "pending"))

	// Create new pending version record (import log only — no domain/risk/control rows)
	const [version] = await db
		.insert(frameworkVersions)
		.values({
			name: fileName.replace(/\.xlsx$/i, ""),
			description: `Importert fra ${fileName}`,
			sourceFileName: fileName,
			sourceBucketPath: bucketPath,
			status: "pending",
			createdBy: uploadedBy,
		})
		.returning()

	await writeAuditLog({
		action: "framework_imported",
		entityType: "framework_version",
		entityId: version.id,
		newValue: fileName,
		metadata: {
			domainCount: new Set(parsed.rows.map((r) => r.domain)).size,
			riskCount: new Set(parsed.rows.map((r) => r.riskId)).size,
			controlCount: new Set(parsed.rows.map((r) => r.controlId)).size,
		},
		performedBy: uploadedBy,
	})

	return version.id
}

// Keep backward-compatible alias
export const stageFrameworkVersion = stageFrameworkImport

/**
 * Parse comma/semicolon-separated technology element text and sync junction entries.
 * Matches element names case-insensitively against existing technology elements.
 */
async function syncControlTechElements(
	controlUuid: string,
	techElementText: string | null,
	techElementByName: Map<string, { id: string; name: string }>,
) {
	const parsed = parseTechnologyElements(techElementText)
	const desiredIds = new Set<string>()
	for (const { name } of parsed) {
		const el = techElementByName.get(name.toLowerCase())
		if (el) desiredIds.add(el.id)
	}

	// Get existing junction entries
	const existing = await db
		.select({ id: controlTechnologyElements.id, elementId: controlTechnologyElements.elementId })
		.from(controlTechnologyElements)
		.where(eq(controlTechnologyElements.controlId, controlUuid))

	const existingIds = new Set(existing.map((e) => e.elementId))

	// Add missing
	for (const elementId of desiredIds) {
		if (!existingIds.has(elementId)) {
			await db.insert(controlTechnologyElements).values({ controlId: controlUuid, elementId }).onConflictDoNothing()
		}
	}

	// Remove no-longer-matched
	for (const row of existing) {
		if (!desiredIds.has(row.elementId)) {
			await db.delete(controlTechnologyElements).where(eq(controlTechnologyElements.id, row.id))
		}
	}
}

/** Apply a pending import: upsert live data, archive removed items, record field history. */
export async function applyFrameworkImport(
	versionId: string,
	parsed: ParsedFramework,
	appliedBy: string,
	invalidatedControlIds: string[] = [],
	excludedChanges?: Set<string>,
): Promise<void> {
	const [version] = await db.select().from(frameworkVersions).where(eq(frameworkVersions.id, versionId)).limit(1)

	if (!version) throw new Error("Versjonen finnes ikke.")
	if (version.status !== "pending") throw new Error("Kun versjoner med status «pending» kan anvendes.")

	const now = new Date()

	// Mark any previous applied version as superseded
	await db.update(frameworkVersions).set({ status: "superseded" }).where(eq(frameworkVersions.status, "applied"))

	// Build parsed data maps
	const parsedDomains = new Map<string, { name: string; displayOrder: number }>()
	let displayOrder = 1
	for (const row of parsed.rows) {
		if (!parsedDomains.has(row.domain)) {
			const code = row.riskId.match(/R-([A-Z]{2})\./)?.[1] ?? row.domain.slice(0, 2).toUpperCase()
			parsedDomains.set(code, { name: row.domain, displayOrder: displayOrder++ })
		}
	}

	// Build parsed risks/controls/mappings maps
	const parsedRisks = new Map<string, { description: string; domainCode: string }>()
	const parsedControls = new Map<
		string,
		{
			domainCode: string
			technologyElement: string | null
			requirement: string | null
			responsible: string | null
			routine: string | null
			frequency: string | null
			documentationRequirement: string | null
			testProcedure: string | null
			dependencies: string | null
			references: string | null
			commonPitfalls: string | null
		}
	>()
	const parsedMappings = new Set<string>()

	for (const row of parsed.rows) {
		const domainCode = row.riskId.match(/R-([A-Z]{2})\./)?.[1] ?? row.domain.slice(0, 2).toUpperCase()

		if (!parsedRisks.has(row.riskId)) {
			parsedRisks.set(row.riskId, { description: row.riskDescription, domainCode })
		}

		if (!parsedControls.has(row.controlId)) {
			parsedControls.set(row.controlId, {
				domainCode,
				technologyElement: row.technologyElement,
				requirement: row.requirement,
				responsible: row.responsible,
				routine: row.routine,
				frequency: row.frequency,
				documentationRequirement: row.documentationRequirement,
				testProcedure: row.testProcedure,
				dependencies: row.dependencies,
				references: row.references,
				commonPitfalls: row.commonPitfalls,
			})
		}

		parsedMappings.add(`${row.riskId}::${row.controlId}`)
	}

	// --- DOMAINS ---
	const liveDomains = await db.select().from(frameworkDomains).where(isNull(frameworkDomains.archivedAt))
	const liveDomainMap = new Map(liveDomains.map((d) => [d.code, d]))
	const domainUuidMap = new Map<string, string>()

	// Upsert domains
	for (const [code, data] of parsedDomains) {
		const existing = liveDomainMap.get(code)
		if (existing) {
			if (existing.name !== data.name || existing.displayOrder !== data.displayOrder) {
				if (existing.name !== data.name) {
					await db.insert(frameworkFieldHistory).values({
						entityType: "domain",
						entityId: existing.id,
						fieldName: "name",
						previousValue: existing.name,
						newValue: data.name,
						importId: versionId,
						changedBy: appliedBy,
					})
				}
				await db
					.update(frameworkDomains)
					.set({ name: data.name, displayOrder: data.displayOrder, lastImportId: versionId })
					.where(eq(frameworkDomains.id, existing.id))
			} else {
				await db.update(frameworkDomains).set({ lastImportId: versionId }).where(eq(frameworkDomains.id, existing.id))
			}
			domainUuidMap.set(code, existing.id)
		} else {
			const [domain] = await db
				.insert(frameworkDomains)
				.values({
					code,
					name: data.name,
					displayOrder: data.displayOrder,
					lastImportId: versionId,
				})
				.returning()
			domainUuidMap.set(code, domain.id)
		}
	}

	// Archive removed domains
	for (const existing of liveDomains) {
		if (!parsedDomains.has(existing.code)) {
			await db.update(frameworkDomains).set({ archivedAt: now }).where(eq(frameworkDomains.id, existing.id))
		}
	}

	// --- RISKS ---
	const liveRisks = await db.select().from(frameworkRisks).where(isNull(frameworkRisks.archivedAt))
	const liveRiskMap = new Map(liveRisks.map((r) => [r.riskId, r]))
	const riskUuidMap = new Map<string, string>()

	for (const [riskId, data] of parsedRisks) {
		const domainId = domainUuidMap.get(data.domainCode)
		if (!domainId) continue

		const existing = liveRiskMap.get(riskId)
		if (existing) {
			const fields: { fieldName: string; prev: string | null; next: string | null }[] = []
			if (existing.description !== data.description && !excludedChanges?.has(`risk:${riskId}:description`)) {
				fields.push({ fieldName: "description", prev: existing.description, next: data.description })
			}
			if (existing.domainId !== domainId) {
				fields.push({ fieldName: "domainId", prev: existing.domainId, next: domainId })
			}

			for (const f of fields) {
				await db.insert(frameworkFieldHistory).values({
					entityType: "risk",
					entityId: existing.id,
					fieldName: f.fieldName,
					previousValue: f.prev,
					newValue: f.next,
					importId: versionId,
					changedBy: appliedBy,
				})
			}

			const riskUpdates: Record<string, string | null> = { lastImportId: versionId }
			if (fields.some((f) => f.fieldName === "description")) riskUpdates.description = data.description
			if (fields.some((f) => f.fieldName === "domainId")) riskUpdates.domainId = domainId

			await db.update(frameworkRisks).set(riskUpdates).where(eq(frameworkRisks.id, existing.id))
			riskUuidMap.set(riskId, existing.id)
		} else {
			const [risk] = await db
				.insert(frameworkRisks)
				.values({
					domainId,
					riskId,
					description: data.description,
					lastImportId: versionId,
				})
				.returning()
			riskUuidMap.set(riskId, risk.id)
		}
	}

	// Archive removed risks
	for (const existing of liveRisks) {
		if (!parsedRisks.has(existing.riskId)) {
			await db.update(frameworkRisks).set({ archivedAt: now }).where(eq(frameworkRisks.id, existing.id))
		}
	}

	// --- CONTROLS ---
	const liveControls = await db.select().from(frameworkControls).where(isNull(frameworkControls.archivedAt))
	const liveControlMap = new Map(liveControls.map((c) => [c.controlId, c]))

	const controlCompareFields = [
		"technologyElement",
		"requirement",
		"responsible",
		"routine",
		"frequency",
		"documentationRequirement",
		"testProcedure",
		"dependencies",
		"references",
		"commonPitfalls",
	] as const

	// Load all technology elements for name matching
	const allTechElements = await db.select().from(technologyElements)
	const techElementByName = new Map(allTechElements.map((e) => [e.name.toLowerCase().trim(), e]))

	// Auto-create missing technology elements from parsed Excel data
	const allParsedElements = new Map<string, { name: string; description: string | null }>()
	for (const [, data] of parsedControls) {
		for (const el of parseTechnologyElements(data.technologyElement)) {
			if (!allParsedElements.has(el.name.toLowerCase())) {
				allParsedElements.set(el.name.toLowerCase(), el)
			}
		}
	}
	for (const [lowerName, el] of allParsedElements) {
		if (!techElementByName.has(lowerName)) {
			const slug = lowerName
				.replace(/[^a-zæøå0-9]+/gi, "-")
				.replace(/^-|-$/g, "")
				.toLowerCase()
			const [created] = await db
				.insert(technologyElements)
				.values({ name: el.name, slug, description: el.description })
				.onConflictDoNothing()
				.returning()
			if (created) {
				techElementByName.set(lowerName, created)
			}
		}
	}

	for (const [controlId, data] of parsedControls) {
		const existing = liveControlMap.get(controlId)
		if (existing) {
			const updates: Record<string, string | null> = {}
			for (const field of controlCompareFields) {
				const oldVal = existing[field] ?? null
				const newVal = data[field] ?? null
				if (oldVal !== newVal && !excludedChanges?.has(`control:${controlId}:${field}`)) {
					await db.insert(frameworkFieldHistory).values({
						entityType: "control",
						entityId: existing.id,
						fieldName: field,
						previousValue: oldVal,
						newValue: newVal,
						importId: versionId,
						changedBy: appliedBy,
					})
					updates[field] = newVal
				}
			}

			// Compute and apply cronFrequency from frequency text
			const effectiveFrequency = updates.frequency !== undefined ? updates.frequency : existing.frequency
			const newCron = deriveCronFrequency(effectiveFrequency)
			if (!excludedChanges?.has(`control:${controlId}:cronFrequency`)) {
				const oldCron = existing.cronFrequency ?? null
				if (newCron !== oldCron && newCron !== null) {
					await db.insert(frameworkFieldHistory).values({
						entityType: "control",
						entityId: existing.id,
						fieldName: "cronFrequency",
						previousValue: oldCron,
						newValue: newCron,
						importId: versionId,
						changedBy: appliedBy,
					})
					updates.cronFrequency = newCron
				}
			}

			await db
				.update(frameworkControls)
				.set({ ...updates, lastImportId: versionId })
				.where(eq(frameworkControls.id, existing.id))

			// Sync technology element junction entries
			await syncControlTechElements(existing.id, data.technologyElement, techElementByName)
		} else {
			const newCron = deriveCronFrequency(data.frequency)
			const [inserted] = await db
				.insert(frameworkControls)
				.values({
					controlId,
					technologyElement: data.technologyElement,
					requirement: data.requirement,
					responsible: data.responsible,
					routine: data.routine,
					frequency: data.frequency,
					cronFrequency: newCron,
					documentationRequirement: data.documentationRequirement,
					testProcedure: data.testProcedure,
					dependencies: data.dependencies,
					references: data.references,
					commonPitfalls: data.commonPitfalls,
					lastImportId: versionId,
				})
				.returning()

			// Create technology element junction entries for new controls
			await syncControlTechElements(inserted.id, data.technologyElement, techElementByName)
		}
	}

	// Archive removed controls
	for (const existing of liveControls) {
		if (!parsedControls.has(existing.controlId)) {
			await db.update(frameworkControls).set({ archivedAt: now }).where(eq(frameworkControls.id, existing.id))
		}
	}

	// --- RISK-CONTROL MAPPINGS ---
	// Rebuild: fetch current live controls/risks for UUID lookup
	const currentControls = await db.select().from(frameworkControls).where(isNull(frameworkControls.archivedAt))
	const currentRisks = await db.select().from(frameworkRisks).where(isNull(frameworkRisks.archivedAt))
	const controlIdToUuid = new Map(currentControls.map((c) => [c.controlId, c.id]))
	const riskIdToUuid = new Map(currentRisks.map((r) => [r.riskId, r.id]))

	// Get existing mappings
	const existingMappings = await db.select().from(frameworkRiskControlMappings)
	const existingMappingKeys = new Map<string, string>()
	for (const m of existingMappings) {
		existingMappingKeys.set(`${m.riskId}::${m.controlId}`, m.id)
	}

	// Build desired mapping set with UUIDs
	const desiredMappingKeys = new Set<string>()
	for (const key of parsedMappings) {
		const [riskBizId, controlBizId] = key.split("::")
		const riskUuid = riskIdToUuid.get(riskBizId)
		const controlUuid = controlIdToUuid.get(controlBizId)
		if (riskUuid && controlUuid) {
			desiredMappingKeys.add(`${riskUuid}::${controlUuid}`)
		}
	}

	// Delete removed mappings
	for (const [key, id] of existingMappingKeys) {
		if (!desiredMappingKeys.has(key)) {
			await db.delete(frameworkRiskControlMappings).where(eq(frameworkRiskControlMappings.id, id))
		}
	}

	// Insert new mappings
	for (const key of desiredMappingKeys) {
		if (!existingMappingKeys.has(key)) {
			const [riskUuid, controlUuid] = key.split("::")
			await db.insert(frameworkRiskControlMappings).values({
				riskId: riskUuid,
				controlId: controlUuid,
			})
		}
	}

	// --- HANDLE INVALIDATED CONTROLS ---
	if (invalidatedControlIds.length > 0) {
		for (const controlBizId of invalidatedControlIds) {
			const controlUuid = controlIdToUuid.get(controlBizId)
			if (controlUuid) {
				await db.delete(complianceAssessments).where(eq(complianceAssessments.controlId, controlUuid))
			}
		}
	}

	// Mark import as applied
	await db
		.update(frameworkVersions)
		.set({ status: "applied", activatedAt: now, activatedBy: appliedBy })
		.where(eq(frameworkVersions.id, versionId))

	await writeAuditLog({
		action: "framework_activated",
		entityType: "framework_version",
		entityId: versionId,
		newValue: version.sourceFileName,
		performedBy: appliedBy,
	})
}

// Keep backward-compatible alias
export const activateFrameworkVersion = (versionId: string, activatedBy: string, parsed?: ParsedFramework) =>
	applyFrameworkImport(versionId, parsed!, activatedBy)

/** Get the current pending framework import, or null. */
export async function getPendingFrameworkImport() {
	const [version] = await db.select().from(frameworkVersions).where(eq(frameworkVersions.status, "pending")).limit(1)
	return version ?? null
}

// Keep backward-compatible alias
export const getStagingFrameworkVersion = getPendingFrameworkImport

/** Get all framework versions ordered by creation date (newest first). */
export async function getFrameworkVersionHistory() {
	return db.select().from(frameworkVersions).orderBy(desc(frameworkVersions.createdAt))
}

/** Compare parsed import data against live data and return a structured diff. */
export async function computeImportDiff(parsed: ParsedFramework) {
	// Build parsed data maps
	const parsedDomainMap = new Map<string, string>()
	for (const row of parsed.rows) {
		const code = row.riskId.match(/R-([A-Z]{2})\./)?.[1] ?? row.domain.slice(0, 2).toUpperCase()
		if (!parsedDomainMap.has(code)) {
			parsedDomainMap.set(code, row.domain)
		}
	}

	const parsedRiskMap = new Map<string, { description: string }>()
	const parsedControlMap = new Map<string, Record<string, string | null>>()

	for (const row of parsed.rows) {
		if (!parsedRiskMap.has(row.riskId)) {
			parsedRiskMap.set(row.riskId, { description: row.riskDescription })
		}
		if (!parsedControlMap.has(row.controlId)) {
			parsedControlMap.set(row.controlId, {
				technologyElement: row.technologyElement,
				requirement: row.requirement,
				responsible: row.responsible,
				routine: row.routine,
				frequency: row.frequency,
				documentationRequirement: row.documentationRequirement,
				testProcedure: row.testProcedure,
				dependencies: row.dependencies,
				references: row.references,
				commonPitfalls: row.commonPitfalls,
			})
		}
	}

	// Load all technology elements for name matching
	const allTechElements = await db.select().from(technologyElements)
	const techElementByName = new Map(allTechElements.map((e) => [e.name.toLowerCase().trim(), e]))

	// Collect new technology elements that will be auto-created on activation
	const newTechnologyElements: { controlId: string; name: string; description: string | null }[] = []
	for (const [controlId, data] of parsedControlMap) {
		if (data.technologyElement) {
			const parsed = parseTechnologyElements(data.technologyElement)
			for (const { name, description } of parsed) {
				if (!techElementByName.has(name.toLowerCase())) {
					newTechnologyElements.push({ controlId, name, description })
				}
			}
		}
	}

	// Fetch live data
	const liveDomains = await db.select().from(frameworkDomains).where(isNull(frameworkDomains.archivedAt))
	const liveRisks = await db.select().from(frameworkRisks).where(isNull(frameworkRisks.archivedAt))
	const liveControls = await db.select().from(frameworkControls).where(isNull(frameworkControls.archivedAt))

	const isFirstImport = liveDomains.length === 0 && liveRisks.length === 0 && liveControls.length === 0

	if (isFirstImport) {
		return {
			isFirstImport: true as const,
			added: {
				risks: [] as { riskId: string; description: string }[],
				controls: [] as { controlId: string; requirement: string | null }[],
				domains: [] as { code: string; name: string }[],
			},
			removed: {
				risks: [] as { riskId: string; description: string }[],
				controls: [] as { controlId: string; requirement: string | null }[],
				domains: [] as { code: string; name: string }[],
			},
			changed: {
				risks: [] as {
					riskId: string
					fields: { field: string; oldValue: string | null; newValue: string | null }[]
				}[],
				controls: [] as {
					controlId: string
					fields: { field: string; oldValue: string | null; newValue: string | null }[]
				}[],
			},
			unmatchedTechnologyElements: newTechnologyElements.map((e) => ({
				controlId: e.controlId,
				text: e.name,
				description: e.description,
			})),
		}
	}

	const liveDomainCodes = new Map(liveDomains.map((d) => [d.code, d]))
	const liveRiskIds = new Map(liveRisks.map((r) => [r.riskId, r]))
	const liveControlIds = new Map(liveControls.map((c) => [c.controlId, c]))

	// Domains diff
	const addedDomains = [...parsedDomainMap.entries()]
		.filter(([code]) => !liveDomainCodes.has(code))
		.map(([code, name]) => ({ code, name }))
	const removedDomains = liveDomains
		.filter((d) => !parsedDomainMap.has(d.code))
		.map((d) => ({ code: d.code, name: d.name }))

	// Risks diff
	const addedRisks = [...parsedRiskMap.entries()]
		.filter(([riskId]) => !liveRiskIds.has(riskId))
		.map(([riskId, data]) => ({ riskId, description: data.description }))
	const removedRisks = liveRisks
		.filter((r) => !parsedRiskMap.has(r.riskId))
		.map((r) => ({ riskId: r.riskId, description: r.description }))

	const changedRisks: {
		riskId: string
		fields: { field: string; oldValue: string | null; newValue: string | null }[]
	}[] = []
	for (const [riskId, data] of parsedRiskMap) {
		const live = liveRiskIds.get(riskId)
		if (!live) continue
		const fields: { field: string; oldValue: string | null; newValue: string | null }[] = []
		if ((live.description ?? null) !== (data.description ?? null)) {
			fields.push({ field: "description", oldValue: live.description ?? null, newValue: data.description ?? null })
		}
		if (fields.length > 0) changedRisks.push({ riskId, fields })
	}

	// Controls diff
	const addedControls = [...parsedControlMap.entries()]
		.filter(([controlId]) => !liveControlIds.has(controlId))
		.map(([controlId, data]) => ({ controlId, requirement: data.requirement ?? null }))
	const removedControls = liveControls
		.filter((c) => !parsedControlMap.has(c.controlId))
		.map((c) => ({ controlId: c.controlId, requirement: c.requirement }))

	const controlCompareFields = [
		"technologyElement",
		"requirement",
		"responsible",
		"routine",
		"frequency",
		"documentationRequirement",
		"testProcedure",
		"dependencies",
		"references",
		"commonPitfalls",
	] as const

	const changedControls: {
		controlId: string
		fields: { field: string; oldValue: string | null; newValue: string | null }[]
	}[] = []
	for (const [controlId, data] of parsedControlMap) {
		const live = liveControlIds.get(controlId)
		if (!live) continue
		const fields: { field: string; oldValue: string | null; newValue: string | null }[] = []
		for (const field of controlCompareFields) {
			const oldVal = live[field] ?? null
			const newVal = data[field] ?? null
			if (oldVal !== newVal) {
				fields.push({ field, oldValue: oldVal, newValue: newVal })
			}
		}
		// Include cronFrequency diff
		const newCron = deriveCronFrequency(data.frequency)
		if (newCron !== null) {
			const oldCron = live.cronFrequency ?? null
			if (oldCron !== newCron) {
				fields.push({ field: "cronFrequency", oldValue: oldCron, newValue: newCron })
			}
		}
		if (fields.length > 0) changedControls.push({ controlId, fields })
	}

	return {
		isFirstImport: false as const,
		added: { risks: addedRisks, controls: addedControls, domains: addedDomains },
		removed: { risks: removedRisks, controls: removedControls, domains: removedDomains },
		changed: { risks: changedRisks, controls: changedControls },
		unmatchedTechnologyElements: newTechnologyElements.map((e) => ({
			controlId: e.controlId,
			text: e.name,
			description: e.description,
		})),
	}
}

// Keep backward-compatible alias
export const getStagingDiff = async () => {
	const pending = await getPendingFrameworkImport()
	if (!pending) return null
	// Re-parse the file is not practical here, so we compute from live vs pending metadata
	// For the route, we store parsed data and pass it through
	return null
}

// ── Predefined answers ──

export async function addPredefinedAnswer(
	controlIdStr: string,
	label: string,
	status: string,
	comment: string | null,
	performedBy: string,
) {
	const [ctrl] = await db
		.select({ id: frameworkControls.id })
		.from(frameworkControls)
		.where(sql`${frameworkControls.archivedAt} IS NULL AND ${frameworkControls.controlId} = ${controlIdStr}`)
		.limit(1)
	if (!ctrl) throw new Error(`Kontroll ${controlIdStr} ikke funnet`)

	const [maxOrder] = await db
		.select({ max: sql<number>`COALESCE(MAX(${controlPredefinedAnswers.displayOrder}), -1)` })
		.from(controlPredefinedAnswers)
		.where(eq(controlPredefinedAnswers.controlId, ctrl.id))

	const [inserted] = await db
		.insert(controlPredefinedAnswers)
		.values({
			controlId: ctrl.id,
			label,
			status,
			comment,
			displayOrder: (maxOrder?.max ?? -1) + 1,
			createdBy: performedBy,
			updatedBy: performedBy,
		})
		.returning()

	await writeAuditLog({
		action: "predefined_answer_created",
		entityType: "control",
		entityId: ctrl.id,
		newValue: JSON.stringify({ label, status, comment }),
		performedBy,
	})

	return inserted
}

export async function updatePredefinedAnswer(
	answerId: string,
	updates: { label?: string; status?: string; comment?: string | null; displayOrder?: number },
	performedBy: string,
) {
	const [existing] = await db
		.select()
		.from(controlPredefinedAnswers)
		.where(eq(controlPredefinedAnswers.id, answerId))
		.limit(1)
	if (!existing) throw new Error("Forhåndsdefinert svar ikke funnet")

	const [updated] = await db
		.update(controlPredefinedAnswers)
		.set({
			...(updates.label !== undefined && { label: updates.label }),
			...(updates.status !== undefined && { status: updates.status }),
			...(updates.comment !== undefined && { comment: updates.comment }),
			...(updates.displayOrder !== undefined && { displayOrder: updates.displayOrder }),
			updatedBy: performedBy,
			updatedAt: new Date(),
		})
		.where(eq(controlPredefinedAnswers.id, answerId))
		.returning()

	await writeAuditLog({
		action: "predefined_answer_updated",
		entityType: "control",
		entityId: existing.controlId,
		newValue: JSON.stringify(updates),
		performedBy,
	})

	return updated
}

export async function deletePredefinedAnswer(answerId: string, performedBy: string) {
	const [existing] = await db
		.select()
		.from(controlPredefinedAnswers)
		.where(eq(controlPredefinedAnswers.id, answerId))
		.limit(1)
	if (!existing) throw new Error("Forhåndsdefinert svar ikke funnet")

	await db.delete(controlPredefinedAnswers).where(eq(controlPredefinedAnswers.id, answerId))

	await writeAuditLog({
		action: "predefined_answer_deleted",
		entityType: "control",
		entityId: existing.controlId,
		newValue: JSON.stringify({ label: existing.label }),
		performedBy,
	})
}

export async function getPredefinedAnswersForControl(controlUuid: string) {
	return db
		.select()
		.from(controlPredefinedAnswers)
		.where(eq(controlPredefinedAnswers.controlId, controlUuid))
		.orderBy(controlPredefinedAnswers.displayOrder)
}

// ─── Domain CRUD ─────────────────────────────────────────────────────────

/** Get all active (non-archived) domains. */
export async function getAllActiveDomains() {
	return db
		.select()
		.from(frameworkDomains)
		.where(isNull(frameworkDomains.archivedAt))
		.orderBy(frameworkDomains.displayOrder)
}

/** Get a domain by ID with counts of associated risks and controls. */
export async function getDomainWithCounts(domainId: string) {
	const [domain] = await db.select().from(frameworkDomains).where(eq(frameworkDomains.id, domainId)).limit(1)
	if (!domain) return null

	const [riskRow] = await db
		.select({ count: count() })
		.from(frameworkRisks)
		.where(and(eq(frameworkRisks.domainId, domainId), isNull(frameworkRisks.archivedAt)))

	const controlRows = await db
		.selectDistinctOn([frameworkRiskControlMappings.controlId], {
			controlId: frameworkRiskControlMappings.controlId,
		})
		.from(frameworkRiskControlMappings)
		.innerJoin(frameworkRisks, eq(frameworkRiskControlMappings.riskId, frameworkRisks.id))
		.innerJoin(frameworkControls, eq(frameworkRiskControlMappings.controlId, frameworkControls.id))
		.where(
			and(
				eq(frameworkRisks.domainId, domainId),
				isNull(frameworkRisks.archivedAt),
				isNull(frameworkControls.archivedAt),
			),
		)

	return {
		...domain,
		riskCount: riskRow?.count ?? 0,
		controlCount: controlRows.length,
	}
}

/** Create a new domain. */
export async function createDomain(code: string, name: string, displayOrder: number, performedBy: string) {
	const [domain] = await db
		.insert(frameworkDomains)
		.values({ code, name, displayOrder })
		.returning({ id: frameworkDomains.id })

	await writeAuditLog({
		action: "domain_created",
		entityType: "framework_domain",
		entityId: domain.id,
		newValue: JSON.stringify({ code, name, displayOrder }),
		performedBy,
	})

	return domain.id
}

/** Update a domain's code, name, and display order. */
export async function updateDomain(
	domainId: string,
	code: string,
	name: string,
	displayOrder: number,
	performedBy: string,
) {
	const [existing] = await db.select().from(frameworkDomains).where(eq(frameworkDomains.id, domainId)).limit(1)
	if (!existing) throw new Error("Domenet finnes ikke.")

	await db.update(frameworkDomains).set({ code, name, displayOrder }).where(eq(frameworkDomains.id, domainId))

	await writeAuditLog({
		action: "domain_updated",
		entityType: "framework_domain",
		entityId: domainId,
		previousValue: JSON.stringify({ code: existing.code, name: existing.name, displayOrder: existing.displayOrder }),
		newValue: JSON.stringify({ code, name, displayOrder }),
		performedBy,
	})
}

/** Delete (archive) a domain. Throws if risks still reference it. */
export async function deleteDomain(domainId: string, performedBy: string) {
	const [riskRow] = await db
		.select({ count: count() })
		.from(frameworkRisks)
		.where(and(eq(frameworkRisks.domainId, domainId), isNull(frameworkRisks.archivedAt)))

	if ((riskRow?.count ?? 0) > 0) {
		throw new Error(`Kan ikke slette domenet: ${riskRow?.count} risikoer er fortsatt tilknyttet.`)
	}

	const [domain] = await db.select().from(frameworkDomains).where(eq(frameworkDomains.id, domainId)).limit(1)
	if (!domain) throw new Error("Domenet finnes ikke.")

	await db.update(frameworkDomains).set({ archivedAt: new Date() }).where(eq(frameworkDomains.id, domainId))

	await writeAuditLog({
		action: "domain_deleted",
		entityType: "framework_domain",
		entityId: domainId,
		previousValue: JSON.stringify({ code: domain.code, name: domain.name }),
		performedBy,
	})
}

/** Move a risk to a different domain. */
export async function updateRiskDomain(riskIdStr: string, newDomainId: string, performedBy: string) {
	const [risk] = await db
		.select()
		.from(frameworkRisks)
		.where(sql`${frameworkRisks.archivedAt} IS NULL AND ${frameworkRisks.riskId} = ${riskIdStr}`)
		.limit(1)

	if (!risk) throw new Error(`Risiko ${riskIdStr} finnes ikke.`)

	const [oldDomain] = await db.select().from(frameworkDomains).where(eq(frameworkDomains.id, risk.domainId)).limit(1)
	const [newDomain] = await db.select().from(frameworkDomains).where(eq(frameworkDomains.id, newDomainId)).limit(1)

	if (!newDomain) throw new Error("Nytt domene finnes ikke.")

	await db.update(frameworkRisks).set({ domainId: newDomainId }).where(eq(frameworkRisks.id, risk.id))

	await writeAuditLog({
		action: "risk_domain_changed",
		entityType: "framework_risk",
		entityId: risk.riskId,
		previousValue: oldDomain?.name ?? risk.domainId,
		newValue: newDomain.name,
		performedBy,
	})
}

// ─── Control → Domain helpers (transitive via risks) ─────────────────────

interface ControlDomain {
	domainId: string
	domainCode: string
	domainName: string
	displayOrder: number
}

/** Get all domains a control belongs to (via its mapped risks). */
export async function getControlDomains(controlUuid: string): Promise<ControlDomain[]> {
	const rows = await db
		.selectDistinctOn([frameworkDomains.id], {
			domainId: frameworkDomains.id,
			domainCode: frameworkDomains.code,
			domainName: frameworkDomains.name,
			displayOrder: frameworkDomains.displayOrder,
		})
		.from(frameworkRiskControlMappings)
		.innerJoin(frameworkRisks, eq(frameworkRiskControlMappings.riskId, frameworkRisks.id))
		.innerJoin(frameworkDomains, eq(frameworkRisks.domainId, frameworkDomains.id))
		.where(
			and(
				eq(frameworkRiskControlMappings.controlId, controlUuid),
				isNull(frameworkRisks.archivedAt),
				isNull(frameworkDomains.archivedAt),
			),
		)
		.orderBy(frameworkDomains.id, frameworkDomains.displayOrder)

	return rows
}

/** Get the primary (lowest displayOrder) domain for a control. */
export async function getControlPrimaryDomain(controlUuid: string): Promise<ControlDomain | null> {
	const domains = await getControlDomains(controlUuid)
	if (domains.length === 0) return null
	return domains.sort((a, b) => a.displayOrder - b.displayOrder)[0]
}

/**
 * Batch: build a map of controlId → ControlDomain[] for a set of controls.
 * Much more efficient than calling getControlDomains() per control.
 */
export async function getControlDomainMap(controlUuids: string[]): Promise<Map<string, ControlDomain[]>> {
	const result = new Map<string, ControlDomain[]>()
	if (controlUuids.length === 0) return result

	const rows = await db
		.select({
			controlId: frameworkRiskControlMappings.controlId,
			domainId: frameworkDomains.id,
			domainCode: frameworkDomains.code,
			domainName: frameworkDomains.name,
			displayOrder: frameworkDomains.displayOrder,
		})
		.from(frameworkRiskControlMappings)
		.innerJoin(frameworkRisks, eq(frameworkRiskControlMappings.riskId, frameworkRisks.id))
		.innerJoin(frameworkDomains, eq(frameworkRisks.domainId, frameworkDomains.id))
		.where(
			and(
				sql`${frameworkRiskControlMappings.controlId} IN ${controlUuids}`,
				isNull(frameworkRisks.archivedAt),
				isNull(frameworkDomains.archivedAt),
			),
		)
		.orderBy(frameworkDomains.displayOrder)

	for (const row of rows) {
		const list = result.get(row.controlId) ?? []
		// Deduplicate by domainId
		if (!list.some((d) => d.domainId === row.domainId)) {
			list.push({
				domainId: row.domainId,
				domainCode: row.domainCode,
				domainName: row.domainName,
				displayOrder: row.displayOrder,
			})
		}
		result.set(row.controlId, list)
	}

	return result
}

/** Get controls that a given control depends on. */
export async function getControlDependencies(controlUuid: string) {
	const rows = await db
		.select({
			id: frameworkControls.id,
			controlId: frameworkControls.controlId,
			shortTitle: frameworkControls.shortTitle,
			requirement: frameworkControls.requirement,
		})
		.from(controlDependencies)
		.innerJoin(frameworkControls, eq(controlDependencies.dependsOnControlId, frameworkControls.id))
		.where(eq(controlDependencies.controlId, controlUuid))
		.orderBy(frameworkControls.controlId)
	return rows.map((r) => ({
		id: r.id,
		controlId: r.controlId,
		name: r.shortTitle || shortName(r.requirement, r.controlId),
	}))
}

/** Get controls that depend on a given control (reverse dependencies). */
export async function getControlDependents(controlUuid: string) {
	const rows = await db
		.select({
			id: frameworkControls.id,
			controlId: frameworkControls.controlId,
			shortTitle: frameworkControls.shortTitle,
			requirement: frameworkControls.requirement,
		})
		.from(controlDependencies)
		.innerJoin(frameworkControls, eq(controlDependencies.controlId, frameworkControls.id))
		.where(eq(controlDependencies.dependsOnControlId, controlUuid))
		.orderBy(frameworkControls.controlId)
	return rows.map((r) => ({
		id: r.id,
		controlId: r.controlId,
		name: r.shortTitle || shortName(r.requirement, r.controlId),
	}))
}

/** Add a dependency between controls. */
export async function addControlDependency(controlUuid: string, dependsOnUuid: string, performer: string) {
	await db
		.insert(controlDependencies)
		.values({ controlId: controlUuid, dependsOnControlId: dependsOnUuid })
		.onConflictDoNothing()
	await writeAuditLog({
		action: "control_dependency_added",
		entityType: "control_dependency",
		entityId: controlUuid,
		newValue: JSON.stringify({ controlId: controlUuid, dependsOnControlId: dependsOnUuid }),
		performedBy: performer,
	})
}

/** Remove a dependency between controls. */
export async function removeControlDependency(controlUuid: string, dependsOnUuid: string, performer: string) {
	await db
		.delete(controlDependencies)
		.where(
			and(eq(controlDependencies.controlId, controlUuid), eq(controlDependencies.dependsOnControlId, dependsOnUuid)),
		)
	await writeAuditLog({
		action: "control_dependency_removed",
		entityType: "control_dependency",
		entityId: controlUuid,
		previousValue: JSON.stringify({ controlId: controlUuid, dependsOnControlId: dependsOnUuid }),
		performedBy: performer,
	})
}

/** Get all non-archived controls (for dependency selection). */
export async function getAllControlsForSelection() {
	const rows = await db
		.select({
			id: frameworkControls.id,
			controlId: frameworkControls.controlId,
			shortTitle: frameworkControls.shortTitle,
			requirement: frameworkControls.requirement,
		})
		.from(frameworkControls)
		.where(isNull(frameworkControls.archivedAt))
		.orderBy(frameworkControls.controlId)
	return rows.map((r) => ({
		id: r.id,
		controlId: r.controlId,
		name: r.shortTitle || shortName(r.requirement, r.controlId),
	}))
}
