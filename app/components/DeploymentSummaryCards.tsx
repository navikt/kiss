import { BodyShort, Box, Detail, Heading, HelpText, HGrid, HStack, Tag, VStack } from "@navikt/ds-react"

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
	if (percent === 100) return <Tag variant="success-moderate">{percent}%</Tag>
	if (percent >= 80) return <Tag variant="warning-moderate">{percent}%</Tag>
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
						<HStack gap="space-8" align="center" justify="center">
							<Detail>Deployments i år</Detail>
							<HelpText title="Om deployments i år">
								Antall deployments i synkroniserte data fra deployment-audit for inneværende år. Bare applikasjoner med
								synkroniserte data inngår. Antallet overvåkede applikasjoner kan derfor være lavere enn antallet i
								applikasjonstabellen.
							</HelpText>
						</HStack>
						<Heading size="xlarge" level="3">
							{stats.fourEyesTotal}
						</Heading>
						<BodyShort size="small">{stats.appsWithData} applikasjoner overvåket</BodyShort>
					</VStack>
				</Box>
				<Box padding="space-6" borderRadius="8" background="sunken">
					<VStack align="center" gap="space-2">
						<HStack gap="space-8" align="center" justify="center">
							<Detail>4-øyne-dekning</Detail>
							<HelpText title="Om 4-øyne-dekning">
								Andelen deployments som deployment-audit har registrert som godkjent etter 4-øyne-prinsippet. Antall
								godkjente deles på totalt antall deployments i datagrunnlaget. «Ingen data» betyr at det ikke finnes
								deployments å beregne andelen fra.
							</HelpText>
						</HStack>
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
						<HStack gap="space-8" align="center" justify="center">
							<Detail>Endringsopphav</Detail>
							<HelpText title="Om endringsopphav">
								Andelen endringer som deployment-audit har koblet til et dokumentert endringsopphav. Antall koblede
								deles på totalt antall i datagrunnlaget for endringsopphav. Dette grunnlaget kan avvike fra antall
								deployments. «Ingen data» betyr at beregningsgrunnlaget er tomt.
							</HelpText>
						</HStack>
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
