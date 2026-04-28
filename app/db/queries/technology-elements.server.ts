import { and, eq, isNotNull, isNull, sql } from "drizzle-orm"
import { db } from "../connection.server"
import { applicationPersistence, monitoredApplications } from "../schema/applications"
import { applicationTechnologyElements, controlTechnologyElements, technologyElements } from "../schema/framework"
import { writeAuditLog } from "./audit.server"

/** Get all technology elements ordered by display order. Arkiverte elementer ekskluderes som standard. */
export async function getAllTechnologyElements(options: { includeArchived?: boolean } = {}) {
	const where = options.includeArchived ? undefined : isNull(technologyElements.archivedAt)
	return db.select().from(technologyElements).where(where).orderBy(technologyElements.displayOrder)
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
		.where(and(eq(controlTechnologyElements.controlId, controlUuid), isNull(controlTechnologyElements.archivedAt)))
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
		.where(
			and(eq(applicationTechnologyElements.applicationId, appId), isNull(applicationTechnologyElements.archivedAt)),
		)
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

/** Update a technology element. Avviser endringer på arkiverte elementer. */
export async function updateTechnologyElement(
	id: string,
	updates: { name?: string; slug?: string; description?: string | null; displayOrder?: number },
	performer: string,
) {
	const [prev] = await db.select().from(technologyElements).where(eq(technologyElements.id, id)).limit(1)
	if (!prev) throw new Error(`Teknologielement ikke funnet: ${id}`)
	if (prev.archivedAt) throw new Error("Kan ikke oppdatere arkivert teknologielement. Reaktiver elementet først.")
	const [el] = await db
		.update(technologyElements)
		.set(updates)
		.where(and(eq(technologyElements.id, id), isNull(technologyElements.archivedAt)))
		.returning()
	if (!el) throw new Error("Kan ikke oppdatere arkivert teknologielement. Reaktiver elementet først.")
	await writeAuditLog({
		action: "technology_element_updated",
		entityType: "technology_element",
		entityId: id,
		newValue: JSON.stringify(updates),
		performedBy: performer,
	})
	return el
}

/**
 * Arkiverer et teknologielement (soft-delete). Elementet skjules fra
 * brukervendte velgere og auto-detect, men beholder all data og historikk.
 * FK-er forblir gyldige (alle FK-er er nå ON DELETE RESTRICT, så hard delete
 * er umulig).
 *
 * UPDATE er guarded mot `archived_at IS NULL` og audit-loggen skrives kun
 * dersom UPDATE faktisk endret en rad. Idempotent og TOCTOU-sikker.
 * UPDATE og audit-skriving kjører i samme transaksjon (AGENTS.md regel 6).
 */
export async function archiveTechnologyElement(id: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [el] = await tx
			.update(technologyElements)
			.set({ archivedAt: new Date(), archivedBy: performedBy })
			.where(and(eq(technologyElements.id, id), isNull(technologyElements.archivedAt)))
			.returning()
		if (!el) {
			const [existing] = await tx.select().from(technologyElements).where(eq(technologyElements.id, id)).limit(1)
			if (!existing) throw new Error(`Teknologielement ikke funnet: ${id}`)
			return existing
		}
		await writeAuditLog(
			{
				action: "technology_element_archived",
				entityType: "technology_element",
				entityId: id,
				previousValue: el.name,
				performedBy,
			},
			tx,
		)
		return el
	})
}

/** Reaktiverer et arkivert teknologielement. Idempotent og TOCTOU-sikker. */
export async function unarchiveTechnologyElement(id: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [el] = await tx
			.update(technologyElements)
			.set({ archivedAt: null, archivedBy: null })
			.where(and(eq(technologyElements.id, id), isNotNull(technologyElements.archivedAt)))
			.returning()
		if (!el) {
			const [existing] = await tx.select().from(technologyElements).where(eq(technologyElements.id, id)).limit(1)
			if (!existing) throw new Error(`Teknologielement ikke funnet: ${id}`)
			return existing
		}
		await writeAuditLog(
			{
				action: "technology_element_unarchived",
				entityType: "technology_element",
				entityId: id,
				newValue: el.name,
				performedBy,
			},
			tx,
		)
		return el
	})
}

/** Get a single technology element with usage counts. */
export async function getTechnologyElementWithCounts(id: string) {
	const [el] = await db.select().from(technologyElements).where(eq(technologyElements.id, id))
	if (!el) return null
	const controlCount = await db
		.select({ count: sql<number>`count(*)` })
		.from(controlTechnologyElements)
		.where(and(eq(controlTechnologyElements.elementId, id), isNull(controlTechnologyElements.archivedAt)))
	const appCount = await db
		.select({ count: sql<number>`count(*)` })
		.from(applicationTechnologyElements)
		.innerJoin(monitoredApplications, eq(applicationTechnologyElements.applicationId, monitoredApplications.id))
		.where(
			and(
				eq(applicationTechnologyElements.elementId, id),
				isNull(applicationTechnologyElements.archivedAt),
				isNull(monitoredApplications.primaryApplicationId),
			),
		)
	return { ...el, controlCount: Number(controlCount[0].count), appCount: Number(appCount[0].count) }
}

/** Add a technology element to a control. Avviser kobling til arkivert element. */
export async function addControlElement(controlId: string, elementId: string, performer: string) {
	await db.transaction(async (tx) => {
		const [el] = await tx
			.select({ archivedAt: technologyElements.archivedAt })
			.from(technologyElements)
			.where(eq(technologyElements.id, elementId))
			.for("share")
			.limit(1)
		if (!el) throw new Error(`Teknologielement ikke funnet: ${elementId}`)
		if (el.archivedAt) throw new Error("Kan ikke koble kontroll til arkivert teknologielement.")
		// control_technology_elements har partial unique index
		// (control_id, element_id) WHERE archived_at IS NULL — bruk
		// onConflictDoNothing for å unngå TOCTOU-race ved samtidige innsettinger.
		const inserted = await tx
			.insert(controlTechnologyElements)
			.values({ controlId, elementId })
			.onConflictDoNothing({
				target: [controlTechnologyElements.controlId, controlTechnologyElements.elementId],
				where: isNull(controlTechnologyElements.archivedAt),
			})
			.returning({ id: controlTechnologyElements.id })
		if (inserted.length === 0) return
		await writeAuditLog(
			{
				action: "control_element_added",
				entityType: "control_technology_element",
				entityId: controlId,
				newValue: JSON.stringify({ controlId, elementId }),
				performedBy: performer,
			},
			tx,
		)
	})

	// Control-element mapping change affects compliance — sync affected apps (fire-and-forget)
	import("./application-controls.server").then(({ triggerSyncForElement }) =>
		triggerSyncForElement(elementId, performer),
	)
}

/** Soft-delete (arkiver) en teknologielement-kobling fra en kontroll. Auditerer kun ved faktisk arkivering (no-op hvis raden allerede er arkivert). */
export async function removeControlElement(controlId: string, elementId: string, performer: string) {
	await db.transaction(async (tx) => {
		const archived = await tx
			.update(controlTechnologyElements)
			.set({ archivedAt: new Date(), archivedBy: performer })
			.where(
				and(
					eq(controlTechnologyElements.controlId, controlId),
					eq(controlTechnologyElements.elementId, elementId),
					isNull(controlTechnologyElements.archivedAt),
				),
			)
			.returning({ id: controlTechnologyElements.id })
		if (archived.length === 0) return
		await writeAuditLog(
			{
				action: "control_element_removed",
				entityType: "control_technology_element",
				entityId: controlId,
				previousValue: JSON.stringify({
					controlId,
					elementId,
					archivedCount: archived.length,
					archivedIds: archived.map(({ id }) => id),
				}),
				performedBy: performer,
			},
			tx,
		)
	})

	// Control-element mapping change affects compliance — sync affected apps (fire-and-forget)
	import("./application-controls.server").then(({ triggerSyncForElement }) =>
		triggerSyncForElement(elementId, performer),
	)
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
	await db.transaction(async (tx) => {
		// Lås alle technology_elements-rader med FOR SHARE for å hindre at arkivering
		// skjer mellom snapshot og delete-/insert-fasen. Dette gjør hele sync-en
		// atomisk mht. arkivstatus: hvis et element er arkivert ved oppstart bevares
		// eksisterende auto-kobling, og det auto-detecteres ikke på nytt.
		const allElements = await tx
			.select({
				id: technologyElements.id,
				slug: technologyElements.slug,
				archivedAt: technologyElements.archivedAt,
			})
			.from(technologyElements)
			.for("share")
		const elementBySlug = new Map(allElements.map((e) => [e.slug, [e.id, e.archivedAt] as const]))
		const archivedIds = new Set(allElements.filter((e) => e.archivedAt).map((e) => e.id))

		const elementIds = new Set<string>()
		const addIfActive = (slug: string) => {
			const entry = elementBySlug.get(slug)
			if (entry && !entry[1]) elementIds.add(entry[0])
		}

		addIfActive("applikasjon")
		addIfActive("plattformer")

		const persistence = await tx
			.select({ type: applicationPersistence.type })
			.from(applicationPersistence)
			.where(and(eq(applicationPersistence.applicationId, appId), isNull(applicationPersistence.archivedAt)))
		for (const p of persistence) {
			const slug = PERSISTENCE_TO_ELEMENT[p.type]
			if (slug) addIfActive(slug)
		}

		const authRows = await tx.execute(
			sql`SELECT type FROM application_auth_integrations WHERE application_id = ${appId}`,
		)
		for (const row of authRows.rows) {
			const authType = (row as { type: string }).type
			const slug = AUTH_TO_ELEMENT[authType]
			if (slug) addIfActive(slug)
		}

		for (const elementId of elementIds) {
			// applicationTechnologyElements har partial unique index på (applicationId, elementId)
			// WHERE archived_at IS NULL — onConflictDoNothing håndterer kollisjon med aktiv rad.
			const inserted = await tx
				.insert(applicationTechnologyElements)
				.values({
					applicationId: appId,
					elementId,
					source: "auto",
				})
				.onConflictDoNothing({
					target: [applicationTechnologyElements.applicationId, applicationTechnologyElements.elementId],
					where: isNull(applicationTechnologyElements.archivedAt),
				})
				.returning({ id: applicationTechnologyElements.id })
			if (inserted.length > 0) {
				await writeAuditLog(
					{
						action: "application_technology_element_added",
						entityType: "application_technology_element",
						entityId: appId,
						newValue: JSON.stringify({ applicationId: appId, elementId, source: "auto" }),
						metadata: { elementId, source: "auto" },
						performedBy: "system:tech-element-sync",
					},
					tx,
				)
			}
		}

		// Remove auto-detected elements that no longer apply (but keep manual, rejected,
		// og koblinger til arkiverte elementer — arkivering skal ikke fjerne historiske
		// koblinger; admin må eksplisitt fjerne dem hvis ønsket).
		const currentAuto = await tx
			.select({
				id: applicationTechnologyElements.id,
				elementId: applicationTechnologyElements.elementId,
				rejectedAt: applicationTechnologyElements.rejectedAt,
			})
			.from(applicationTechnologyElements)
			.where(
				and(
					eq(applicationTechnologyElements.applicationId, appId),
					eq(applicationTechnologyElements.source, "auto"),
					isNull(applicationTechnologyElements.archivedAt),
				),
			)

		for (const row of currentAuto) {
			if (!elementIds.has(row.elementId) && !row.rejectedAt && !archivedIds.has(row.elementId)) {
				const archived = await tx
					.update(applicationTechnologyElements)
					.set({ archivedAt: new Date(), archivedBy: "system:tech-element-sync" })
					.where(and(eq(applicationTechnologyElements.id, row.id), isNull(applicationTechnologyElements.archivedAt)))
					.returning({ id: applicationTechnologyElements.id })
				if (archived.length > 0) {
					await writeAuditLog(
						{
							action: "application_technology_element_removed",
							entityType: "application_technology_element",
							entityId: appId,
							previousValue: JSON.stringify({ applicationId: appId, elementId: row.elementId, source: "auto" }),
							metadata: { elementId: row.elementId, source: "auto" },
							performedBy: "system:tech-element-sync",
						},
						tx,
					)
				}
			}
		}
	})
}

/** Manually add a technology element to an application. Avviser kobling til arkivert element. */
export async function addApplicationElement(appId: string, elementId: string, performedBy: string) {
	return db.transaction(async (tx) => {
		const [el] = await tx
			.select({ archivedAt: technologyElements.archivedAt })
			.from(technologyElements)
			.where(eq(technologyElements.id, elementId))
			.for("share")
			.limit(1)
		if (!el) throw new Error(`Teknologielement ikke funnet: ${elementId}`)
		if (el.archivedAt) throw new Error("Kan ikke koble applikasjon til arkivert teknologielement.")
		const inserted = await tx
			.insert(applicationTechnologyElements)
			.values({ applicationId: appId, elementId, source: "manual" })
			.onConflictDoNothing({
				target: [applicationTechnologyElements.applicationId, applicationTechnologyElements.elementId],
				where: isNull(applicationTechnologyElements.archivedAt),
			})
			.returning({ id: applicationTechnologyElements.id })
		if (inserted.length === 0) return
		await writeAuditLog(
			{
				action: "application_technology_element_added",
				entityType: "application_technology_element",
				entityId: appId,
				newValue: JSON.stringify({ applicationId: appId, elementId, source: "manual" }),
				metadata: { elementId, source: "manual" },
				performedBy,
			},
			tx,
		)
	})
}

/** Remove a technology element from an application. */
export async function removeApplicationElement(appId: string, elementId: string, performedBy: string) {
	await db.transaction(async (tx) => {
		const archived = await tx
			.update(applicationTechnologyElements)
			.set({ archivedAt: new Date(), archivedBy: performedBy })
			.where(
				and(
					eq(applicationTechnologyElements.applicationId, appId),
					eq(applicationTechnologyElements.elementId, elementId),
					isNull(applicationTechnologyElements.archivedAt),
				),
			)
			.returning({ id: applicationTechnologyElements.id, source: applicationTechnologyElements.source })
		if (archived.length === 0) return
		await writeAuditLog(
			{
				action: "application_technology_element_removed",
				entityType: "application_technology_element",
				entityId: appId,
				previousValue: JSON.stringify({ applicationId: appId, elementId, source: archived[0].source }),
				metadata: { elementId, source: archived[0].source },
				performedBy,
			},
			tx,
		)
	})
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
		.where(and(eq(applicationTechnologyElements.id, linkId), isNull(applicationTechnologyElements.archivedAt)))
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
		.where(and(eq(applicationTechnologyElements.id, linkId), isNull(applicationTechnologyElements.archivedAt)))
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
