import { Alert, Detail, Heading, HGrid, HStack, Tag, VStack } from "@navikt/ds-react"
import { CoverageCard } from "./CoverageCard"

const STALENESS_THRESHOLD_MS = 2 * 60 * 60 * 1000

export function DeploymentVerificationPanel({
	verifications,
}: {
	verifications: Array<{
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
	if (verifications.length === 0) {
		return (
			<Alert variant="info" size="small">
				Ingen deployment-data tilgjengelig. Data hentes automatisk fra deployment-audit og oppdateres periodisk.
			</Alert>
		)
	}

	const allNotMonitored = verifications.every((v) => v.status === "not_monitored")
	if (allNotMonitored) {
		return (
			<Alert variant="info" size="small">
				Denne applikasjonen overvåkes ikke av deployment-audit. Kontakt plattformteamet for å aktivere overvåking.
			</Alert>
		)
	}

	const syncedVerifications = verifications.filter((v) => v.status === "synced")

	return (
		<VStack gap="space-16">
			{syncedVerifications.map((v) => {
				const isStale = v.fetchedAt && Date.now() - new Date(v.fetchedAt).getTime() > STALENESS_THRESHOLD_MS

				return (
					<VStack key={v.environment} gap="space-12">
						<HStack gap="space-8" align="center">
							<Heading size="small">{v.environment}</Heading>
							{isStale && (
								<Tag variant="neutral" size="xsmall">
									⚠️ Foreldet
								</Tag>
							)}
							<Detail>
								Sist oppdatert:{" "}
								{new Date(v.fetchedAt).toLocaleString("nb-NO", {
									day: "numeric",
									month: "short",
									hour: "2-digit",
									minute: "2-digit",
								})}
							</Detail>
						</HStack>

						<HGrid columns={{ xs: 1, md: 2 }} gap="space-12">
							<CoverageCard
								title="Fire-øyne-dekning"
								percent={v.fourEyesCoveragePercent}
								numerator={v.fourEyesApproved}
								denominator={v.fourEyesTotal}
								details={[
									{ label: "Ikke-godkjent", value: v.rawSummary?.fourEyesCoverage.unapproved ?? null },
									{ label: "Ventende", value: v.rawSummary?.fourEyesCoverage.pending ?? null },
								]}
							/>
							<CoverageCard
								title="Endringsopphav"
								percent={v.changeOriginCoveragePercent}
								numerator={v.changeOriginLinked}
								denominator={v.changeOriginTotal}
								details={[
									{
										label: "Dependabot",
										value: v.rawSummary?.changeOriginCoverage.dependabot ?? null,
									},
								]}
							/>
						</HGrid>
					</VStack>
				)
			})}
		</VStack>
	)
}
