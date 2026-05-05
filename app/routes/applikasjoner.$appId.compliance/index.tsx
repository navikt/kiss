import { Heading, VStack } from "@navikt/ds-react"
import { useActionData, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import type { action } from "./action.server"
import { ScreeningWizard } from "./components/ScreeningWizard"
import styles from "./components/wizard.module.css"
import type { loader } from "./loader.server"

export { action } from "./action.server"
export { loader } from "./loader.server"
export { RouteErrorBoundary as ErrorBoundary }

export default function ComplianceAssessment() {
	const {
		appName,
		screening,
		persistence,
		rulesetOptions,
		entraGroupsData,
		oracleRolesData,
		economyClassification,
		canAdmin,
	} = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()

	return (
		<section className={styles.page} aria-label="Compliance-vurdering">
			<VStack gap="space-8">
				<Heading size="xlarge" level="2">
					Compliance-vurdering: {appName}
				</Heading>

				{actionData?.success && (
					<div className="compliance-success" role="status" aria-live="polite">
						Svar på innledende spørsmål er lagret.
					</div>
				)}

				<ScreeningWizard
					screening={screening}
					persistence={persistence}
					rulesetOptions={rulesetOptions}
					entraGroupsData={entraGroupsData}
					oracleRolesData={oracleRolesData}
					economyClassification={economyClassification}
					canAdmin={canAdmin}
				/>
			</VStack>
		</section>
	)
}
