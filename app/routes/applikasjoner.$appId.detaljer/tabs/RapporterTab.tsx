import { ReportsPanel } from "../components/ReportsPanel"

export function RapporterTab({
	appReports,
	completedReviews,
}: {
	appReports: Array<{
		id: string
		name: string
		createdAt: string
		createdBy: string
		reportBucketPath: string | null
	}>
	completedReviews: Array<{
		id: string
		title: string
		routineName: string
		reviewedAt: Date | string
		status: string
		createdBy: string
	}>
}) {
	return <ReportsPanel appReports={appReports} completedReviews={completedReviews} />
}
