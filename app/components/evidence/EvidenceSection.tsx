/**
 * Generic evidence section wrapper that dispatches to the correct
 * provider-specific panel based on providerType.
 *
 * Uses a discriminated union so each provider carries its own data shape.
 */

import type { NdaEvidenceDataProp } from "./DeploymentEvidenceSection"
import { DeploymentEvidenceSection } from "./DeploymentEvidenceSection"
import type { OracleEvidenceDataProp } from "./OracleEvidenceSection"
import { OracleEvidenceSection } from "./OracleEvidenceSection"

interface ActivityProp {
	id: string
	type: string
	status: string
	completedAt: string | null
	createdAt: string
}

interface BaseProps {
	activity: ActivityProp
	isDraft: boolean
}

interface OracleProps extends BaseProps {
	providerType: "oracle"
	evidenceData: OracleEvidenceDataProp
}

interface DeploymentsProps extends BaseProps {
	providerType: "deployments"
	evidenceData: NdaEvidenceDataProp
}

type Props = OracleProps | DeploymentsProps

export function EvidenceSection(props: Props) {
	switch (props.providerType) {
		case "oracle":
			return (
				<OracleEvidenceSection
					activity={props.activity}
					oracleEvidenceData={props.evidenceData}
					isDraft={props.isDraft}
				/>
			)
		case "deployments":
			return (
				<DeploymentEvidenceSection
					activity={props.activity}
					evidenceData={props.evidenceData}
					isDraft={props.isDraft}
				/>
			)
		default: {
			const _exhaustive: never = props
			throw new Error(`Unknown provider type: ${String(_exhaustive)}`)
		}
	}
}
