import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import type PDFDocument from "pdfkit"
import { getStatusLabel } from "../../lib/compliance-status"
import { renderMarkdownToPdf } from "../../lib/markdown-pdf.server"
import { getCompositeFrequencyLabel, type RoutineFrequency } from "../../lib/routine-frequencies"
import { getStorageProvider } from "../../lib/storage/index.server"
import { db } from "../connection.server"
import { monitoredApplications } from "../schema/applications"
import { complianceAssessments } from "../schema/compliance"
import { frameworkControls, frameworkDomains, frameworkRiskControlMappings, frameworkRisks } from "../schema/framework"
import { sections } from "../schema/organization"
import { reports } from "../schema/reports"
import { routines } from "../schema/routines"
import { writeAuditLog } from "./audit.server"
import { getAuditEvidenceForReport } from "./audit-evidence.server"
import { saveBucketObject } from "./buckets.server"
import { getActiveFrameworkVersion } from "./framework.server"
import { calculateDeadline, getAppsRequiringRoutine, getEffectiveLastReviewDate, isOverdue } from "./routines.server"
import { getEffectiveAppIdsInSection } from "./sections.server"

/** Get all reports ordered by newest first. */
export async function getReports() {
	return db.select().from(reports).orderBy(desc(reports.createdAt))
}

/** Get reports scoped to a specific application. */
export async function getReportsForApp(applicationId: string) {
	return db
		.select()
		.from(reports)
		.where(sql`${reports.scope} = 'application' AND ${reports.scopeId} = ${applicationId}`)
		.orderBy(desc(reports.createdAt))
}

/** Get a report by ID. */
export async function getReport(reportId: string) {
	const [report] = await db.select().from(reports).where(eq(reports.id, reportId)).limit(1)
	return report ?? null
}

/** Generate a compliance report and persist snapshot + HTML to storage. */
export async function generateComplianceReport(params: {
	scope: "all" | "section"
	scopeId?: string
	createdBy: string
}): Promise<string> {
	const { scope, scopeId, createdBy } = params
	const version = await getActiveFrameworkVersion()

	// 1. Determine which applications are in scope
	let apps: Array<{ id: string; name: string }>

	if (scope === "section" && scopeId) {
		const effectiveAppIds = await getEffectiveAppIdsInSection(scopeId)

		if (effectiveAppIds.length === 0) {
			apps = []
		} else {
			apps = await db
				.select({ id: monitoredApplications.id, name: monitoredApplications.name })
				.from(monitoredApplications)
				.where(and(inArray(monitoredApplications.id, effectiveAppIds), isNull(monitoredApplications.archivedAt)))
				.orderBy(monitoredApplications.name)
		}
	} else {
		apps = await db
			.select({ id: monitoredApplications.id, name: monitoredApplications.name })
			.from(monitoredApplications)
			.where(isNull(monitoredApplications.archivedAt))
			.orderBy(monitoredApplications.name)
	}

	// 2. Get framework controls and derive domains via risk mappings
	const controls = await db
		.select({
			id: frameworkControls.id,
			controlId: frameworkControls.controlId,
			shortTitle: frameworkControls.shortTitle,
			requirement: frameworkControls.requirement,
		})
		.from(frameworkControls)
		.where(isNull(frameworkControls.archivedAt))
		.orderBy(frameworkControls.controlId)

	const domains = await db
		.select({ id: frameworkDomains.id, code: frameworkDomains.code, name: frameworkDomains.name })
		.from(frameworkDomains)
		.where(isNull(frameworkDomains.archivedAt))
	const domainMap = new Map(domains.map((d) => [d.id, d]))

	// Build control → domain map via risk-control mappings
	const riskMappingsForDomain = await db
		.select({
			controlId: frameworkRiskControlMappings.controlId,
			domainId: frameworkRisks.domainId,
		})
		.from(frameworkRiskControlMappings)
		.innerJoin(frameworkRisks, eq(frameworkRiskControlMappings.riskId, frameworkRisks.id))
		.where(and(isNull(frameworkRiskControlMappings.archivedAt), isNull(frameworkRisks.archivedAt)))

	const controlDomainLookup = new Map<string, { code: string; name: string }>()
	for (const rm of riskMappingsForDomain) {
		if (!controlDomainLookup.has(rm.controlId)) {
			const domain = domainMap.get(rm.domainId)
			if (domain) controlDomainLookup.set(rm.controlId, { code: domain.code, name: domain.name })
		}
	}

	// 3. Gather assessments per application
	type AssessmentRow = {
		appName: string
		controlId: string
		controlName: string
		domain: string
		domainCode: string
		status: string | null
		comment: string | null
		assessedBy: string | null
		assessedAt: string | null
	}

	const allRows: AssessmentRow[] = []

	for (const app of apps) {
		for (const ctrl of controls) {
			const [assessment] = await db
				.select()
				.from(complianceAssessments)
				.where(
					sql`${complianceAssessments.applicationId} = ${app.id} AND ${complianceAssessments.controlId} = ${ctrl.id}`,
				)
				.limit(1)

			const ctrlDomain = controlDomainLookup.get(ctrl.id)
			allRows.push({
				appName: app.name,
				controlId: ctrl.controlId,
				controlName: ctrl.shortTitle ?? ctrl.requirement?.split("\n")[0] ?? ctrl.controlId,
				domain: ctrlDomain?.name ?? "",
				domainCode: ctrlDomain?.code ?? "",
				status: assessment?.status ?? null,
				comment: assessment?.comment ?? null,
				assessedBy: assessment?.assessedBy ?? null,
				assessedAt: assessment?.assessedAt?.toISOString() ?? null,
			})
		}
	}

	// 4. Compute statistics
	const totalApps = apps.length
	const totalAssessments = allRows.length
	const assessed = allRows.filter((r) => r.status !== null)
	const implemented = allRows.filter((r) => r.status === "implemented").length
	const partial = allRows.filter((r) => r.status === "partially_implemented").length
	const notImplemented = allRows.filter((r) => r.status === "not_implemented").length
	const notRelevant = allRows.filter((r) => r.status === "not_relevant").length

	const pct = (n: number) => (totalAssessments > 0 ? ((n / totalAssessments) * 100).toFixed(1) : "0.0")

	// 5. Per-domain breakdown
	const domainStats = new Map<
		string,
		{ name: string; total: number; implemented: number; partial: number; notImplemented: number; notRelevant: number }
	>()
	for (const row of allRows) {
		const key = row.domainCode || row.domain
		const existing = domainStats.get(key) ?? {
			name: row.domain,
			total: 0,
			implemented: 0,
			partial: 0,
			notImplemented: 0,
			notRelevant: 0,
		}
		existing.total++
		if (row.status === "implemented") existing.implemented++
		if (row.status === "partially_implemented") existing.partial++
		if (row.status === "not_implemented") existing.notImplemented++
		if (row.status === "not_relevant") existing.notRelevant++
		domainStats.set(key, existing)
	}

	// 6. Scope label
	let scopeLabel = "Alle seksjoner"
	if (scope === "section" && scopeId) {
		const [section] = await db.select().from(sections).where(eq(sections.id, scopeId)).limit(1)
		scopeLabel = section ? `Seksjon: ${section.name}` : `Seksjon: ${scopeId}`
	}

	const now = new Date()
	const timestamp = now.toISOString()
	const appVersion = "0.1.0"
	const reportName = `Compliance-rapport – ${scopeLabel} – ${now.toLocaleDateString("nb-NO")}`

	// 6b. Gather routine status for apps in scope
	const routineRows: Array<{
		appName: string
		routineName: string
		frequency: string
		lastReview: string | null
		deadline: string | null
		status: string
	}> = []

	// Get routines for the scoped section, or all routines for "all" scope
	let scopedRoutines: Array<{
		id: string
		name: string
		frequency: string | null
		eventFrequency: string | null
		createdAt: Date
		isSectionRoutine: number
	}>
	if (scope === "section" && scopeId) {
		scopedRoutines = await db
			.select({
				id: routines.id,
				name: routines.name,
				frequency: routines.frequency,
				eventFrequency: routines.eventFrequency,
				createdAt: routines.createdAt,
				isSectionRoutine: routines.isSectionRoutine,
			})
			.from(routines)
			.where(eq(routines.sectionId, scopeId))
	} else {
		scopedRoutines = await db
			.select({
				id: routines.id,
				name: routines.name,
				frequency: routines.frequency,
				eventFrequency: routines.eventFrequency,
				createdAt: routines.createdAt,
				isSectionRoutine: routines.isSectionRoutine,
			})
			.from(routines)
	}

	const sectionAppIdsCache = new Map<string, string[]>()
	for (const routine of scopedRoutines) {
		const requiredApps = await getAppsRequiringRoutine(routine.id, { sectionAppIdsCache })
		const appsInScope = requiredApps.filter((a) => apps.some((sa) => sa.id === a.id))

		// For section routines, fetch section-level effective review once (shared across all apps)
		const sectionReviewDate = routine.isSectionRoutine === 1 ? await getEffectiveLastReviewDate(routine.id, null) : null

		for (const app of appsInScope) {
			const lastReviewDate =
				routine.isSectionRoutine === 1 ? sectionReviewDate : await getEffectiveLastReviewDate(routine.id, app.id)
			const deadline = calculateDeadline(
				lastReviewDate,
				routine.createdAt,
				routine.frequency as RoutineFrequency | null,
			)
			const overdue = isOverdue(deadline)

			routineRows.push({
				appName: app.name,
				routineName: routine.name,
				frequency: getCompositeFrequencyLabel(routine.frequency, routine.eventFrequency),
				lastReview: lastReviewDate?.toISOString() ?? null,
				deadline: deadline?.toISOString() ?? null,
				status: !routine.frequency
					? (routine.eventFrequency ?? "Ved behov")
					: overdue
						? "Over frist"
						: lastReviewDate
							? "OK"
							: "Ikke gjennomført",
			})
		}
	}

	// 7. Build snapshot JSON
	const snapshot = {
		generatedAt: timestamp,
		appVersion,
		scope,
		scopeId: scopeId ?? null,
		scopeLabel,
		frameworkVersion: version
			? { id: version.id, name: version.name, activatedAt: version.activatedAt?.toISOString() ?? null }
			: null,
		totalApps,
		totalAssessments,
		statistics: {
			implemented,
			partial,
			notImplemented,
			notRelevant,
			unassessed: totalAssessments - assessed.length,
		},
		rows: allRows,
		routineRows,
	}

	const storage = getStorageProvider()
	const bucketName = "kiss-reports"
	const datePrefix = now.toISOString().slice(0, 10)
	const fileId = crypto.randomUUID()

	// 8. Upload snapshot JSON
	const snapshotPath = `reports/${datePrefix}/${fileId}/snapshot.json`
	const snapshotBuffer = Buffer.from(JSON.stringify(snapshot, null, 2), "utf-8")
	const snapshotResult = await storage.upload(snapshotPath, snapshotBuffer, {
		contentType: "application/json",
	})
	await saveBucketObject({
		bucketName,
		objectPath: snapshotPath,
		contentType: "application/json",
		sizeBytes: snapshotResult.sizeBytes,
		objectType: "report_snapshot",
		uploadedBy: createdBy,
	})

	// 9. Generate HTML report
	const htmlContent = buildReportHtml({
		reportName,
		timestamp,
		appVersion,
		scopeLabel,
		frameworkVersionName: version?.name ?? "Ingen aktiv versjon",
		totalApps,
		totalAssessments,
		implemented,
		partial,
		notImplemented,
		notRelevant,
		unassessed: totalAssessments - assessed.length,
		pct,
		domainStats,
		allRows,
		routineRows,
	})

	// 10. Upload HTML report
	const reportPath = `reports/${datePrefix}/${fileId}/report.html`
	const reportBuffer = Buffer.from(htmlContent, "utf-8")
	const reportResult = await storage.upload(reportPath, reportBuffer, {
		contentType: "text/html",
	})
	await saveBucketObject({
		bucketName,
		objectPath: reportPath,
		contentType: "text/html",
		sizeBytes: reportResult.sizeBytes,
		objectType: "report_html",
		uploadedBy: createdBy,
	})

	// 11. Insert report record
	const [report] = await db
		.insert(reports)
		.values({
			name: reportName,
			reportType: "compliance",
			scope,
			scopeId: scopeId ?? null,
			snapshotBucketPath: snapshotPath,
			reportBucketPath: reportPath,
			appVersion,
			createdBy,
		})
		.returning()

	// 12. Write audit log
	await writeAuditLog({
		action: "report_generated",
		entityType: "report",
		entityId: report.id,
		newValue: reportName,
		metadata: { scope, scopeId, totalApps, totalAssessments },
		performedBy: createdBy,
	})

	return report.id
}

/** Generate a per-application compliance report: snapshot JSON + PDF stored in bucket. */
export async function generateAppComplianceReport(params: {
	applicationId: string
	createdBy: string
	includeReviews?: boolean
	includeAttachments?: boolean
	includeRoutineDescription?: boolean
	reviewIds?: string[]
}): Promise<string> {
	const {
		applicationId,
		createdBy,
		includeReviews = true,
		includeAttachments = true,
		includeRoutineDescription = false,
		reviewIds,
	} = params

	// Dynamic imports to avoid circular deps and keep pdfkit server-only
	const { getAppAssessments } = await import("./applications.server")
	const { getReviewsForApp } = await import("./routines.server")
	const { getApplicationDetail } = await import("./nais.server")
	const { enrichAppAssessments } = await import("./app-assessment-enrichment.server")
	const { default: PDFDocument } = await import("pdfkit")
	const { PDFDocument: PDFLibDocument } = await import("pdf-lib")

	const [detail, assessmentsResult] = await Promise.all([
		getApplicationDetail(applicationId),
		getAppAssessments(applicationId),
	])

	// Reviews may fail if routine tables don't exist yet
	let reviews: Awaited<ReturnType<typeof getReviewsForApp>> = []
	if (includeReviews) {
		try {
			reviews = await getReviewsForApp(applicationId)
		} catch {
			// Routine tables may not exist
		}
	}

	if (!detail) throw new Error(`Fant ikke applikasjon: ${applicationId}`)

	const enriched = await enrichAppAssessments(applicationId, assessmentsResult?.assessments ?? [])
	const assessments = enriched.map((a) => ({
		...a,
		status: a.effectiveStatus,
		assessedBy: a.commentUpdatedBy,
		assessedAt: a.commentUpdatedAt,
	}))
	let completedReviews = reviews.filter((r) => r.status === "completed" || r.status === "needs_follow_up")
	if (reviewIds) {
		completedReviews = completedReviews.filter((r) => reviewIds.includes(r.id))
	}

	const auditEvidence = await getAuditEvidenceForReport(applicationId)

	// Fetch review activities (Entra ID maintenance etc.)
	const { getActivitiesForReviews } = await import("./routines.server")
	const reviewActivities =
		completedReviews.length > 0 ? await getActivitiesForReviews(completedReviews.map((r) => r.id)) : []
	const activitiesByReviewId = new Map<string, typeof reviewActivities>()
	for (const a of reviewActivities) {
		const list = activitiesByReviewId.get(a.reviewId) ?? []
		list.push(a)
		activitiesByReviewId.set(a.reviewId, list)
	}

	const now = new Date()
	const datePrefix = now.toISOString().slice(0, 10)
	const fileId = crypto.randomUUID()
	const reportName = `Compliance-rapport – ${detail.app.name} – ${now.toLocaleDateString("nb-NO")}`
	const storage = getStorageProvider()
	const bucketName = "kiss-reports"

	// Build snapshot
	const total = assessments.length
	const implemented = assessments.filter((a) => a.status === "implemented").length
	const partial = assessments.filter((a) => a.status === "partially_implemented").length
	const notImpl = assessments.filter((a) => a.status === "not_implemented").length
	const notRel = assessments.filter((a) => a.status === "not_relevant").length
	const notAssessed = assessments.filter((a) => !a.status).length

	const snapshot = {
		generatedAt: now.toISOString(),
		appName: detail.app.name,
		namespace: detail.environments[0]?.namespace ?? null,
		cluster: detail.environments[0]?.cluster ?? null,
		totalControls: total,
		statistics: { implemented, partial, notImplemented: notImpl, notRelevant: notRel, unassessed: notAssessed },
		assessments: assessments.map((a) => ({
			controlId: a.controlId,
			controlName: a.controlName,
			domainCode: a.domainCode,
			domainName: a.domainName,
			technologyElementName: a.technologyElementName ?? null,
			status: a.status,
			comment: a.comment,
			assessedBy: a.assessedBy,
			assessedAt: a.assessedAt,
		})),
		reviews: completedReviews.map((r) => {
			const acts = activitiesByReviewId.get(r.id) ?? []
			return {
				id: r.id,
				title: r.title,
				status: r.status,
				routineId: r.routineId,
				routineName: r.routineName,
				routineDescription: includeRoutineDescription ? (r.routineDescription ?? null) : null,
				routineFrequency: r.routineFrequency,
				routineEventFrequency: r.routineEventFrequency,
				reviewedAt: r.reviewedAt.toISOString(),
				createdBy: r.createdBy,
				summary: r.summary,
				participants: r.participants.map((p) => ({ userIdent: p.userIdent, userName: p.userName })),
				attachments: r.attachments.map((a) => ({
					fileName: a.fileName,
					contentType: a.contentType,
					bucketPath: a.bucketPath,
				})),
				links: r.links.map((l) => ({
					url: l.url,
					title: l.title,
				})),
				followUpPoints: r.followUpPoints.map((p) => ({
					id: p.id,
					text: p.text,
					description: p.description,
					resolution: p.resolution,
					status: p.status,
					attachments: p.attachments.map((a) => ({
						fileName: a.fileName,
						contentType: a.contentType,
						bucketPath: a.bucketPath,
						kind: a.kind,
					})),
				})),
				activities: acts.map((act) => ({
					id: act.id,
					type: act.type,
					status: act.status,
					snapshotBefore: act.snapshotBefore,
					snapshotAfter: act.snapshotAfter,
					completedAt: act.completedAt?.toISOString() ?? null,
					changes: act.changes.map((c) => ({
						changeType: c.changeType,
						groupId: c.groupId,
						groupName: c.groupName,
						previousValue: c.previousValue,
						newValue: c.newValue,
						performedBy: c.performedBy,
						performedAt: c.performedAt.toISOString(),
					})),
				})),
			}
		}),
		auditEvidence: auditEvidence.map((e) => ({
			instanceId: e.instanceId,
			overallStatus: e.overallStatus,
			collectedAt: e.collectedAt.toISOString(),
		})),
	}

	// Upload snapshot JSON
	const snapshotPath = `reports/app/${datePrefix}/${fileId}/snapshot.json`
	const snapshotBuffer = Buffer.from(JSON.stringify(snapshot, null, 2), "utf-8")
	const snapshotResult = await storage.upload(snapshotPath, snapshotBuffer, { contentType: "application/json" })
	await saveBucketObject({
		bucketName,
		objectPath: snapshotPath,
		contentType: "application/json",
		sizeBytes: snapshotResult.sizeBytes,
		objectType: "app_report_snapshot",
		uploadedBy: createdBy,
	})

	// Download attachment files
	const attachmentBuffers: Array<{
		fileName: string
		contentType: string
		data: Buffer
		reviewTitle: string
		reviewDate: string
		followUpPointText?: string
		followUpKind?: "description" | "resolution"
	}> = []
	const failedAttachments: Array<{ fileName: string; reviewTitle: string; followUpPointText?: string }> = []
	if (includeAttachments) {
		for (const review of completedReviews) {
			const reviewDate = new Date(review.reviewedAt).toISOString().slice(0, 10)
			for (const att of review.attachments) {
				try {
					const buf = await storage.download(att.bucketPath)
					attachmentBuffers.push({
						fileName: att.fileName,
						contentType: att.contentType,
						data: buf,
						reviewTitle: review.title,
						reviewDate,
					})
				} catch {
					failedAttachments.push({ fileName: att.fileName, reviewTitle: review.title })
				}
			}
			for (const point of review.followUpPoints) {
				for (const att of point.attachments) {
					try {
						const buf = await storage.download(att.bucketPath)
						attachmentBuffers.push({
							fileName: att.fileName,
							contentType: att.contentType,
							data: buf,
							reviewTitle: review.title,
							reviewDate,
							followUpPointText: point.text,
							followUpKind: att.kind,
						})
					} catch {
						failedAttachments.push({
							fileName: att.fileName,
							reviewTitle: review.title,
							followUpPointText: point.text,
						})
					}
				}
			}
		}
	}

	const pdfAttachments = attachmentBuffers.filter((a) => a.contentType === "application/pdf")
	const nonPdfAttachments = attachmentBuffers.filter((a) => a.contentType !== "application/pdf")

	// Generate main PDF — non-PDF attachments are referenced, not embedded
	const mainPdfBuffer = await buildAppPdf(
		PDFDocument,
		{
			name: detail.app.name,
			namespace: detail.environments[0]?.namespace ?? null,
			cluster: detail.environments[0]?.cluster ?? null,
		},
		assessments,
		completedReviews,
		pdfAttachments,
		auditEvidence,
		activitiesByReviewId,
		nonPdfAttachments,
		failedAttachments,
	)

	// Merge PDF attachments as pages
	let finalPdf: Buffer
	if (pdfAttachments.length > 0) {
		const merged = await PDFLibDocument.load(mainPdfBuffer)
		const totalMainPages = merged.getPageCount()
		const firstCoverPageIndex = totalMainPages - pdfAttachments.length

		let insertOffset = 0
		for (let i = pdfAttachments.length - 1; i >= 0; i--) {
			const att = pdfAttachments[i]
			const coverIndex = firstCoverPageIndex + i + insertOffset
			try {
				const attachedPdf = await PDFLibDocument.load(att.data)
				const pageIndices = attachedPdf.getPageIndices()
				const copiedPages = await merged.copyPages(attachedPdf, pageIndices)
				for (let j = copiedPages.length - 1; j >= 0; j--) {
					merged.insertPage(coverIndex + 1, copiedPages[j])
				}
				insertOffset += copiedPages.length
			} catch {
				// Skip corrupt PDFs
			}
		}
		finalPdf = Buffer.from(await merged.save())
	} else {
		finalPdf = mainPdfBuffer
	}

	// Upload PDF to bucket
	const pdfPath = `reports/app/${datePrefix}/${fileId}/rapport.pdf`
	const pdfResult = await storage.upload(pdfPath, finalPdf, { contentType: "application/pdf" })
	await saveBucketObject({
		bucketName,
		objectPath: pdfPath,
		contentType: "application/pdf",
		sizeBytes: pdfResult.sizeBytes,
		objectType: "app_report_pdf",
		uploadedBy: createdBy,
	})

	// Build zip if there are non-PDF attachments
	let reportBucketPath = pdfPath
	if (nonPdfAttachments.length > 0) {
		const JSZip = (await import("jszip")).default
		const zip = new JSZip()
		zip.file("rapport.pdf", finalPdf)

		const vedleggFolder = zip.folder("vedlegg")
		if (!vedleggFolder) throw new Error("Could not create vedlegg folder in zip")
		const usedNames = new Set<string>()
		for (const att of nonPdfAttachments) {
			// Use unique subfolder per review to avoid filename collisions
			const safeReviewTitle = att.reviewTitle.replace(/[^a-zA-Z0-9æøåÆØÅ _-]/g, "_").slice(0, 50)
			const folderName = `${att.reviewDate}-${safeReviewTitle}`
			const subFolder = att.followUpPointText
				? `/oppfolgingspunkter/${att.followUpPointText.replace(/[^a-zA-Z0-9æøåÆØÅ _-]/g, "_").slice(0, 50)}${att.followUpKind === "description" ? " (beskrivelse)" : " (oppfølging)"}`
				: ""
			let entryName = `${folderName}${subFolder}/${att.fileName}`
			// Handle duplicates within same review
			if (usedNames.has(entryName)) {
				const ext = att.fileName.includes(".") ? `.${att.fileName.split(".").pop()}` : ""
				const base = att.fileName.includes(".") ? att.fileName.slice(0, att.fileName.lastIndexOf(".")) : att.fileName
				let counter = 2
				do {
					entryName = `${folderName}${subFolder}/${base} (${counter})${ext}`
					counter++
				} while (usedNames.has(entryName))
			}
			usedNames.add(entryName)
			vedleggFolder.file(entryName, att.data)
		}

		const zipBuffer = Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }))
		const zipPath = `reports/app/${datePrefix}/${fileId}/rapport.zip`
		const zipResult = await storage.upload(zipPath, zipBuffer, { contentType: "application/zip" })
		await saveBucketObject({
			bucketName,
			objectPath: zipPath,
			contentType: "application/zip",
			sizeBytes: zipResult.sizeBytes,
			objectType: "app_report_zip",
			uploadedBy: createdBy,
		})
		reportBucketPath = zipPath
	}

	// Insert report record
	const [report] = await db
		.insert(reports)
		.values({
			name: reportName,
			reportType: "app_compliance",
			scope: "application",
			scopeId: applicationId,
			snapshotBucketPath: snapshotPath,
			reportBucketPath,
			appVersion: "0.1.0",
			createdBy,
		})
		.returning()

	await writeAuditLog({
		action: "report_generated",
		entityType: "report",
		entityId: report.id,
		newValue: reportName,
		metadata: { scope: "application", applicationId, totalControls: total },
		performedBy: createdBy,
	})

	return report.id
}

function buildAppPdf(
	PDFDocCtor: typeof PDFDocument,
	app: { name: string; namespace: string | null; cluster: string | null },
	assessments: Array<{
		controlId: string
		controlName: string
		domainCode: string
		domainName: string
		technologyElementName: string | null
		status: string | null
		comment: string | null
	}>,
	reviews: Array<{
		id: string
		title: string
		summary: string | null
		status: string
		reviewedAt: Date
		createdBy: string
		routineId: string
		routineName: string
		routineDescription: string | null
		routineFrequency: string | null
		routineEventFrequency?: string | null
		participants: Array<{ userIdent: string; userName: string | null }>
		attachments: Array<{ fileName: string }>
		links: Array<{ url: string; title: string | null }>
		followUpPoints: Array<{
			text: string
			description: string | null
			resolution: string | null
			status: "needs_follow_up" | "completed" | "not_relevant"
			attachments: Array<{ fileName: string; kind: "description" | "resolution" }>
		}>
	}>,
	pdfAttachments: Array<{ fileName: string; contentType: string; data: Buffer }>,
	auditEvidence: Array<{
		instanceId: string
		overallStatus: string
		collectedAt: Date
	}>,
	activitiesByReviewId: Map<
		string,
		Array<{
			type: string
			status: string
			snapshotBefore: unknown
			snapshotAfter: unknown
			completedAt: Date | null
			changes: Array<{
				changeType: string
				groupId: string
				groupName: string | null
				previousValue: string | null
				newValue: string | null
				performedBy: string
				performedAt: Date
			}>
		}>
	>,
	nonPdfAttachments: Array<{
		fileName: string
		contentType: string
		data: Buffer
		reviewTitle: string
		followUpPointText?: string
		followUpKind?: "description" | "resolution"
	}>,
	failedAttachments: Array<{ fileName: string; reviewTitle: string; followUpPointText?: string }>,
): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const doc = new PDFDocCtor({ size: "A4", margin: 50, bufferPages: true })
		const chunks: Buffer[] = []
		doc.on("data", (chunk: Buffer) => chunks.push(chunk))
		doc.on("end", () => resolve(Buffer.concat(chunks)))
		doc.on("error", reject)

		const blue = "#0067c5"
		const dark = "#222222"
		const gray = "#666666"

		// Title
		doc.fontSize(22).fillColor(blue).text("Compliance-rapport")
		doc.fontSize(16).fillColor(dark).text(app.name)
		doc.moveDown(0.5)
		doc.fontSize(9).fillColor(gray)
		doc.text(`Generert: ${new Date().toLocaleString("nb-NO")}`)
		if (app.namespace) doc.text(`Namespace: ${app.namespace}`)
		if (app.cluster) doc.text(`Cluster: ${app.cluster}`)
		doc.moveDown(1)

		// Summary
		const total = assessments.length
		const impl = assessments.filter((a) => a.status === "implemented").length
		const part = assessments.filter((a) => a.status === "partially_implemented").length
		const notI = assessments.filter((a) => a.status === "not_implemented").length
		const notR = assessments.filter((a) => a.status === "not_relevant").length
		const notA = assessments.filter((a) => !a.status).length
		const pct = (n: number) => (total > 0 ? ((n / total) * 100).toFixed(1) : "0.0")

		doc.fontSize(14).fillColor(blue).text("Compliance-oppsummering")
		doc.moveDown(0.3)
		doc.fontSize(10).fillColor(dark)
		doc.text(`Totalt kontroller: ${total}`)
		doc.text(`Implementert: ${impl} (${pct(impl)}%)`)
		doc.text(`Delvis implementert: ${part} (${pct(part)}%)`)
		doc.text(`Ikke implementert: ${notI} (${pct(notI)}%)`)
		doc.text(`Ikke relevant: ${notR} (${pct(notR)}%)`)
		doc.text(`Ikke vurdert: ${notA} (${pct(notA)}%)`)
		doc.moveDown(1)

		// Assessment table
		if (assessments.length > 0) {
			doc.fontSize(14).fillColor(blue).text("Kontrollvurderinger")
			doc.moveDown(0.3)
			const cw = [50, 120, 70, 75, 85, 95]
			drawRow(doc, 50, cw, ["Kontroll", "Kontrollnavn", "Domene", "Teknologi", "Status", "Kommentar"], true, blue, dark)
			for (const a of assessments) {
				if (doc.y > 760) doc.addPage()
				drawRow(
					doc,
					50,
					cw,
					[
						a.controlId,
						a.controlName.slice(0, 28),
						a.domainName.slice(0, 15),
						(a.technologyElementName ?? "–").slice(0, 16),
						getStatusLabel(a.status),
						(a.comment ?? "").slice(0, 22),
					],
					false,
					blue,
					dark,
				)
			}
			doc.moveDown(1)
		}

		// Reviews — grouped by routine
		if (reviews.length > 0) {
			// Group reviews by routineId
			const routineGroups = new Map<
				string,
				{
					routineName: string
					routineDescription: string | null
					routineFrequency: string | null
					routineEventFrequency?: string | null
					reviews: typeof reviews
				}
			>()
			for (const r of reviews) {
				const key = r.routineId
				if (!routineGroups.has(key)) {
					routineGroups.set(key, {
						routineName: r.routineName,
						routineDescription: r.routineDescription,
						routineFrequency: r.routineFrequency,
						routineEventFrequency: r.routineEventFrequency,
						reviews: [],
					})
				}
				routineGroups.get(key)?.reviews.push(r)
			}

			for (const [, group] of routineGroups) {
				// Routine cover page
				doc.addPage()
				doc.fontSize(14).fillColor(blue).text("Rutine")
				doc.moveDown(0.3)
				doc.fontSize(16).fillColor(dark).text(group.routineName)
				doc.moveDown(0.3)
				const groupFreqLabel = getCompositeFrequencyLabel(group.routineFrequency, group.routineEventFrequency)
				doc.fontSize(9).fillColor(gray).text(`Frekvens: ${groupFreqLabel}`)
				doc.moveDown(0.5)

				if (group.routineDescription) {
					doc.fontSize(10).fillColor(dark).text("Beskrivelse", { underline: true })
					doc.moveDown(0.2)
					renderMarkdownToPdf(doc, group.routineDescription, { width: 495 })
					doc.moveDown(0.5)
				}

				doc.fontSize(11).fillColor(blue).text(`Gjennomganger (${group.reviews.length})`)
				doc.moveDown(0.5)

				// Each review
				for (const r of group.reviews) {
					doc.addPage()

					doc.fontSize(12).fillColor(dark).text(r.title)
					doc.moveDown(0.3)
					doc.fontSize(9).fillColor(gray)
					doc.text(`Dato: ${new Date(r.reviewedAt).toLocaleString("nb-NO")}`)
					doc.text(`Opprettet av: ${r.createdBy}`)
					if (r.participants.length > 0) {
						doc.text(`Deltakere: ${r.participants.map((p) => p.userName || p.userIdent).join(", ")}`)
					}
					if (r.attachments.length > 0) {
						doc.text(`Vedlegg: ${r.attachments.map((a) => a.fileName).join(", ")}`)
					}

					if (r.summary) {
						doc.moveDown(0.5)
						doc.fontSize(10).fillColor(blue).text("Oppsummering / referat")
						doc.moveDown(0.2)
						renderMarkdownToPdf(doc, r.summary, { width: 495 })
					}

					if (r.followUpPoints.length > 0) {
						doc.moveDown(0.6)
						doc.fontSize(11).fillColor(blue).text(`Oppfølgingspunkter (${r.followUpPoints.length})`)
						doc.moveDown(0.3)

						for (const [idx, p] of r.followUpPoints.entries()) {
							if (doc.y > 700) doc.addPage()

							doc
								.fontSize(10)
								.fillColor(dark)
								.text(`${idx + 1}. ${p.text}`, { width: 495 })
							doc.moveDown(0.15)

							doc
								.fontSize(8)
								.fillColor(gray)
								.text(`Status: ${followUpPointStatusLabel(p.status)}`, { width: 495 })

							if (p.description) {
								doc.moveDown(0.15)
								doc.fontSize(8).fillColor(gray).text("Beskrivelse:", { width: 495 })
								doc.fontSize(8).fillColor(dark)
								renderMarkdownToPdf(doc, p.description, { width: 495 })
							}

							if (p.resolution) {
								doc.moveDown(0.15)
								doc.fontSize(8).fillColor(gray).text("Oppfølging:", { width: 495 })
								doc.fontSize(8).fillColor(dark)
								renderMarkdownToPdf(doc, p.resolution, { width: 495 })
							}

							if (p.attachments.length > 0) {
								const descAtts = p.attachments.filter((a) => a.kind === "description").map((a) => a.fileName)
								const resAtts = p.attachments.filter((a) => a.kind === "resolution").map((a) => a.fileName)
								doc.moveDown(0.15)
								doc.fontSize(8).fillColor(gray)
								if (descAtts.length > 0) doc.text(`Vedlegg til beskrivelse: ${descAtts.join(", ")}`, { width: 495 })
								if (resAtts.length > 0) doc.text(`Vedlegg til oppfølging: ${resAtts.join(", ")}`, { width: 495 })
							}

							doc.moveDown(0.5)
						}
					}

					if (r.links.length > 0) {
						doc.moveDown(0.5)
						doc.fontSize(10).fillColor(blue).text("Lenker")
						doc.moveDown(0.2)
						for (const link of r.links) {
							const label = link.title || link.url
							doc.fontSize(9).fillColor(blue).text(label, { link: link.url, underline: true, width: 495 })
							if (link.title) {
								doc.fontSize(8).fillColor(gray).text(link.url, { width: 495 })
							}
							doc.moveDown(0.2)
						}
					}

					// Entra ID maintenance activities
					const reviewActs = activitiesByReviewId.get(r.id) ?? []
					for (const act of reviewActs) {
						if (act.type === "entra_id_group_maintenance" && act.changes.length > 0) {
							doc.moveDown(0.5)
							doc.fontSize(10).fillColor(blue).text("Vedlikeholdsaktivitet — Entra ID-grupper")
							doc.moveDown(0.2)
							doc
								.fontSize(9)
								.fillColor(gray)
								.text(`Status: ${act.status === "completed" ? "Fullført" : "Pågår"}`)
							if (act.completedAt) {
								doc.text(`Fullført: ${new Date(act.completedAt).toLocaleString("nb-NO")}`)
							}
							doc.moveDown(0.3)

							// Changes table
							doc.fontSize(9).fillColor(dark).text("Endringer:", { underline: true })
							doc.moveDown(0.2)
							const changeCw = [100, 140, 120, 120]
							drawRow(doc, 50, changeCw, ["Type", "Gruppe", "Fra", "Til"], true, blue, dark)
							for (const c of act.changes) {
								if (doc.y > 760) doc.addPage()
								const changeLabel =
									c.changeType === "added" ? "Lagt til" : c.changeType === "removed" ? "Fjernet" : "Kritikalitet endret"
								drawRow(
									doc,
									50,
									changeCw,
									[
										changeLabel,
										(c.groupName ?? c.groupId).slice(0, 30),
										(c.previousValue ?? "–").slice(0, 25),
										(c.newValue ?? "–").slice(0, 25),
									],
									false,
									blue,
									dark,
								)
							}
						}
					}
				}
			}
		}

		// Audit evidence — Oracle databases
		if (auditEvidence.length > 0) {
			doc.addPage()
			doc.fontSize(16).fillColor(blue).text("Revisjonsbevis — Oracle-databaser", { underline: true })
			doc.moveDown()

			for (const evidence of auditEvidence) {
				if (doc.y > 700) doc.addPage()
				doc.fontSize(12).fillColor(dark).text(`${evidence.instanceId.toUpperCase()} — ${evidence.overallStatus}`, {
					underline: true,
				})
				doc.moveDown(0.5)
				doc
					.fontSize(9)
					.fillColor(gray)
					.text(`Hentet: ${evidence.collectedAt.toLocaleDateString("nb-NO")}`)
				doc.moveDown()
			}
		}

		// PDF attachment cover pages (these get merged as pages afterward)
		if (pdfAttachments.length > 0) {
			for (const att of pdfAttachments) {
				doc.addPage()
				doc.fontSize(14).fillColor(blue).text("Vedlegg (PDF)")
				doc.moveDown(0.5)
				doc.fontSize(16).fillColor(dark).text(att.fileName)
				doc.moveDown(0.5)
				doc.fontSize(10).fillColor(gray)
				doc.text(`Filtype: ${att.contentType}`)
				doc.text(`Størrelse: ${fmtSize(att.data.length)}`)
				doc.moveDown(1)

				const parentReview = reviews.find((r) => r.attachments.some((a) => a.fileName === att.fileName))
				if (parentReview) {
					doc.fontSize(10).fillColor(dark)
					doc.text(`Tilhører gjennomgang: ${parentReview.title}`)
					doc.text(`Rutine: ${parentReview.routineName}`)
					doc.text(`Gjennomgangsdato: ${new Date(parentReview.reviewedAt).toLocaleString("nb-NO")}`)
				}

				doc.moveDown(1)
				doc.fontSize(10).fillColor(gray).text("Dokumentet følger på neste side(r).")
			}
		}

		// Non-PDF attachments — referenced, included in zip
		if (nonPdfAttachments.length > 0 || failedAttachments.length > 0) {
			doc.addPage()
			doc.fontSize(14).fillColor(blue).text("Vedlegg (i vedleggspakken)")
			doc.moveDown(0.5)
			doc.fontSize(9).fillColor(gray).text("Filene nedenfor er inkludert i vedlegg/-mappen i den nedlastede zip-filen.")
			doc.moveDown(0.5)

			for (const att of nonPdfAttachments) {
				if (doc.y > 700) doc.addPage()
				doc.fontSize(10).fillColor(dark).text(`• ${att.fileName}`)
				const fpSuffix = att.followUpPointText
					? ` — Oppfølgingspunkt (${att.followUpKind === "description" ? "beskrivelse" : "oppfølging"}): ${att.followUpPointText}`
					: ""
				doc
					.fontSize(8)
					.fillColor(gray)
					.text(
						`  Filtype: ${att.contentType} — Størrelse: ${fmtSize(att.data.length)} — Gjennomgang: ${att.reviewTitle}${fpSuffix}`,
					)
				doc.moveDown(0.3)
			}

			if (failedAttachments.length > 0) {
				doc.moveDown(0.5)
				doc.fontSize(10).fillColor("#ba3a26").text("Filer som ikke kunne lastes ned:")
				doc.moveDown(0.3)
				for (const att of failedAttachments) {
					const fpSuffix = att.followUpPointText ? ` — Oppfølgingspunkt: ${att.followUpPointText}` : ""
					doc.fontSize(9).fillColor("#ba3a26").text(`• ${att.fileName} (${att.reviewTitle})${fpSuffix}`)
				}
			}
		}

		doc.end()
	})
}

function followUpPointStatusLabel(status: "needs_follow_up" | "completed" | "not_relevant"): string {
	switch (status) {
		case "needs_follow_up":
			return "Må følges opp"
		case "completed":
			return "Fullført"
		case "not_relevant":
			return "Ikke relevant"
	}
}

function drawRow(
	doc: InstanceType<typeof PDFDocument>,
	x: number,
	widths: number[],
	cells: string[],
	isHeader: boolean,
	headerColor: string,
	textColor: string,
) {
	if (doc.y > 760) doc.addPage()
	const y = doc.y
	const h = 16
	const totalW = widths.reduce((a, b) => a + b, 0)
	if (isHeader) doc.rect(x, y, totalW, h).fill("#e6f0ff")
	doc.fontSize(7).fillColor(isHeader ? headerColor : textColor)
	let cx = x
	for (let i = 0; i < cells.length; i++) {
		doc.text(cells[i], cx + 3, y + 3, { width: widths[i] - 6, height: h - 2, lineBreak: false, ellipsis: true })
		cx += widths[i]
	}
	doc.strokeColor("#c6c2bf").lineWidth(0.5).rect(x, y, totalW, h).stroke()
	doc.y = y + h
	doc.x = x
}

function fmtSize(bytes: number) {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function escapeHtml(str: string): string {
	return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function buildReportHtml(data: {
	reportName: string
	timestamp: string
	appVersion: string
	scopeLabel: string
	frameworkVersionName: string
	totalApps: number
	totalAssessments: number
	implemented: number
	partial: number
	notImplemented: number
	notRelevant: number
	unassessed: number
	pct: (n: number) => string
	domainStats: Map<
		string,
		{ name: string; total: number; implemented: number; partial: number; notImplemented: number; notRelevant: number }
	>
	allRows: Array<{
		appName: string
		controlId: string
		controlName: string
		domain: string
		domainCode: string
		status: string | null
		comment: string | null
		assessedBy: string | null
		assessedAt: string | null
	}>
	routineRows: Array<{
		appName: string
		routineName: string
		frequency: string
		lastReview: string | null
		deadline: string | null
		status: string
	}>
}): string {
	const domainRowsHtml = [...data.domainStats.entries()]
		.map(
			([code, d]) => `
			<tr>
				<td>${escapeHtml(code)}</td>
				<td>${escapeHtml(d.name)}</td>
				<td>${d.total}</td>
				<td>${d.implemented}</td>
				<td>${d.partial}</td>
				<td>${d.notImplemented}</td>
				<td>${d.notRelevant}</td>
			</tr>`,
		)
		.join("")

	const detailRowsHtml = data.allRows
		.map(
			(row) => `
			<tr>
				<td>${escapeHtml(row.appName)}</td>
				<td>${escapeHtml(row.controlId)}</td>
				<td>${escapeHtml(row.controlName)}</td>
				<td>${escapeHtml(row.domainCode)}</td>
				<td>${escapeHtml(getStatusLabel(row.status))}</td>
				<td>${escapeHtml(row.comment ?? "")}</td>
			</tr>`,
		)
		.join("")

	const routineRowsHtml = data.routineRows
		.map(
			(row) => `
			<tr>
				<td>${escapeHtml(row.appName)}</td>
				<td>${escapeHtml(row.routineName)}</td>
				<td>${escapeHtml(row.frequency)}</td>
				<td>${row.lastReview ? new Date(row.lastReview).toLocaleDateString("nb-NO") : "Aldri"}</td>
				<td>${row.deadline ? new Date(row.deadline).toLocaleDateString("nb-NO") : "Ingen frist"}</td>
				<td>${escapeHtml(row.status)}</td>
			</tr>`,
		)
		.join("")

	return `<!DOCTYPE html>
<html lang="nb">
<head>
	<meta charset="utf-8" />
	<title>${escapeHtml(data.reportName)}</title>
	<style>
		body { font-family: "Source Sans Pro", Arial, sans-serif; margin: 2rem; color: #222; }
		h1, h2, h3 { color: #0067c5; }
		table { border-collapse: collapse; width: 100%; margin-bottom: 2rem; }
		th, td { border: 1px solid #c6c2bf; padding: 0.5rem 0.75rem; text-align: left; }
		th { background: #e6f0ff; }
		.meta { margin-bottom: 2rem; }
		.meta dt { font-weight: bold; display: inline; }
		.meta dd { display: inline; margin: 0 1rem 0 0; }
		.summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
		.summary-card { background: #f5f5f5; border-radius: 4px; padding: 1rem; text-align: center; }
		.summary-card .value { font-size: 2rem; font-weight: bold; color: #0067c5; }
		.summary-card .label { font-size: 0.875rem; color: #666; }
	</style>
</head>
<body>
	<h1>${escapeHtml(data.reportName)}</h1>
	<dl class="meta">
		<dt>Generert:</dt><dd>${new Date(data.timestamp).toLocaleString("nb-NO")}</dd>
		<dt>Omfang:</dt><dd>${escapeHtml(data.scopeLabel)}</dd>
		<dt>Rammeverk:</dt><dd>${escapeHtml(data.frameworkVersionName)}</dd>
		<dt>Appversjon:</dt><dd>${escapeHtml(data.appVersion)}</dd>
	</dl>

	<h2>Oppsummering</h2>
	<div class="summary-grid">
		<div class="summary-card"><div class="value">${data.totalApps}</div><div class="label">Applikasjoner</div></div>
		<div class="summary-card"><div class="value">${data.totalAssessments}</div><div class="label">Kontrollvurderinger</div></div>
		<div class="summary-card"><div class="value">${data.pct(data.implemented)}%</div><div class="label">Implementert</div></div>
		<div class="summary-card"><div class="value">${data.pct(data.partial)}%</div><div class="label">Delvis implementert</div></div>
		<div class="summary-card"><div class="value">${data.pct(data.notImplemented)}%</div><div class="label">Ikke implementert</div></div>
		<div class="summary-card"><div class="value">${data.pct(data.notRelevant)}%</div><div class="label">Ikke relevant</div></div>
	</div>

	<h2>Per domene</h2>
	<table>
		<thead>
			<tr>
				<th>Kode</th>
				<th>Domene</th>
				<th>Totalt</th>
				<th>Implementert</th>
				<th>Delvis</th>
				<th>Ikke impl.</th>
				<th>Ikke relevant</th>
			</tr>
		</thead>
		<tbody>${domainRowsHtml}</tbody>
	</table>

	<h2>Detaljer per applikasjon</h2>
	<table>
		<thead>
			<tr>
				<th>Applikasjon</th>
				<th>Kontroll-ID</th>
				<th>Kontrollnavn</th>
				<th>Domene</th>
				<th>Status</th>
				<th>Kommentar</th>
			</tr>
		</thead>
		<tbody>${detailRowsHtml}</tbody>
	</table>
${
	data.routineRows.length > 0
		? `
	<h2>Rutinestatus</h2>
	<table>
		<thead>
			<tr>
				<th>Applikasjon</th>
				<th>Rutine</th>
				<th>Frekvens</th>
				<th>Siste gjennomgang</th>
				<th>Frist</th>
				<th>Status</th>
			</tr>
		</thead>
		<tbody>${routineRowsHtml}</tbody>
	</table>
`
		: ""
}
</body>
</html>`
}
