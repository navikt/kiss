import { BodyShort, Box, Detail, Heading, HGrid, Tag, VStack } from "@navikt/ds-react"

interface DeploymentStats {
	appsWithData: number
	fourEyesPercent: number | null
	fourEyesTotal: number
	fourEyesApproved: number
	changeOriginPercent: number | null
	changeOriginTotal: number
	changeOriginLinked: number
}

function coverageTag(percent: number | null) {
	if (percent === null) return <Tag variant="neutral-moderate">Ingen data</Tag>
	if (percent >= 80) return <Tag variant="success-moderate">{percent}%</Tag>
	if (percent >= 60) return <Tag variant="warning-moderate">{percent}%</Tag>
	return <Tag variant="error-moderate">{percent}%</Tag>
}

export function DeploymentSummaryCards({ stats }: { stats: DeploymentStats }) {
	if (stats.appsWithData === 0) return null

	return (
		<>
			<Heading size="large" level="3">
				Deployment-verifisering
			</Heading>
			<HGrid gap="space-6" columns={{ xs: 1, sm: 3 }}>
				<Box padding="space-6" borderRadius="8" background="sunken">
					<VStack align="center" gap="space-2">
						<Detail>Deployments i år</Detail>
						<Heading size="xlarge" level="3">
							{stats.fourEyesTotal}
						</Heading>
						<BodyShort size="small">{stats.appsWithData} applikasjoner overvåket</BodyShort>
					</VStack>
				</Box>
				<Box padding="space-6" borderRadius="8" background="sunken">
					<VStack align="center" gap="space-2">
						<Detail>4-øyne-dekning</Detail>
						<Heading size="xlarge" level="3">
							{coverageTag(stats.fourEyesPercent)}
						</Heading>
						<BodyShort size="small">
							{stats.fourEyesApproved} av {stats.fourEyesTotal} godkjent
						</BodyShort>
					</VStack>
				</Box>
				<Box padding="space-6" borderRadius="8" background="sunken">
					<VStack align="center" gap="space-2">
						<Detail>Endringsopphav</Detail>
						<Heading size="xlarge" level="3">
							{coverageTag(stats.changeOriginPercent)}
						</Heading>
						<BodyShort size="small">
							{stats.changeOriginLinked} av {stats.changeOriginTotal} koblet
						</BodyShort>
					</VStack>
				</Box>
			</HGrid>
		</>
	)
}
