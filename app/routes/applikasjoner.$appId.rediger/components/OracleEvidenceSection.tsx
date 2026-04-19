import { BodyLong, BodyShort, Box, Button, Heading, HStack, Select, Tag, VStack } from "@navikt/ds-react"
import { Form, useFetcher } from "react-router"
import { statusVariant } from "../shared"

type OracleInstance = {
	id: string
	instanceId: string
	includeInReport: boolean
	latestSnapshot: { overallStatus: string; fetchedAt: Date | string } | null
}

function FetchEvidenceButton({ instanceId }: { instanceId: string }) {
	const fetcher = useFetcher()
	const isLoading = fetcher.state !== "idle"
	return (
		<fetcher.Form method="post" style={{ display: "inline" }}>
			<input type="hidden" name="intent" value="fetchEvidence" />
			<input type="hidden" name="instanceId" value={instanceId} />
			<Button variant="secondary" size="xsmall" type="submit" loading={isLoading}>
				Hent bevis
			</Button>
		</fetcher.Form>
	)
}

export function OracleEvidenceSection({
	oracleInstances,
	availableOracleInstances,
}: {
	oracleInstances: OracleInstance[]
	availableOracleInstances: Array<{ id: string; name: string }>
}) {
	return (
		<Box>
			<Heading size="medium" level="3" spacing>
				Oracle-revisjonsbevis
			</Heading>
			<BodyLong spacing>
				Konfigurer hvilke Oracle-instanser som skal hente revisjonsbevis for denne applikasjonen.
			</BodyLong>

			{oracleInstances.length > 0 ? (
				<VStack gap="space-4">
					{oracleInstances.map((inst) => (
						<Box key={inst.id} borderWidth="1" borderColor="neutral-subtle" padding="space-8" borderRadius="8">
							<VStack gap="space-4">
								<HStack gap="space-4" align="center" wrap>
									<Tag variant="info" size="small">
										{inst.instanceId.toUpperCase()}
									</Tag>
									{inst.latestSnapshot ? (
										<Tag variant={statusVariant(inst.latestSnapshot.overallStatus)} size="xsmall">
											{inst.latestSnapshot.overallStatus}
										</Tag>
									) : (
										<Tag variant="neutral" size="xsmall">
											Ikke hentet
										</Tag>
									)}
									{inst.latestSnapshot && (
										<BodyShort size="small" style={{ color: "var(--ax-text-subtle)" }}>
											Hentet {new Date(inst.latestSnapshot.fetchedAt).toLocaleString("nb-NO")}
										</BodyShort>
									)}
								</HStack>
								<HStack gap="space-2" align="center">
									<FetchEvidenceButton instanceId={inst.instanceId} />
									<Form method="post" style={{ display: "inline" }}>
										<input type="hidden" name="intent" value="toggleOracleReport" />
										<input type="hidden" name="instanceId" value={inst.instanceId} />
										<input type="hidden" name="include" value={inst.includeInReport ? "false" : "true"} />
										<Button variant="tertiary" size="xsmall" type="submit">
											{inst.includeInReport ? "Fjern fra rapport" : "Ta med i rapport"}
										</Button>
									</Form>
									<Form method="post" style={{ display: "inline" }}>
										<input type="hidden" name="intent" value="removeOracleInstance" />
										<input type="hidden" name="instanceId" value={inst.instanceId} />
										<Button variant="tertiary-neutral" size="xsmall" type="submit">
											Fjern
										</Button>
									</Form>
								</HStack>
							</VStack>
						</Box>
					))}
				</VStack>
			) : (
				<BodyLong>Ingen Oracle-instanser er konfigurert.</BodyLong>
			)}

			{availableOracleInstances.length > 0 && (
				<Form method="post" style={{ marginTop: "var(--ax-space-8)" }}>
					<input type="hidden" name="intent" value="addOracleInstance" />
					<HStack gap="space-2" align="end">
						<Select label="Legg til Oracle-instans" name="instanceId" size="small">
							{availableOracleInstances.map((inst) => (
								<option key={inst.id} value={inst.id}>
									{inst.id.toUpperCase()} ({inst.name})
								</option>
							))}
						</Select>
						<Button variant="secondary" size="small" type="submit">
							Legg til
						</Button>
					</HStack>
				</Form>
			)}
		</Box>
	)
}
