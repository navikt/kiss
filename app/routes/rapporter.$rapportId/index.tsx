import { BodyLong, Button, Heading, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getReport } from "~/db/queries/reports.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAuditor } from "~/lib/authorization.server"
import { getStorageProvider } from "~/lib/storage/index.server"

export async function loader({ params, request }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAuditor(authedUser)

	const rapportId = params.rapportId
	if (!rapportId) throw new Response("Mangler rapport-ID", { status: 400 })

	const report = await getReport(rapportId)
	if (!report) throw new Response("Rapport ikke funnet", { status: 404 })

	let htmlContent = ""
	if (report.reportBucketPath) {
		try {
			const storage = getStorageProvider()
			const buffer = await storage.download(report.reportBucketPath)
			htmlContent = buffer.toString("utf-8")
		} catch {
			htmlContent = "<p>Kunne ikke laste rapportinnhold.</p>"
		}
	}

	return data({
		report: {
			rapportId: report.id,
			name: report.name,
			type: report.reportType,
			scope: report.scope,
			createdAt: report.createdAt.toISOString(),
			createdBy: report.createdBy,
			appVersion: report.appVersion,
			reportBucketPath: report.reportBucketPath,
		},
		htmlContent,
	})
}

export default function RapportDetalj() {
	const { report, htmlContent } = useLoaderData<typeof loader>()

	const handleDownload = () => {
		const blob = new Blob([htmlContent], { type: "text/html" })
		const url = URL.createObjectURL(blob)
		const a = document.createElement("a")
		a.href = url
		a.download = `${report.name}.html`
		a.click()
		URL.revokeObjectURL(url)
	}

	return (
		<VStack gap="space-6">
			<Heading size="xlarge" level="2">
				{report.name}
			</Heading>

			<VStack gap="space-2">
				<Heading size="medium" level="3">
					Metadata
				</Heading>
				<BodyLong>
					<strong>Rapport-ID:</strong> {report.rapportId}
				</BodyLong>
				<BodyLong>
					<strong>Type:</strong> {report.type}
				</BodyLong>
				<BodyLong>
					<strong>Omfang:</strong> {report.scope === "all" ? "Alle seksjoner" : "Seksjon"}
				</BodyLong>
				<BodyLong>
					<strong>Opprettet:</strong> {new Date(report.createdAt).toLocaleString("nb-NO")}
				</BodyLong>
				<BodyLong>
					<strong>Opprettet av:</strong> {report.createdBy}
				</BodyLong>
				<BodyLong>
					<strong>Appversjon:</strong> {report.appVersion}
				</BodyLong>
			</VStack>

			{htmlContent && (
				<div>
					<Button variant="secondary" size="small" onClick={handleDownload}>
						Last ned rapport (HTML)
					</Button>
				</div>
			)}

			{htmlContent && (
				<VStack gap="space-4">
					<Heading size="medium" level="3">
						Rapportinnhold
					</Heading>
					<iframe
						title="Rapportinnhold"
						srcDoc={htmlContent}
						style={{
							border: "1px solid #c6c2bf",
							borderRadius: "4px",
							background: "#fff",
							width: "100%",
							minHeight: "80vh",
						}}
					/>
				</VStack>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
