import { Heading, VStack } from "@navikt/ds-react"
import { useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { DeleteSection } from "./components/DeleteSection"
import { ExportSection } from "./components/ExportSection"
import { LinkedAppsSection } from "./components/LinkedAppsSection"
import { LinkSuggestionsSection } from "./components/LinkSuggestionsSection"
import { OracleDatabaseLinkSection } from "./components/OracleDatabaseLinkSection"
import { OracleEvidenceSection } from "./components/OracleEvidenceSection"
import { PrimaryAppNotice } from "./components/PrimaryAppNotice"
import { RenameSection } from "./components/RenameSection"
import { TeamsSection } from "./components/TeamsSection"
import { TechnologyElementsSection } from "./components/TechnologyElementsSection"
import type { loader } from "./loader.server"

export { action } from "./action.server"
export { loader } from "./loader.server"
export { RouteErrorBoundary as ErrorBoundary }

export default function ApplikasjonRediger() {
	const {
		app,
		teams,
		primaryApp,
		linkedApps,
		linkSuggestions,
		appElements,
		availableElements,
		availableTeams,
		oracleInstances,
		availableOracleInstances,
		oraclePersistence,
		canDelete,
	} = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-24">
			<Heading size="xlarge" level="2" spacing>
				Administrer {app.name}
			</Heading>

			{primaryApp && <PrimaryAppNotice primaryApp={primaryApp} />}

			<RenameSection name={app.name} />

			<TeamsSection teams={teams} availableTeams={availableTeams} />

			<TechnologyElementsSection appElements={appElements} availableElements={availableElements} />

			<OracleEvidenceSection oracleInstances={oracleInstances} availableOracleInstances={availableOracleInstances} />

			{oraclePersistence.length > 0 && oracleInstances.length > 0 && (
				<OracleDatabaseLinkSection oraclePersistence={oraclePersistence} oracleInstances={oracleInstances} />
			)}

			{linkedApps.length > 0 && <LinkedAppsSection linkedApps={linkedApps} />}

			{!primaryApp && linkSuggestions.length > 0 && <LinkSuggestionsSection linkSuggestions={linkSuggestions} />}

			<ExportSection appId={app.id} />

			{canDelete && <DeleteSection appName={app.name} />}
		</VStack>
	)
}
