import { eq } from "drizzle-orm"
import PDFDocument from "pdfkit"
import { db } from "~/db/connection.server"
import { getRoutine, getRoutineNamesByIds } from "~/db/queries/routines.server"
import { getUserNamesByNavIdents } from "~/db/queries/users.server"
import { sections } from "~/db/schema/organization"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { getRoutineLineageInfo, renderRoutineSection } from "~/lib/routine-pdf.server"
import { sanitizeFilename } from "~/lib/sanitize-filename"
import type { Route } from "./+types/index"

const blue = "#0067c5"
const dark = "#222222"
const gray = "#666666"

export async function loader({ request, params, url }: Route.LoaderArgs) {
	await requireAuthenticatedUser(request)

	const rutineId = params.rutineId
	if (!rutineId) throw new Response("Mangler rutine-ID", { status: 400 })

	const routine = await getRoutine(rutineId)
	if (!routine) throw new Response("Rutine ikke funnet", { status: 404 })

	const [section] = await db.select().from(sections).where(eq(sections.id, routine.sectionId)).limit(1)
	if (!section) throw new Response("Seksjon ikke funnet", { status: 404 })

	const nameByNavIdent = await getUserNamesByNavIdents([
		...(routine.approvedBy ? [routine.approvedBy] : []),
		...(routine.archivedBy ? [routine.archivedBy] : []),
	])

	const { predecessorInfo, successorInfo } = await getRoutineLineageInfo(routine, getRoutineNamesByIds)

	const pdfBuffer = await buildPdf(routine, section.name, nameByNavIdent, predecessorInfo, successorInfo)

	const forceDownload = url.searchParams.get("download") === "true"
	const safeName = sanitizeFilename(routine.name, 150)
	const disposition = forceDownload ? `attachment; filename="${safeName}.pdf"` : `inline; filename="${safeName}.pdf"`

	return new Response(new Uint8Array(pdfBuffer), {
		headers: {
			"Content-Type": "application/pdf",
			"Content-Disposition": disposition,
		},
	})
}

type RoutineData = NonNullable<Awaited<ReturnType<typeof getRoutine>>>

function buildPdf(
	routine: RoutineData,
	sectionName: string,
	nameByNavIdent: ReadonlyMap<string, string>,
	predecessorInfo: { name: string; status: string } | null,
	successorInfo: { name: string; status: string } | null,
): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true })
		const chunks: Buffer[] = []

		doc.on("data", (chunk: Buffer) => chunks.push(chunk))
		doc.on("end", () => resolve(Buffer.concat(chunks)))
		doc.on("error", reject)

		doc.fontSize(20).fillColor(blue).text(routine.name, { align: "left" })
		doc.moveDown(0.2)

		renderRoutineSection(doc, { blue, dark, gray }, routine, nameByNavIdent, {
			sectionName,
			predecessorInfo,
			successorInfo,
			showGeneratedAt: true,
		})

		doc.end()
	})
}
