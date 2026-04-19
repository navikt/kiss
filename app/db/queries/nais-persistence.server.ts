import { and, eq, sql } from "drizzle-orm"
import { db } from "../connection.server"
import { applicationPersistence, type DataClassification, type PersistenceType } from "../schema/applications"
import { writeAuditLog } from "./audit.server"

/** Upsert a persistence resource for an application. */
export async function upsertAppPersistence(
	applicationId: string,
	type: PersistenceType,
	name: string,
	opts?: {
		version?: string | null
		tier?: string | null
		highAvailability?: boolean | null
		auditLogging?: boolean | null
		auditLogUrl?: string | null
	},
): Promise<boolean> {
	const [existing] = await db
		.select()
		.from(applicationPersistence)
		.where(
			and(
				eq(applicationPersistence.applicationId, applicationId),
				eq(applicationPersistence.type, type),
				eq(applicationPersistence.name, name),
			),
		)
		.limit(1)

	if (existing) {
		await db
			.update(applicationPersistence)
			.set({
				version: opts?.version ?? existing.version,
				tier: opts?.tier ?? existing.tier,
				highAvailability: opts?.highAvailability ?? existing.highAvailability,
				auditLogging: opts?.auditLogging ?? existing.auditLogging,
				auditLogUrl: opts?.auditLogUrl ?? existing.auditLogUrl,
				updatedAt: new Date(),
			})
			.where(eq(applicationPersistence.id, existing.id))
		return false
	}

	await db.insert(applicationPersistence).values({
		applicationId,
		type,
		name,
		version: opts?.version ?? null,
		tier: opts?.tier ?? null,
		highAvailability: opts?.highAvailability ?? null,
		auditLogging: opts?.auditLogging ?? null,
		auditLogUrl: opts?.auditLogUrl ?? null,
	})
	return true
}

export async function getAppPersistence(applicationId: string) {
	return db
		.select()
		.from(applicationPersistence)
		.where(eq(applicationPersistence.applicationId, applicationId))
		.orderBy(applicationPersistence.type, applicationPersistence.name)
}

/** Get persistence resources for multiple applications (batch). */
export async function getAppsPersistence(applicationIds: string[]) {
	if (applicationIds.length === 0) return new Map<string, (typeof applicationPersistence.$inferSelect)[]>()

	const rows = await db
		.select()
		.from(applicationPersistence)
		.where(
			sql`${applicationPersistence.applicationId} IN (${sql.join(
				applicationIds.map((id) => sql`${id}`),
				sql`, `,
			)})`,
		)
		.orderBy(applicationPersistence.type, applicationPersistence.name)

	const map = new Map<string, (typeof applicationPersistence.$inferSelect)[]>()
	for (const row of rows) {
		const list = map.get(row.applicationId) ?? []
		list.push(row)
		map.set(row.applicationId, list)
	}
	return map
}

/** Link an Oracle persistence entry to an Oracle instance ID. */
export async function linkPersistenceToOracleInstance(persistenceId: string, oracleInstanceId: string | null) {
	await db
		.update(applicationPersistence)
		.set({ oracleInstanceId, updatedAt: new Date() })
		.where(eq(applicationPersistence.id, persistenceId))
}

export async function addManualPersistence(
	applicationId: string,
	type: PersistenceType,
	name: string,
	dataClassification: DataClassification | null,
	performedBy: string,
) {
	const [inserted] = await db
		.insert(applicationPersistence)
		.values({
			applicationId,
			type,
			name,
			dataClassification,
			manuallyAdded: true,
		})
		.returning()

	await writeAuditLog({
		action: "persistence_added",
		entityType: "application_persistence",
		entityId: inserted.id,
		newValue: JSON.stringify({ type, name, dataClassification }),
		metadata: { applicationId },
		performedBy,
	})

	return inserted
}

export async function updatePersistenceClassification(
	persistenceId: string,
	classification: DataClassification | null,
	performedBy: string,
) {
	const [existing] = await db
		.select()
		.from(applicationPersistence)
		.where(eq(applicationPersistence.id, persistenceId))
		.limit(1)

	if (!existing) throw new Error("Persistens-oppføring ikke funnet")

	await db
		.update(applicationPersistence)
		.set({ dataClassification: classification, updatedAt: new Date() })
		.where(eq(applicationPersistence.id, persistenceId))

	await writeAuditLog({
		action: "persistence_updated",
		entityType: "application_persistence",
		entityId: persistenceId,
		previousValue: JSON.stringify({ dataClassification: existing.dataClassification }),
		newValue: JSON.stringify({ dataClassification: classification }),
		metadata: { applicationId: existing.applicationId, name: existing.name },
		performedBy,
	})
}

export async function deleteManualPersistence(persistenceId: string, performedBy: string) {
	const [existing] = await db
		.select()
		.from(applicationPersistence)
		.where(and(eq(applicationPersistence.id, persistenceId), eq(applicationPersistence.manuallyAdded, true)))
		.limit(1)

	if (!existing) throw new Error("Kan bare slette manuelt lagt til databaser")

	await db.delete(applicationPersistence).where(eq(applicationPersistence.id, persistenceId))

	await writeAuditLog({
		action: "persistence_deleted",
		entityType: "application_persistence",
		entityId: persistenceId,
		previousValue: JSON.stringify({
			type: existing.type,
			name: existing.name,
			dataClassification: existing.dataClassification,
		}),
		metadata: { applicationId: existing.applicationId },
		performedBy,
	})
}
