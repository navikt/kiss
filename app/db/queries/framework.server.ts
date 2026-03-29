import { count, desc, eq, sql } from "drizzle-orm"
import type { ParsedFramework } from "~/lib/excel-parser.server"
import { db } from "../connection.server"
import {
	frameworkControls,
	frameworkDomains,
	frameworkRiskControlMappings,
	frameworkRisks,
	frameworkVersions,
} from "../schema/framework"
import { writeAuditLog } from "./audit.server"

/** Get the active framework version, or null if none exists. */
export async function getActiveFrameworkVersion() {
	const [version] = await db.select().from(frameworkVersions).where(eq(frameworkVersions.status, "active")).limit(1)
	return version ?? null
}

/** Get domain summaries for the active framework version. */
export async function getDomainSummaries() {
	const version = await getActiveFrameworkVersion()
	if (!version) return []

	const domains = await db
		.select()
		.from(frameworkDomains)
		.where(eq(frameworkDomains.versionId, version.id))
		.orderBy(frameworkDomains.displayOrder)

	const result = []
	for (const domain of domains) {
		const [riskRow] = await db
			.select({ count: count() })
			.from(frameworkRisks)
			.where(eq(frameworkRisks.domainId, domain.id))

		const [controlRow] = await db
			.select({ count: count() })
			.from(frameworkControls)
			.where(eq(frameworkControls.domainId, domain.id))

		result.push({
			code: domain.code,
			name: domain.name,
			riskCount: riskRow?.count ?? 0,
			controlCount: controlRow?.count ?? 0,
		})
	}

	return result
}

/** Get all risks across all domains for the active framework version. */
export async function getAllRisks() {
	const version = await getActiveFrameworkVersion()
	if (!version) return []

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
		.where(eq(frameworkRisks.versionId, version.id))
		.orderBy(frameworkDomains.displayOrder, frameworkRisks.riskId)

	return rows.map((r) => ({
		riskId: r.riskId,
		name: r.shortTitle ?? r.description,
		domainCode: r.domainCode,
		domainName: r.domainName,
	}))
}

/** Get all controls across all domains for the active framework version. */
export async function getAllControls() {
	const version = await getActiveFrameworkVersion()
	if (!version) return []

	const rows = await db
		.select({
			controlId: frameworkControls.controlId,
			shortTitle: frameworkControls.shortTitle,
			requirement: frameworkControls.requirement,
			domainCode: frameworkDomains.code,
			domainName: frameworkDomains.name,
			displayOrder: frameworkDomains.displayOrder,
		})
		.from(frameworkControls)
		.innerJoin(frameworkDomains, eq(frameworkControls.domainId, frameworkDomains.id))
		.where(eq(frameworkControls.versionId, version.id))
		.orderBy(frameworkDomains.displayOrder, frameworkControls.controlId)

	return rows.map((r) => ({
		controlId: r.controlId,
		name: r.shortTitle ?? shortName(r.requirement, r.controlId),
		domainCode: r.domainCode,
		domainName: r.domainName,
	}))
}

/** Extract the short title from a requirement field (first line only). */
function shortName(requirement: string | null, fallback: string): string {
	if (!requirement) return fallback
	const firstLine = requirement.split("\n")[0].trim()
	return firstLine || fallback
}

/** Get a domain with its risks and controls. */
export async function getDomainDetail(domainCode: string) {
	const version = await getActiveFrameworkVersion()
	if (!version) return null

	const [domain] = await db
		.select()
		.from(frameworkDomains)
		.where(
			sql`${frameworkDomains.versionId} = ${version.id} AND ${frameworkDomains.code} = ${domainCode.toUpperCase()}`,
		)
		.limit(1)

	if (!domain) return null

	const risks = await db.select().from(frameworkRisks).where(eq(frameworkRisks.domainId, domain.id))

	const risksWithControls = []
	for (const risk of risks) {
		const mappings = await db
			.select({ controlId: frameworkRiskControlMappings.controlId })
			.from(frameworkRiskControlMappings)
			.where(eq(frameworkRiskControlMappings.riskId, risk.id))

		const controls = []
		for (const mapping of mappings) {
			const [ctrl] = await db.select().from(frameworkControls).where(eq(frameworkControls.id, mapping.controlId))
			if (ctrl) {
				controls.push({
					id: ctrl.controlId,
					name: ctrl.shortTitle ?? shortName(ctrl.requirement, ctrl.controlId),
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
	const version = await getActiveFrameworkVersion()
	if (!version) return null

	const [risk] = await db
		.select({
			id: frameworkRisks.id,
			riskId: frameworkRisks.riskId,
			shortTitle: frameworkRisks.shortTitle,
			description: frameworkRisks.description,
			domainCode: frameworkDomains.code,
			domainName: frameworkDomains.name,
		})
		.from(frameworkRisks)
		.innerJoin(frameworkDomains, eq(frameworkRisks.domainId, frameworkDomains.id))
		.where(sql`${frameworkRisks.versionId} = ${version.id} AND ${frameworkRisks.riskId} = ${riskIdStr}`)
		.limit(1)

	if (!risk) return null

	const mappings = await db
		.select({ controlId: frameworkRiskControlMappings.controlId })
		.from(frameworkRiskControlMappings)
		.where(eq(frameworkRiskControlMappings.riskId, risk.id))

	const controls = []
	for (const mapping of mappings) {
		const [ctrl] = await db.select().from(frameworkControls).where(eq(frameworkControls.id, mapping.controlId))
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
		domainCode: risk.domainCode,
		domainName: risk.domainName,
		controls,
	}
}

/** Get full control detail by control ID string (e.g. "K-ST.01"). */
export async function getControlDetail(controlIdStr: string) {
	const version = await getActiveFrameworkVersion()
	if (!version) return null

	const [ctrl] = await db
		.select()
		.from(frameworkControls)
		.where(sql`${frameworkControls.versionId} = ${version.id} AND ${frameworkControls.controlId} = ${controlIdStr}`)
		.limit(1)

	if (!ctrl) return null

	return {
		id: ctrl.controlId,
		name: ctrl.shortTitle ?? shortName(ctrl.requirement, ctrl.controlId),
		teknologielement: ctrl.technologyElement ?? "Ikke spesifisert",
		krav: ctrl.requirement ?? "Ikke spesifisert",
		ansvarlig: ctrl.responsible ?? "Ikke tildelt",
		rutine: ctrl.routine ?? "Ikke definert",
		frekvens: ctrl.frequency ?? "Ikke definert",
		dokumentasjonskrav: ctrl.documentationRequirement ?? "Ikke spesifisert",
		testprosedyre: ctrl.testProcedure ?? "Ikke definert",
		avhengigheter: ctrl.dependencies ?? "Ingen kjente",
		referanser: ctrl.references ?? "Ikke spesifisert",
		vanligeFallgruver: ctrl.commonPitfalls ?? "Ikke dokumentert",
	}
}

/** Update the short title of a risk. */
export async function updateRiskShortTitle(riskId: string, shortTitle: string, performedBy = "system") {
	const version = await getActiveFrameworkVersion()
	if (!version) throw new Error("Ingen aktiv versjon funnet.")

	const [risk] = await db
		.select()
		.from(frameworkRisks)
		.where(sql`${frameworkRisks.versionId} = ${version.id} AND ${frameworkRisks.riskId} = ${riskId}`)
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
	const version = await getActiveFrameworkVersion()
	if (!version) throw new Error("Ingen aktiv versjon funnet.")

	const [ctrl] = await db
		.select()
		.from(frameworkControls)
		.where(sql`${frameworkControls.versionId} = ${version.id} AND ${frameworkControls.controlId} = ${controlIdStr}`)
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

	const version = await getActiveFrameworkVersion()
	if (!version) throw new Error("Ingen aktiv versjon funnet.")

	const [ctrl] = await db
		.select()
		.from(frameworkControls)
		.where(sql`${frameworkControls.versionId} = ${version.id} AND ${frameworkControls.controlId} = ${controlIdStr}`)
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

/** Import parsed framework data into the database as a staging version. */
export async function stageFrameworkVersion(
	parsed: ParsedFramework,
	fileName: string,
	uploadedBy: string,
): Promise<string> {
	// Delete any existing staging version (and its cascaded data)
	const existingStaging = await db
		.select({ id: frameworkVersions.id })
		.from(frameworkVersions)
		.where(eq(frameworkVersions.status, "staging"))

	for (const v of existingStaging) {
		await deleteFrameworkVersionData(v.id)
	}

	// Create new staging version
	const [version] = await db
		.insert(frameworkVersions)
		.values({
			name: fileName.replace(/\.xlsx$/i, ""),
			description: `Importert fra ${fileName}`,
			sourceFileName: fileName,
			sourceBucketPath: `framework-uploads/${Date.now()}-${fileName}`,
			status: "staging",
			createdBy: uploadedBy,
		})
		.returning()

	// Build domain map from parsed rows (domain name → code)
	const domainEntries = new Map<string, string>()
	let displayOrder = 1
	for (const row of parsed.rows) {
		if (!domainEntries.has(row.domain)) {
			const code = row.riskId.match(/R-([A-Z]{2})\./)?.[1] ?? row.domain.slice(0, 2).toUpperCase()
			domainEntries.set(row.domain, code)
		}
	}

	// Insert domains
	const domainUuidMap = new Map<string, string>()
	for (const [name, code] of domainEntries) {
		const [domain] = await db
			.insert(frameworkDomains)
			.values({
				versionId: version.id,
				code,
				name,
				displayOrder: displayOrder++,
			})
			.returning()
		domainUuidMap.set(name, domain.id)
	}

	// Insert risks, controls, and mappings
	const riskUuidMap = new Map<string, string>()
	const controlUuidMap = new Map<string, string>()

	for (const row of parsed.rows) {
		const domainId = domainUuidMap.get(row.domain)
		if (!domainId) continue

		// Insert risk if not already inserted
		if (!riskUuidMap.has(row.riskId)) {
			const [risk] = await db
				.insert(frameworkRisks)
				.values({
					versionId: version.id,
					domainId,
					riskId: row.riskId,
					description: row.riskDescription,
				})
				.returning()
			riskUuidMap.set(row.riskId, risk.id)
		}

		// Insert control if not already inserted
		if (!controlUuidMap.has(row.controlId)) {
			const [ctrl] = await db
				.insert(frameworkControls)
				.values({
					versionId: version.id,
					domainId,
					controlId: row.controlId,
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
				.returning()
			controlUuidMap.set(row.controlId, ctrl.id)
		}

		// Insert risk-control mapping
		const riskUuid = riskUuidMap.get(row.riskId)
		const controlUuid = controlUuidMap.get(row.controlId)
		if (riskUuid && controlUuid) {
			await db.insert(frameworkRiskControlMappings).values({
				versionId: version.id,
				riskId: riskUuid,
				controlId: controlUuid,
			})
		}
	}

	await writeAuditLog({
		action: "framework_imported",
		entityType: "framework_version",
		entityId: version.id,
		newValue: fileName,
		metadata: {
			domainCount: domainEntries.size,
			riskCount: riskUuidMap.size,
			controlCount: controlUuidMap.size,
		},
		performedBy: uploadedBy,
	})

	return version.id
}

/** Activate a staging version: archive the current active version and set the new one as active. */
export async function activateFrameworkVersion(versionId: string, activatedBy: string): Promise<void> {
	const [version] = await db.select().from(frameworkVersions).where(eq(frameworkVersions.id, versionId)).limit(1)

	if (!version) {
		throw new Error("Versjonen finnes ikke.")
	}
	if (version.status !== "staging") {
		throw new Error("Kun versjoner med status «staging» kan aktiveres.")
	}

	// Archive current active version
	const [currentActive] = await db
		.select()
		.from(frameworkVersions)
		.where(eq(frameworkVersions.status, "active"))
		.limit(1)

	if (currentActive) {
		await db.update(frameworkVersions).set({ status: "archived" }).where(eq(frameworkVersions.id, currentActive.id))

		await writeAuditLog({
			action: "framework_archived",
			entityType: "framework_version",
			entityId: currentActive.id,
			previousValue: currentActive.sourceFileName,
			performedBy: activatedBy,
		})
	}

	// Activate the staging version
	await db
		.update(frameworkVersions)
		.set({
			status: "active",
			activatedAt: new Date(),
			activatedBy,
		})
		.where(eq(frameworkVersions.id, versionId))

	await writeAuditLog({
		action: "framework_activated",
		entityType: "framework_version",
		entityId: versionId,
		newValue: version.sourceFileName,
		metadata: { previousVersionId: currentActive?.id ?? null },
		performedBy: activatedBy,
	})
}

/** Get the current staging framework version, or null. */
export async function getStagingFrameworkVersion() {
	const [version] = await db.select().from(frameworkVersions).where(eq(frameworkVersions.status, "staging")).limit(1)
	return version ?? null
}

/** Get all framework versions ordered by creation date (newest first). */
export async function getFrameworkVersionHistory() {
	return db.select().from(frameworkVersions).orderBy(desc(frameworkVersions.createdAt))
}

/** Delete all data for a framework version (mappings, controls, risks, domains, then version). */
async function deleteFrameworkVersionData(versionId: string) {
	await db.delete(frameworkRiskControlMappings).where(eq(frameworkRiskControlMappings.versionId, versionId))
	await db.delete(frameworkControls).where(eq(frameworkControls.versionId, versionId))
	await db.delete(frameworkRisks).where(eq(frameworkRisks.versionId, versionId))
	await db.delete(frameworkDomains).where(eq(frameworkDomains.versionId, versionId))
	await db.delete(frameworkVersions).where(eq(frameworkVersions.id, versionId))
}
