import { count, eq, sql } from "drizzle-orm"
import { db } from "../connection.server"
import {
	frameworkControls,
	frameworkDomains,
	frameworkRiskControlMappings,
	frameworkRisks,
	frameworkVersions,
} from "../schema/framework"

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
				controls.push({ id: ctrl.controlId, name: ctrl.controlId })
			}
		}

		risksWithControls.push({
			id: risk.riskId,
			name: risk.description,
			controls,
		})
	}

	return {
		code: domain.code,
		name: domain.name,
		risks: risksWithControls,
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
		name: ctrl.controlId,
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
