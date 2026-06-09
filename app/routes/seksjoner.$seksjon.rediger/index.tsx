import { BodyShort, Button, Heading, HStack, Modal, Tabs, VStack } from "@navikt/ds-react"
import { useRef, useState } from "react"
import { Form, useLoaderData, useSearchParams } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import type { loader } from "./loader.server"
import type { LinkedNaisTeam } from "./shared"
import { AlleApplikasjonerTab } from "./tabs/AlleApplikasjonerTab"
import { DataTab } from "./tabs/DataTab"
import { NaisTab } from "./tabs/NaisTab"
import { SeksjonTab } from "./tabs/SeksjonTab"
import { UtviklingsteamTab } from "./tabs/UtviklingsteamTab"

export { action } from "./action.server"
export { loader } from "./loader.server"
export { RouteErrorBoundary as ErrorBoundary }

export default function RedigerSeksjon() {
	const {
		section,
		teams,
		linkedNaisTeams,
		unlinkedNaisTeams,
		sectionApps,
		ignoredApps,
		persistenceMap,
		sectionEnvironments,
		seksjon,
	} = useLoaderData<typeof loader>()
	const [searchParams, setSearchParams] = useSearchParams()
	const activeTab = searchParams.get("fane") ?? "seksjon"

	const unlinkNaisModalRef = useRef<HTMLDialogElement>(null)
	const [unlinkingNaisTeam, setUnlinkingNaisTeam] = useState<LinkedNaisTeam | null>(null)

	return (
		<VStack gap="space-6">
			<Heading size="xlarge" level="2" spacing>
				Rediger seksjon: {section.name}
			</Heading>

			<Tabs value={activeTab} onChange={(tab) => setSearchParams({ fane: tab }, { replace: true })}>
				<Tabs.List>
					<Tabs.Tab value="seksjon" label="Seksjon" />
					<Tabs.Tab value="team" label="Utviklingsteam" />
					<Tabs.Tab value="nais" label="Nais-team" />
					<Tabs.Tab value="alle-applikasjoner" label="Alle applikasjoner" />
					<Tabs.Tab value="data" label="Data" />
				</Tabs.List>

				<Tabs.Panel value="seksjon" style={{ paddingTop: "var(--ax-space-6)" }}>
					<SeksjonTab section={section} />
				</Tabs.Panel>

				<Tabs.Panel value="team" style={{ paddingTop: "var(--ax-space-6)" }}>
					<UtviklingsteamTab teams={teams} seksjon={seksjon} sectionName={section.name} />
				</Tabs.Panel>

				<Tabs.Panel value="nais" style={{ paddingTop: "var(--ax-space-6)" }}>
					<NaisTab
						linkedNaisTeams={linkedNaisTeams}
						unlinkedNaisTeams={unlinkedNaisTeams}
						sectionEnvironments={sectionEnvironments}
						onRequestUnlink={(team) => {
							setUnlinkingNaisTeam(team)
							unlinkNaisModalRef.current?.showModal()
						}}
					/>
				</Tabs.Panel>

				<Tabs.Panel value="alle-applikasjoner" style={{ paddingTop: "var(--ax-space-6)" }}>
					<AlleApplikasjonerTab
						sectionApps={sectionApps}
						teams={teams}
						persistenceMap={persistenceMap}
						ignoredApps={ignoredApps}
					/>
				</Tabs.Panel>

				<Tabs.Panel value="data" style={{ paddingTop: "var(--ax-space-6)" }}>
					<DataTab seksjon={seksjon} />
				</Tabs.Panel>
			</Tabs>

			<Modal ref={unlinkNaisModalRef} header={{ heading: "Fjern Nais-team fra seksjon" }}>
				<Modal.Body>
					<BodyShort>
						Er du sikker på at du vil fjerne <strong>{unlinkingNaisTeam?.slug}</strong> fra seksjonen?
					</BodyShort>
				</Modal.Body>
				<Modal.Footer>
					<Form method="post" onSubmit={() => unlinkNaisModalRef.current?.close()}>
						<input type="hidden" name="intent" value="unlink-nais-team" />
						<input type="hidden" name="naisTeamSlug" value={unlinkingNaisTeam?.slug ?? ""} />
						<HStack gap="space-4">
							<Button
								type="button"
								variant="secondary"
								size="small"
								onClick={() => unlinkNaisModalRef.current?.close()}
							>
								Avbryt
							</Button>
							<Button type="submit" variant="danger" size="small">
								Fjern
							</Button>
						</HStack>
					</Form>
				</Modal.Footer>
			</Modal>
		</VStack>
	)
}
