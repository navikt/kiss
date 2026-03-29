import { eq } from "drizzle-orm"
import { db } from "../connection.server"
import { reports } from "../schema/reports"

/** Get all reports. */
export async function getReports() {
	return db.select().from(reports).orderBy(reports.createdAt)
}

/** Get a report by ID. */
export async function getReport(reportId: string) {
	const [report] = await db.select().from(reports).where(eq(reports.id, reportId)).limit(1)
	return report ?? null
}
