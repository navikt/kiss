import { BodyShort, Heading, VStack } from "@navikt/ds-react"
import { EvidenceSection } from "~/components/evidence"

type Props = {
	activity: {
		id: string
		type: string
		status: string
		completedAt: string | null
		createdAt: string
		providerConfig?: unknown
		periodConfig?: { periodType: string; periodStart: string } | null
		changes: Array<{
			id: string
			changeType: string
			groupId: string
			groupName: string | null
			previousValue: string | null
			newValue: string | null
			performedBy: string
			performedAt: string
		}>
	} | null
	entraGroupsData: {
		naisGroupIds: string[]
		manualGroups: Array<{ id: string; groupId: string; groupName: string | null; createdBy: string; createdAt: string }>
		ghostGroupIds: string[]
		groupNames: Record<string, string>
		assessmentsByGroupId: Record<string, { criticality: string; updatedBy: string; updatedAt: string }>
	} | null
	oracleEvidenceData: {
		configuredInstances: Array<{ instanceId: string }>
		selectedInstanceId: string | null
		downloads: Array<{
			id: string
			instanceId: string
			evidenceType: string
			format: string
			fileName: string
			sizeBytes: number | null
			source: string
			apiInstanceName: string | null
			forceFetchJustification: string | null
			performedBy: string
			performedAt: string
		}>
		evidenceTypes: string[]
	} | null
	ndaEvidenceData: {
		appParams: { team: string; environment: string; appName: string } | null
		periodConfig: { periodType: string; periodStart: string } | null
		downloads: Array<{
			id: string
			format: string
			fileName: string
			sizeBytes: number | null
			source: string
			forceFetchJustification: string | null
			performedBy: string
			performedAt: string
		}>
	} | null
	evidenceProviderType: string | null
	isDraft: boolean
}

/**
 * StepActivity renders the maintenance activity / evidence section
 * in the review wizard. It delegates to the existing EntraMaintenanceSection
 * and EvidenceSection components from the parent route file.
 *
 * Note: EntraMaintenanceSection is defined in the parent index.tsx and not
 * extracted yet — the parent route renders it via the renderStep() switch.
 * This component handles the Oracle/NDA evidence provider cases.
 */
export function StepActivity({
	activity,
	entraGroupsData: _entraGroupsData,
	oracleEvidenceData,
	ndaEvidenceData,
	evidenceProviderType,
	isDraft,
}: Props) {
	if (!activity) {
		return (
			<VStack gap="space-6">
				<Heading size="medium" level="3">
					Vedlikeholdsaktivitet
				</Heading>
				<BodyShort textColor="subtle">Ingen vedlikeholdsaktivitet er tilknyttet denne gjennomgangen.</BodyShort>
			</VStack>
		)
	}

	return (
		<VStack gap="space-6">
			<div>
				<Heading size="medium" level="3" spacing>
					Vedlikeholdsaktivitet
				</Heading>
				<BodyShort size="small" textColor="subtle">
					Utfør vedlikeholdsaktiviteten og dokumenter eventuelle endringer.
				</BodyShort>
			</div>

			{/* Oracle evidence */}
			{evidenceProviderType === "oracle" && oracleEvidenceData && (
				<EvidenceSection
					providerType="oracle"
					activity={activity}
					evidenceData={oracleEvidenceData}
					isDraft={isDraft}
				/>
			)}

			{/* Deployment evidence (NDA) */}
			{evidenceProviderType === "deployments" && ndaEvidenceData && (
				<EvidenceSection
					providerType="deployments"
					activity={activity}
					evidenceData={ndaEvidenceData}
					isDraft={isDraft}
				/>
			)}

			{/* Entra maintenance is rendered directly from the parent since
			    EntraMaintenanceSection is a large component defined inline in the route.
			    For Entra activities, the parent's renderStep will compose this correctly. */}
		</VStack>
	)
}
