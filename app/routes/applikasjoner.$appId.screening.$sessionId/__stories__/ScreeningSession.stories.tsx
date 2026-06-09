import { Button, Heading, HStack, VStack } from "@navikt/ds-react"
import type { Meta, StoryObj } from "@storybook/react"
import { useCallback } from "react"
import { createMemoryRouter, RouterProvider, useSearchParams } from "react-router"
import { ParticipantsCombobox } from "~/components/ParticipantsCombobox"
import { ScreeningWizard } from "~/routes/applikasjoner.$appId.screening.$sessionId/components/ScreeningWizard"
import {
	allAnsweredScreening,
	answered,
	defaultWizardArgs,
	enrichedWizardArgs,
	mockParticipants,
	mockScreening,
} from "./mock-data"

function SessionPage({
	title,
	appName,
	participants,
	isCompleted,
	screening,
	wizardArgs,
}: {
	title: string
	appName: string
	participants: Array<{ id: string; userIdent: string; userName: string | null }>
	isCompleted: boolean
	screening: typeof mockScreening
	wizardArgs: typeof defaultWizardArgs
}) {
	const [searchParams, setSearchParams] = useSearchParams()
	const stepParam = searchParams.get("step")
	const isParticipantsStep = !isCompleted && (stepParam === "participants" || stepParam === null)

	const navigateToParticipants = useCallback(() => {
		setSearchParams(
			(prev) => {
				const next = new URLSearchParams(prev)
				next.set("step", "participants")
				return next
			},
			{ replace: true },
		)
	}, [setSearchParams])

	const participantsStepProps = {
		isActive: isParticipantsStep,
		isDone: participants.length > 0 && !isParticipantsStep,
		label: "Deltakere",
		onNavigate: navigateToParticipants,
	}

	return (
		<VStack gap="space-8" style={{ maxWidth: "80rem", margin: "0 auto", padding: "var(--ax-space-8)" }}>
			<Heading size="xlarge" level="2">
				{title}: {appName}
			</Heading>

			{!isCompleted && (
				<ScreeningWizard
					{...wizardArgs}
					screening={screening}
					autoSave
					participantsStep={participantsStepProps}
					participantsContent={
						<VStack gap="space-6">
							<Heading size="small" level="3">
								Deltakere
							</Heading>
							<ParticipantsCombobox
								name="participants"
								label="Hvem deltar i screeningen?"
								description="Søk og legg til deltakere"
								defaultParticipants={participants.map((p) => ({
									navIdent: p.userIdent,
									displayName: p.userName,
								}))}
							/>
						</VStack>
					}
					completionAction={
						<HStack gap="space-4" justify="end">
							<Button type="button" variant="primary">
								Fullfør screening
							</Button>
						</HStack>
					}
				/>
			)}

			{isCompleted && (
				<>
					<Heading size="medium" level="3">
						Screeningen er fullført
					</Heading>
					<ScreeningWizard
						{...wizardArgs}
						screening={screening}
						canAdmin={false}
						participantsStep={{
							isActive: false,
							isDone: true,
							label: "Deltakere",
							onNavigate: navigateToParticipants,
						}}
						participantsContent={
							<VStack gap="space-6">
								<Heading size="small" level="3">
									Deltakere
								</Heading>
								<ul>
									{participants.map((p) => (
										<li key={p.userIdent}>{p.userName ?? p.userIdent}</li>
									))}
								</ul>
							</VStack>
						}
					/>
				</>
			)}
		</VStack>
	)
}

function DataRouterWrapper({
	children,
	initialStep,
	seksjon,
}: {
	children: React.ReactNode
	initialStep?: string
	seksjon?: string
}) {
	const basePath = seksjon ? `/seksjoner/${seksjon}/applikasjoner/mock-app/screening/mock-session` : "/"
	const initialEntry = initialStep ? `${basePath}?step=${initialStep}` : basePath
	const routePath = seksjon ? "/seksjoner/:seksjon/applikasjoner/:appId/screening/:sessionId" : "/"
	const router = createMemoryRouter(
		[
			{
				path: routePath,
				element: children,
				loader: () => null,
				action: async () => ({ ok: true }),
			},
			{
				path: "/api/graph/groups",
				loader: () => ({
					results: [
						{ id: "g-new-1", displayName: "ny-gruppe-fra-søk" },
						{ id: "g-new-2", displayName: "annen-gruppe" },
					],
				}),
			},
			{
				path: "/api/graph/users",
				loader: () => ({
					results: [
						{ navIdent: "Z994433", displayName: "Varm Solstråle", mail: "varm.solstrale@nav.no" },
						{ navIdent: "Z995544", displayName: "Klok Ugle", mail: "klok.ugle@nav.no" },
						{ navIdent: "Z996655", displayName: "Lat Kattunge", mail: "lat.kattunge@nav.no" },
					],
				}),
			},
		],
		{ initialEntries: [initialEntry] },
	)
	return <RouterProvider router={router} />
}

// ─── Meta ───────────────────────────────────────────────────────────

const meta = {
	title: "Screening/Screening-sesjon",
	parameters: {
		layout: "fullscreen",
	},
} satisfies Meta
export default meta
type Story = StoryObj

// ─── Stories ────────────────────────────────────────────────────────

export const DeltakereSteg: Story = {
	name: "Steg 1 – Deltakere (nytt)",
	render: () => (
		<DataRouterWrapper>
			<SessionPage
				title="Compliance-screening Q2 2026"
				appName="pensjon-sak"
				participants={[]}
				isCompleted={false}
				screening={mockScreening}
				wizardArgs={defaultWizardArgs}
			/>
		</DataRouterWrapper>
	),
}

export const DeltakereMedValgte: Story = {
	name: "Steg 1 – Deltakere (med valgte)",
	render: () => (
		<DataRouterWrapper>
			<SessionPage
				title="Compliance-screening Q2 2026"
				appName="pensjon-sak"
				participants={mockParticipants}
				isCompleted={false}
				screening={mockScreening}
				wizardArgs={defaultWizardArgs}
			/>
		</DataRouterWrapper>
	),
}

export const StegOkonomisystem: Story = {
	name: "Steg 2 – Økonomisystem",
	render: () => (
		<DataRouterWrapper initialStep="q-economy">
			<SessionPage
				title="Compliance-screening Q2 2026"
				appName="pensjon-sak"
				participants={mockParticipants}
				isCompleted={false}
				screening={mockScreening}
				wizardArgs={defaultWizardArgs}
			/>
		</DataRouterWrapper>
	),
}

export const StegBoolean: Story = {
	name: "Steg 3 – Personopplysninger (boolean)",
	render: () => (
		<DataRouterWrapper initialStep="q-boolean">
			<SessionPage
				title="Compliance-screening Q2 2026"
				appName="pensjon-sak"
				participants={mockParticipants}
				isCompleted={false}
				screening={answered(mockScreening, 0)}
				wizardArgs={defaultWizardArgs}
			/>
		</DataRouterWrapper>
	),
}

export const StegMedSporsmallenke: Story = {
	name: "Steg 3 – Personopplysninger (med spørsmålslenke)",
	render: () => (
		<DataRouterWrapper initialStep="q-boolean" seksjon="pensjon-og-ufore">
			<SessionPage
				title="Compliance-screening Q2 2026"
				appName="pensjon-sak"
				participants={mockParticipants}
				isCompleted={false}
				screening={answered(mockScreening, 0)}
				wizardArgs={defaultWizardArgs}
			/>
		</DataRouterWrapper>
	),
}

export const StegSingleChoice: Story = {
	name: "Steg 4 – Ekstern eksponering (single choice)",
	render: () => (
		<DataRouterWrapper initialStep="q-single">
			<SessionPage
				title="Compliance-screening Q2 2026"
				appName="pensjon-sak"
				participants={mockParticipants}
				isCompleted={false}
				screening={answered(mockScreening, 1)}
				wizardArgs={defaultWizardArgs}
			/>
		</DataRouterWrapper>
	),
}

export const StegPersistence: Story = {
	name: "Steg 5 – Lagringsløsninger (persistence)",
	render: () => (
		<DataRouterWrapper initialStep="q-persistence">
			<SessionPage
				title="Compliance-screening Q2 2026"
				appName="pensjon-sak"
				participants={mockParticipants}
				isCompleted={false}
				screening={answered(mockScreening, 2)}
				wizardArgs={defaultWizardArgs}
			/>
		</DataRouterWrapper>
	),
}

export const StegEntraGrupper: Story = {
	name: "Steg 6 – Entra ID-grupper",
	render: () => (
		<DataRouterWrapper initialStep="q-entra">
			<SessionPage
				title="Compliance-screening Q2 2026"
				appName="pensjon-sak"
				participants={mockParticipants}
				isCompleted={false}
				screening={answered(mockScreening, 3)}
				wizardArgs={defaultWizardArgs}
			/>
		</DataRouterWrapper>
	),
}

export const StegOracleRoller: Story = {
	name: "Steg 7 – Oracle-roller",
	render: () => (
		<DataRouterWrapper initialStep="q-oracle">
			<SessionPage
				title="Compliance-screening Q2 2026"
				appName="pensjon-sak"
				participants={mockParticipants}
				isCompleted={false}
				screening={answered(mockScreening, 4)}
				wizardArgs={defaultWizardArgs}
			/>
		</DataRouterWrapper>
	),
}

export const StegRegelsett: Story = {
	name: "Steg 8 – Regelsett",
	render: () => (
		<DataRouterWrapper initialStep="q-ruleset">
			<SessionPage
				title="Compliance-screening Q2 2026"
				appName="pensjon-sak"
				participants={mockParticipants}
				isCompleted={false}
				screening={answered(mockScreening, 5)}
				wizardArgs={defaultWizardArgs}
			/>
		</DataRouterWrapper>
	),
}

export const StegForvalgtRutine: Story = {
	name: "Steg 9 – Tilgangsstyring (forvalgt rutine)",
	render: () => (
		<DataRouterWrapper initialStep="q-routine-choice">
			<SessionPage
				title="Compliance-screening Q2 2026"
				appName="pensjon-sak"
				participants={mockParticipants}
				isCompleted={false}
				screening={answered(mockScreening, 5)}
				wizardArgs={defaultWizardArgs}
			/>
		</DataRouterWrapper>
	),
}

export const StegForvalgtRutineValgt: Story = {
	name: "Steg 9 – Tilgangsstyring (Ja – forvalgt rutine vises)",
	render: () => (
		<DataRouterWrapper initialStep="q-routine-choice">
			<SessionPage
				title="Compliance-screening Q2 2026"
				appName="pensjon-sak"
				participants={mockParticipants}
				isCompleted={false}
				screening={answered(mockScreening, 5).map((q) => (q.id === "q-routine-choice" ? { ...q, answer: "Ja" } : q))}
				wizardArgs={defaultWizardArgs}
			/>
		</DataRouterWrapper>
	),
}

export const StegForvalgtRutineNei: Story = {
	name: "Steg 9 – Tilgangsstyring (Nei – krever kommentar)",
	render: () => (
		<DataRouterWrapper initialStep="q-routine-choice">
			<SessionPage
				title="Compliance-screening Q2 2026"
				appName="pensjon-sak"
				participants={mockParticipants}
				isCompleted={false}
				screening={answered(mockScreening, 5).map((q) => (q.id === "q-routine-choice" ? { ...q, answer: "Nei" } : q))}
				wizardArgs={defaultWizardArgs}
			/>
		</DataRouterWrapper>
	),
}

export const AlleBesvartOppsummering: Story = {
	name: "Alle besvart – oppsummering",
	render: () => (
		<DataRouterWrapper initialStep="complete">
			<SessionPage
				title="Compliance-screening Q2 2026"
				appName="pensjon-sak"
				participants={mockParticipants}
				isCompleted={false}
				screening={allAnsweredScreening}
				wizardArgs={enrichedWizardArgs}
			/>
		</DataRouterWrapper>
	),
}

export const GjenstaarSporsmal: Story = {
	name: "Fullført-side med ubesvarte spørsmål",
	render: () => (
		<DataRouterWrapper initialStep="complete">
			<SessionPage
				title="Compliance-screening Q2 2026"
				appName="pensjon-sak"
				participants={mockParticipants}
				isCompleted={false}
				screening={answered(mockScreening, 2)}
				wizardArgs={defaultWizardArgs}
			/>
		</DataRouterWrapper>
	),
}

export const FullfortSesjon: Story = {
	name: "Fullført sesjon (read-only)",
	render: () => (
		<DataRouterWrapper initialStep="complete">
			<SessionPage
				title="Compliance-screening Q2 2026"
				appName="pensjon-sak"
				participants={mockParticipants}
				isCompleted={true}
				screening={allAnsweredScreening}
				wizardArgs={enrichedWizardArgs}
			/>
		</DataRouterWrapper>
	),
}
