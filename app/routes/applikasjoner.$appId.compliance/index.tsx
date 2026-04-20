import { Heading, VStack } from "@navikt/ds-react"
import { useActionData, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import type { action } from "./action.server"
import { ScreeningSection, ScreeningSidebar } from "./components/ScreeningSection"
import type { loader } from "./loader.server"

export { action } from "./action.server"
export { loader } from "./loader.server"
export { RouteErrorBoundary as ErrorBoundary }

export default function ComplianceAssessment() {
	const { appName, screening, persistence, rulesetOptions, entraGroupsData } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()

	return (
		<section className="compliance-layout" aria-label="Compliance-vurdering">
			<ScreeningSidebar screening={screening} />

			<div className="compliance-content" id="top">
				<VStack gap="space-8">
					<Heading size="xlarge" level="2">
						Compliance-vurdering: {appName}
					</Heading>

					{actionData?.success && (
						<div className="compliance-success" role="status" aria-live="polite">
							Svar på innledende spørsmål er lagret.
						</div>
					)}

					<ScreeningSection
						screening={screening}
						persistence={persistence}
						rulesetOptions={rulesetOptions}
						entraGroupsData={entraGroupsData}
					/>
				</VStack>
			</div>
		</section>
	)
}
