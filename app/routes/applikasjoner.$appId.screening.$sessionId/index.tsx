import { Button, Heading, HStack, VStack } from "@navikt/ds-react"
import { useCallback } from "react"
import { Form, useLoaderData, useSearchParams } from "react-router"
import { ParticipantsCombobox } from "~/components/ParticipantsCombobox"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { ScreeningWizard } from "./components/ScreeningWizard"
import type { loader } from "./loader.server"

export { action } from "./action.server"
export { loader } from "./loader.server"
export { RouteErrorBoundary as ErrorBoundary }

export default function ScreeningSession() {
	const {
		appName,
		session,
		screening,
		persistence,
		rulesetOptions,
		entraGroupsData,
		oracleRolesData,
		economyClassification,
		canAdmin,
	} = useLoaderData<typeof loader>()

	const [searchParams, setSearchParams] = useSearchParams()
	const stepParam = searchParams.get("step")
	const isCompleted = session.status === "completed"
	const isParticipantsStep = stepParam === "participants" || (!isCompleted && stepParam === null)

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
		isDone: session.participants.length > 0 && !isParticipantsStep,
		label: "Deltakere",
		onNavigate: navigateToParticipants,
	}

	return (
		<VStack gap="space-8" style={{ maxWidth: "80rem", margin: "0 auto", padding: "var(--ax-space-8)" }}>
			<Heading size="xlarge" level="2">
				{session.title}: {appName}
			</Heading>

			{!isCompleted && (
				<ScreeningWizard
					screening={screening}
					persistence={persistence}
					rulesetOptions={rulesetOptions}
					entraGroupsData={entraGroupsData}
					oracleRolesData={oracleRolesData}
					economyClassification={economyClassification}
					canAdmin={canAdmin}
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
								defaultParticipants={session.participants.map((p) => ({
									navIdent: p.userIdent,
									displayName: p.userName,
								}))}
							/>
						</VStack>
					}
					completionAction={
						<HStack gap="space-4" justify="end">
							<Form method="post">
								<input type="hidden" name="intent" value="complete" />
								<Button type="submit" variant="primary">
									Fullfør screening
								</Button>
							</Form>
						</HStack>
					}
				/>
			)}

			{isCompleted && (
				<VStack gap="space-4">
					<Heading size="medium" level="3">
						Screeningen er fullført
					</Heading>
					<ScreeningWizard
						screening={screening}
						persistence={persistence}
						rulesetOptions={rulesetOptions}
						entraGroupsData={entraGroupsData}
						oracleRolesData={oracleRolesData}
						economyClassification={economyClassification}
						canAdmin={false}
						participantsStep={{
							isActive: isParticipantsStep,
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
									{session.participants.map((p) => (
										<li key={p.userIdent}>{p.userName ?? p.userIdent}</li>
									))}
								</ul>
							</VStack>
						}
					/>
				</VStack>
			)}
		</VStack>
	)
}
