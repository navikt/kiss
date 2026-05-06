export function getFeatureFlags() {
	return {
		showComplianceStats: process.env.SHOW_COMPLIANCE_STATS !== "false",
	}
}

export type FeatureFlags = ReturnType<typeof getFeatureFlags>
