import { useRouteLoaderData } from "react-router"

interface RootLoaderData {
	featureFlags: {
		showComplianceStats: boolean
	}
}

export function useFeatureFlags() {
	const data = useRouteLoaderData("root") as RootLoaderData | undefined
	return data?.featureFlags ?? { showComplianceStats: true }
}
