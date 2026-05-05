import { useRouteLoaderData } from "react-router"
import type { loader as rootLoader } from "~/root"

export function useFeatureFlags() {
	const data = useRouteLoaderData<typeof rootLoader>("root")
	return data?.featureFlags ?? { showComplianceStats: true }
}
