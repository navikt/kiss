import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import { db } from "../connection.server"
import { applicationPersistence, monitoredApplications } from "../schema/applications"
import { applicationTechnologyElements, controlTechnologyElements, technologyElements } from "../schema/framework"
import { writeAuditLog } from "./audit.server"

/** Get all technology elements ordered by display order. */
export async function getAllTechnologyElements() {
	return db.select().from(technologyElements).orderBy(technologyElements.displayOrder)
}

/** Get technology elements for a specific control. */
export async function getControlElements(controlUuid: string) {
	return db
		.select({
			id: technologyElements.id,
			name: technologyElements.name,
			slug: technologyElements.slug,
		})
		.from(controlTechnologyElements)
		.innerJoin(technologyElements, eq(controlTechnologyElements.elementId, technologyElements.id))
		.where(eq(controlTechnologyElements.controlId, controlUuid))
		.orderBy(technologyElements.displayOrder)
}

/** Get technology elements for a specific application. */
export async function getApplicationElements(appId: string) {
	return db
		.select({
			id: technologyElements.id,
			name: technologyElements.name,
			slug: technologyElements.slug,
			source: applicationTechnologyElements.source,
			linkId: applicationTechnologyElements.id,
			confirmedAt: applicationTechnologyElements.confirmedAt,
			confirmedBy: applicationTechnologyElements.confirmedBy,
			rejectedAt: applicationTechnologyElements.rejectedAt,
			rejectedBy: applicationTechnologyElements.rejectedBy,
			rejectionReason: applicationTechnologyElements.rejectionReason,
		})
		.from(applicationTechnologyElements)
		.innerJoin(technologyElements, eq(applicationTechnologyElements.elementId, technologyElements.id))
		.where(eq(applicationTechnologyElements.applicationId, appId))
		.orderBy(technologyElements.displayOrder)
}

/** Create a new technology element. */
export async function createTechnologyElement(
	name: string,
	slug: string,
	description: string | null,
	displayOrder: number,
	performer: string,
) {
	const [el] = await db.insert(technologyElements).values({ name, slug, description, displayOrder }).returning()
	await writeAuditLog({
		action: "technology_element_created",
		entityType: "technology_element",
		entityId: el.id,
		newValue: JSON.stringify({ name, slug }),
		performedBy: performer,
	})
	return el
}

/** Update a technology element. */
export async function updateTechnologyElement(
	id: string,
	updates: { name?: string; slug?: string; description?: string | null; displayOrder?: number },
	performer: string,
) {
	const [el] = await db.update(technologyElements).set(updates).where(eq(technologyElements.id, id)).returning()
	await writeAuditLog({
		action: "technology_element_updated",
		entityType: "technology_element",
		entityId: id,
		newValue: JSON.stringify(updates),
		performedBy: performer,
	})
	return el
}

/** Delete a technology element. First check if it's used by any controls or apps. */
export async function deleteTechnologyElement(id: string, performer: string) {
	const controlUsage = await db
		.select({ count: sql<number>`count(*)` })
		.from(controlTechnologyElements)
		.where(eq(controlTechnologyElements.elementId, id))
	if (Number(controlUsage[0].count) > 0) {
		throw new Error(`Kan ikke slette: elementet er brukt av ${controlUsage[0].count} kontroll(er)`)
	}
	const appUsage = await db
		.select({ count: sql<number>`count(*)` })
		.from(applicationTechnologyElements)
		.where(eq(applicationTechnologyElements.elementId, id))
	if (Number(appUsage[0].count) > 0) {
		throw new Error(`Kan ikke slette: elementet er brukt av ${appUsage[0].count} applikasjon(er)`)
	}
	await db.delete(technologyElements).where(eq(technologyElements.id, id))
	await writeAuditLog({
		action: "technology_element_deleted",
		entityType: "technology_element",
		entityId: id,
		performedBy: performer,
	})
}

/** Get a single technology element with usage counts. */
export async function getTechnologyElementWithCounts(id: string) {
	const [el] = await db.select().from(technologyElements).where(eq(technologyElements.id, id))
	if (!el) return null
	const controlCount = await db
		.select({ count: sql<number>`count(*)` })
		.from(controlTechnologyElements)
		.where(eq(controlTechnologyElements.elementId, id))
	const appCount = await db
		.select({ count: sql<number>`count(*)` })
		.from(applicationTechnologyElements)
		.innerJoin(monitoredApplications, eq(applicationTechnologyElements.applicationId, monitoredApplications.id))
		.where(and(eq(applicationTechnologyElements.elementId, id), isNull(monitoredApplications.primaryApplicationId)))
	return { ...el, controlCount: Number(controlCount[0].count), appCount: Number(appCount[0].count) }
}

/** Add a technology element to a control. */
export async function addControlElement(controlId: string, elementId: string, performer: string) {
	await db.insert(controlTechnologyElements).values({ controlId, elementId }).onConflictDoNothing()
	await writeAuditLog({
		action: "control_element_added",
		entityType: "control_technology_element",
		entityId: controlId,
		newValue: JSON.stringify({ controlId, elementId }),
		performedBy: performer,
	})
}

/** Remove a technology element from a control. */
export async function removeControlElement(controlId: string, elementId: string, performer: string) {
	await db
		.delete(controlTechnologyElements)
		.where(and(eq(controlTechnologyElements.controlId, controlId), eq(controlTechnologyElements.elementId, elementId)))
	await writeAuditLog({
		action: "control_element_removed",
		entityType: "control_technology_element",
		entityId: controlId,
		newValue: JSON.stringify({ controlId, elementId }),
		performedBy: performer,
	})
}

/** Mapping from persistence/auth types to technology element slugs. */
const PERSISTENCE_TO_ELEMENT: Record<string, string> = {
	cloud_sql_postgres: "database",
	nais_postgres: "database",
	on_prem_postgres: "database",
	oracle: "database",
	opensearch: "database",
	bucket: "database",
	valkey: "database",
}

const AUTH_TO_ELEMENT: Record<string, string> = {
	entra_id: "active-directory",
}

/**
 * Auto-detect and sync technology elements for an application based on
 * its persistence types and auth integrations from Nais.
 * Always assigns "Applikasjon" and "Plattformer" for Nais-synced apps.
 */
export async function syncApplicationTechnologyElements(appId: string) {
	const allElements = await getAllTechnologyElements()
	const elementBySlug = new Map(allElements.map((e) => [e.slug, e.id]))

	// Determine which elements apply
	const elementIds = new Set<string>()

	// All apps get "Applikasjon"
	const appElementId = elementBySlug.get("applikasjon")
	if (appElementId) elementIds.add(appElementId)

	// All Nais-synced apps get "Plattformer"
	const platformId = elementBySlug.get("plattformer")
	if (platformId) elementIds.add(platformId)

	// Check persistence types
	const persistence = await db
		.select({ type: applicationPersistence.type })
		.from(applicationPersistence)
		.where(eq(applicationPersistence.applicationId, appId))

	for (const p of persistence) {
		const slug = PERSISTENCE_TO_ELEMENT[p.type]
		if (slug) {
			const elemId = elementBySlug.get(slug)
			if (elemId) elementIds.add(elemId)
		}
	}

	// Check auth integrations
	const authRows = await db.execute(sql`SELECT type FROM application_auth_integrations WHERE application_id = ${appId}`)
	for (const row of authRows.rows) {
		const authType = (row as { type: string }).type
		const slug = AUTH_TO_ELEMENT[authType]
		if (slug) {
			const elemId = elementBySlug.get(slug)
			if (elemId) elementIds.add(elemId)
		}
	}

	// Upsert: insert new auto-detected elements, don't touch manual ones
	for (const elementId of elementIds) {
		await db
			.insert(applicationTechnologyElements)
			.values({
				applicationId: appId,
				elementId,
				source: "auto",
			})
			.onConflictDoNothing()
	}

	// Remove auto-detected elements that no longer apply (but keep manual and rejected)
	const currentAuto = await db
		.select({
			id: applicationTechnologyElements.id,
			elementId: applicationTechnologyElements.elementId,
			rejectedAt: applicationTechnologyElements.rejectedAt,
		})
		.from(applicationTechnologyElements)
		.where(
			and(eq(applicationTechnologyElements.applicationId, appId), eq(applicationTechnologyElements.source, "auto")),
		)

	for (const row of currentAuto) {
		if (!elementIds.has(row.elementId) && !row.rejectedAt) {
			await db.delete(applicationTechnologyElements).where(eq(applicationTechnologyElements.id, row.id))
		}
	}
}

/** Manually add a technology element to an application. */
export async function addApplicationElement(appId: string, elementId: string) {
	await db
		.insert(applicationTechnologyElements)
		.values({ applicationId: appId, elementId, source: "manual" })
		.onConflictDoNothing()
}

/** Remove a technology element from an application. */
export async function removeApplicationElement(appId: string, elementId: string) {
	await db
		.delete(applicationTechnologyElements)
		.where(
			and(
				eq(applicationTechnologyElements.applicationId, appId),
				eq(applicationTechnologyElements.elementId, elementId),
			),
		)
}

/** Sync technology elements for all monitored applications. */
export async function syncAllApplicationElements() {
	const apps = await db.select({ id: monitoredApplications.id }).from(monitoredApplications)
	for (const app of apps) {
		await syncApplicationTechnologyElements(app.id)
	}
	return apps.length
}

/** Confirm an auto-detected technology element for an application. */
export async function confirmApplicationElement(linkId: string, performedBy: string) {
	const [row] = await db
		.update(applicationTechnologyElements)
		.set({
			confirmedAt: new Date(),
			confirmedBy: performedBy,
			rejectedAt: null,
			rejectedBy: null,
			rejectionReason: null,
		})
		.where(eq(applicationTechnologyElements.id, linkId))
		.returning({
			appId: applicationTechnologyElements.applicationId,
			elementId: applicationTechnologyElements.elementId,
		})

	if (row) {
		await writeAuditLog({
			action: "technology_element_confirmed",
			entityType: "application_technology_element",
			entityId: linkId,
			newValue: "confirmed",
			metadata: { applicationId: row.appId, elementId: row.elementId },
			performedBy,
		})

		// Sync materialized compliance controls after tech element confirmation
		const { syncApplicationControls } = await import("./application-controls.server")
		await syncApplicationControls(row.appId, performedBy)
	}
}

/** Reject an auto-detected technology element for an application. */
export async function rejectApplicationElement(linkId: string, reason: string, performedBy: string) {
	const [row] = await db
		.update(applicationTechnologyElements)
		.set({
			rejectedAt: new Date(),
			rejectedBy: performedBy,
			rejectionReason: reason,
			confirmedAt: null,
			confirmedBy: null,
		})
		.where(eq(applicationTechnologyElements.id, linkId))
		.returning({
			appId: applicationTechnologyElements.applicationId,
			elementId: applicationTechnologyElements.elementId,
		})

	if (row) {
		await writeAuditLog({
			action: "technology_element_rejected",
			entityType: "application_technology_element",
			entityId: linkId,
			newValue: reason,
			metadata: { applicationId: row.appId, elementId: row.elementId },
			performedBy,
		})

		// Sync materialized compliance controls after tech element rejection
		const { syncApplicationControls } = await import("./application-controls.server")
		await syncApplicationControls(row.appId, performedBy)
	}
}
