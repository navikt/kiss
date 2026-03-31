import { and, eq, inArray, sql } from "drizzle-orm"
import { db } from "../connection.server"
import { applicationPersistence, monitoredApplications } from "../schema/applications"
import {
	applicationTechnologyElements,
	controlTechnologyElements,
	frameworkControls,
	technologyElements,
} from "../schema/framework"

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
		})
		.from(applicationTechnologyElements)
		.innerJoin(technologyElements, eq(applicationTechnologyElements.elementId, technologyElements.id))
		.where(eq(applicationTechnologyElements.applicationId, appId))
		.orderBy(technologyElements.displayOrder)
}

/** Get technology element IDs for a set of applications (batch). */
export async function getApplicationElementIds(appIds: string[]): Promise<Map<string, string[]>> {
	if (appIds.length === 0) return new Map()
	const rows = await db
		.select({
			appId: applicationTechnologyElements.applicationId,
			elementId: applicationTechnologyElements.elementId,
		})
		.from(applicationTechnologyElements)
		.where(inArray(applicationTechnologyElements.applicationId, appIds))

	const map = new Map<string, string[]>()
	for (const row of rows) {
		const list = map.get(row.appId) ?? []
		list.push(row.elementId)
		map.set(row.appId, list)
	}
	return map
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

	// Remove auto-detected elements that no longer apply (but keep manual)
	const currentAuto = await db
		.select({ id: applicationTechnologyElements.id, elementId: applicationTechnologyElements.elementId })
		.from(applicationTechnologyElements)
		.where(
			and(eq(applicationTechnologyElements.applicationId, appId), eq(applicationTechnologyElements.source, "auto")),
		)

	for (const row of currentAuto) {
		if (!elementIds.has(row.elementId)) {
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

/**
 * Get the matching element IDs between a control and an application.
 * Returns the intersection of control elements and app elements.
 */
export async function getMatchingElements(controlUuid: string, appId: string) {
	const rows = await db
		.select({
			elementId: technologyElements.id,
			elementName: technologyElements.name,
		})
		.from(controlTechnologyElements)
		.innerJoin(technologyElements, eq(controlTechnologyElements.elementId, technologyElements.id))
		.innerJoin(
			applicationTechnologyElements,
			and(
				eq(applicationTechnologyElements.elementId, technologyElements.id),
				eq(applicationTechnologyElements.applicationId, appId),
			),
		)
		.where(eq(controlTechnologyElements.controlId, controlUuid))
		.orderBy(technologyElements.displayOrder)
	return rows
}

/** Sync technology elements for all monitored applications. */
export async function syncAllApplicationElements() {
	const apps = await db.select({ id: monitoredApplications.id }).from(monitoredApplications)
	for (const app of apps) {
		await syncApplicationTechnologyElements(app.id)
	}
	return apps.length
}
