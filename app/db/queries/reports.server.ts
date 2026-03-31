import { desc, eq, isNull, sql } from "drizzle-orm"
import { getStorageProvider } from "../../lib/storage/index.server"
import { db } from "../connection.server"
import { applicationTeamMappings, monitoredApplications } from "../schema/applications"
import { complianceAssessments } from "../schema/compliance"
import { frameworkControls, frameworkDomains, frameworkRiskControlMappings, frameworkRisks } from "../schema/framework"
import { devTeams, sections } from "../schema/organization"
import { reports } from "../schema/reports"
import { writeAuditLog } from "./audit.server"
import { saveBucketObject } from "./buckets.server"
import { getActiveFrameworkVersion } from "./framework.server"

/** Get all reports ordered by newest first. */
export async function getReports() {
	return db.select().from(reports).orderBy(desc(reports.createdAt))
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
		const teamsInSection = await db.select({ id: devTeams.id }).from(devTeams).where(eq(devTeams.sectionId, scopeId))

		const teamIds = teamsInSection.map((t) => t.id)
		if (teamIds.length === 0) {
			apps = []
		} else {
			const mappings = await db
				.select({ applicationId: applicationTeamMappings.applicationId })
				.from(applicationTeamMappings)
				.where(sql`${applicationTeamMappings.devTeamId} IN ${teamIds}`)

			const uniqueAppIds = [...new Set(mappings.map((m) => m.applicationId))]
			if (uniqueAppIds.length === 0) {
				apps = []
			} else {
				apps = await db
					.select({ id: monitoredApplications.id, name: monitoredApplications.name })
					.from(monitoredApplications)
					.where(sql`${monitoredApplications.id} IN ${uniqueAppIds}`)
					.orderBy(monitoredApplications.name)
			}
		}
	} else {
		apps = await db
			.select({ id: monitoredApplications.id, name: monitoredApplications.name })
			.from(monitoredApplications)
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
		.where(isNull(frameworkRisks.archivedAt))

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
}): string {
	const statusLabel: Record<string, string> = {
		implemented: "Implementert",
		partially_implemented: "Delvis implementert",
		not_implemented: "Ikke implementert",
		not_relevant: "Ikke relevant",
	}

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
				<td>${escapeHtml(statusLabel[row.status ?? ""] ?? "Ikke vurdert")}</td>
				<td>${escapeHtml(row.comment ?? "")}</td>
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
</body>
</html>`
}
