import { DeploymentVerificationPanel } from "../components/DeploymentVerificationPanel"

export function DeploymentsTab({
	deploymentVerifications,
}: {
	deploymentVerifications: Array<{
		environment: string
		appName: string
		teamSlug: string
		status: string
		fourEyesCoveragePercent: number | null
		fourEyesTotal: number | null
		fourEyesApproved: number | null
		changeOriginCoveragePercent: number | null
		changeOriginTotal: number | null
		changeOriginLinked: number | null
		lastDeploymentAt: string | null
		fetchedAt: string
		rawSummary: {
			fourEyesCoverage: { unapproved: number; pending: number }
			changeOriginCoverage: { dependabot: number }
			lastDeployment: {
				createdAt: string
				deployer: string | null
				commitSha: string | null
				fourEyesStatus: string
				hasChangeOrigin: boolean
			} | null
		}
	}>
}) {
	return <DeploymentVerificationPanel verifications={deploymentVerifications} />
}
