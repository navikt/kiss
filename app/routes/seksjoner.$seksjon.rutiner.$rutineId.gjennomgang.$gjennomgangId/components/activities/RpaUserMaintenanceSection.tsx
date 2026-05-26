import {
	Alert,
	BodyShort,
	Detail,
	Heading,
	HGrid,
	HStack,
	Label,
	Select,
	Tag,
	Textarea,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { useEffect, useState } from "react"
import { useFetcher } from "react-router"
import { RPA_DECISION_VALUES, type RpaDecision } from "~/db/schema/routines"
import type { RpaMaintenanceData, RpaUserAssessmentEntry, RpaUserEntry } from "~/lib/rpa-staged-data"
import type { ActivityProp } from "../shared"

export type { RpaMaintenanceData, RpaUserAssessmentEntry, RpaUserEntry }

const RPA_DECISION_LABELS: Record<(typeof RPA_DECISION_VALUES)[number], string> = {
	avvikles: "Avvikles",
	endres: "Endres",
	videreføres: "Videreføres",
}
const RPA_DECISIONS = RPA_DECISION_VALUES.map((value) => ({ value, label: RPA_DECISION_LABELS[value] }))

function RpaUserCard({
	user,
	assessment,
	isDraft,
}: {
	user: RpaMaintenanceData["users"][number]
	assessment: RpaMaintenanceData["assessments"][string] | undefined
	isDraft: boolean
}) {
	// Use separate fetchers per field group so that submitting one field cannot
	// cancel an in-flight request for a different field (React Router aborts
	// the previous request on the same fetcher when a new submit is made).
	const textFetcher = useFetcher() // owner, needComment, criticalityComment, securityComment
	const decisionFetcher = useFetcher() // decision
	const deadlineFetcher = useFetcher() // decisionDeadline

	// Track the selected decision in local state so that `showDeadline` stays
	// stable when the in-flight fetcher is submitting a different field (e.g.
	// decisionDeadline on blur) and fetcher.formData therefore has no "decision"
	// key — which would otherwise cause the deadline field to flicker away.
	const [localDecision, setLocalDecision] = useState<RpaDecision | null>(assessment?.decision ?? null)
	useEffect(() => {
		setLocalDecision(assessment?.decision ?? null)
	}, [assessment?.decision])
	const decision = localDecision
	const showDeadline = decision === "avvikles" || decision === "endres"

	function submitField(
		fetcher: ReturnType<typeof useFetcher>,
		name: string,
		value: string,
		currentValue?: string | null,
		extraFields?: Record<string, string>,
	) {
		// Skip submit if trimmed value matches the current stored value (avoids no-op DB writes)
		if (currentValue !== undefined && value.trim() === (currentValue ?? "").trim()) return
		// Skip submit if there is no existing assessment and the value is empty (avoids creating empty rows)
		if (currentValue === undefined && !assessment && !value.trim()) return
		fetcher.submit(
			{
				intent: "save-rpa-user-assessment",
				userObjectId: user.userObjectId,
				[name]: value,
				...extraFields,
			},
			{ method: "POST" },
		)
	}

	return (
		<VStack gap="space-4">
			{/* Brukerinfo */}
			<HStack gap="space-4" align="center" justify="space-between" wrap={false}>
				<VStack gap="space-1">
					<BodyShort weight="semibold">{user.displayName ?? user.userObjectId}</BodyShort>
					<Detail>{user.userPrincipalName ?? "—"}</Detail>
				</VStack>
				<HStack gap="space-2">
					{user.matchSource === "removed" ? (
						<Tag variant="warning" size="small">
							Fjernet
						</Tag>
					) : (
						<>
							<Tag
								variant={
									user.accountEnabled === true ? "success" : user.accountEnabled === false ? "neutral" : "warning"
								}
								size="small"
							>
								{user.accountEnabled === true ? "Aktiv" : user.accountEnabled === false ? "Inaktiv" : "Ukjent"}
							</Tag>
							<Tag variant={user.matchSource === "nais" ? "info" : "alt3"} size="small">
								{user.matchSource === "nais" ? "Nais" : "Manuell"}
							</Tag>
							{user.rpaGroupName && (
								<Tag variant="neutral" size="small">
									{user.rpaGroupName}
								</Tag>
							)}
						</>
					)}
				</HStack>
			</HStack>

			<TextField
				label="Eier"
				description="Hvem er ansvarlig for denne brukeren? (navn og rolle)"
				size="small"
				defaultValue={assessment?.owner ?? ""}
				disabled={!isDraft}
				onBlur={(e) => submitField(textFetcher, "owner", e.target.value, assessment?.owner)}
			/>

			{/* Tjenstlig behov, kritikalitet og sikkerhet */}
			<HGrid columns={{ xs: 1, md: 3 }} gap="space-4">
				<Textarea
					label="Tjenstlig behov"
					description="Hva gjør roboten og kan oppgaven løses via API?"
					size="small"
					minRows={4}
					defaultValue={assessment?.needComment ?? ""}
					disabled={!isDraft}
					onBlur={(e) => submitField(textFetcher, "needComment", e.target.value, assessment?.needComment)}
				/>
				<Textarea
					label="Kritikalitet"
					description="Tilganger, sensitive data, mulig skadeomfang"
					size="small"
					minRows={4}
					defaultValue={assessment?.criticalityComment ?? ""}
					disabled={!isDraft}
					onBlur={(e) => submitField(textFetcher, "criticalityComment", e.target.value, assessment?.criticalityComment)}
				/>
				<Textarea
					label="Sikkerhet"
					description="Passordlagring, rotasjon, logging, kompenserende tiltak"
					size="small"
					minRows={4}
					defaultValue={assessment?.securityComment ?? ""}
					disabled={!isDraft}
					onBlur={(e) => submitField(textFetcher, "securityComment", e.target.value, assessment?.securityComment)}
				/>
			</HGrid>

			{/* Beslutning */}
			<HStack gap="space-4" align="end">
				<Select
					label="Beslutning"
					size="small"
					defaultValue={assessment?.decision ?? ""}
					disabled={!isDraft}
					onChange={(e) => {
						const val = (RPA_DECISION_VALUES as readonly string[]).includes(e.target.value)
							? (e.target.value as RpaDecision)
							: null
						setLocalDecision(val)
						submitField(decisionFetcher, "decision", e.target.value)
					}}
					style={{ minWidth: "12rem" }}
				>
					<option value="">Velg beslutning…</option>
					{RPA_DECISIONS.map((d) => (
						<option key={d.value} value={d.value}>
							{d.label}
						</option>
					))}
				</Select>
				{showDeadline && (
					<div>
						<Label size="small" htmlFor={`deadline-${user.userObjectId}`}>
							Frist
						</Label>
						<input
							id={`deadline-${user.userObjectId}`}
							type="date"
							defaultValue={assessment?.decisionDeadline ?? ""}
							disabled={!isDraft}
							onBlur={(e) =>
								submitField(
									deadlineFetcher,
									"decisionDeadline",
									e.target.value,
									assessment?.decisionDeadline,
									// Include localDecision to prevent race where deadline POST arrives before decision POST
									localDecision ? { decision: localDecision } : undefined,
								)
							}
							className="navds-text-field__input navds-body-short navds-body-medium"
							style={{ display: "block", marginTop: "var(--ax-space-1)" }}
						/>
					</div>
				)}
			</HStack>
		</VStack>
	)
}

export function RpaUserMaintenanceSection({
	activity,
	rpaMaintenanceData,
	isDraft,
}: {
	activity: ActivityProp
	rpaMaintenanceData: RpaMaintenanceData
	isDraft: boolean
}) {
	const { users, assessments } = rpaMaintenanceData
	return (
		<VStack gap="space-4">
			<Heading level="3" size="small">
				RPA-brukervedlikehold
			</Heading>
			<BodyShort>
				Gjennomgå alle RPA (Robotic Process Automation) brukere som har tilgang til applikasjonen. Kartlegg eier og
				tjenstlig behov, vurder kritikalitet og sikkerhet, og ta en beslutning per bruker.
			</BodyShort>
			{users.length === 0 ? (
				<Alert variant="info">Ingen RPA-brukere funnet for denne applikasjonen.</Alert>
			) : (
				<div style={{ marginTop: "var(--ax-space-32)" }}>
					{users.map((user, i) => (
						<div key={user.userObjectId}>
							{i > 0 && (
								<hr
									style={{
										border: "none",
										borderTop: "1px solid var(--ax-border-neutral-subtle)",
										marginBlock: "var(--ax-space-32)",
									}}
								/>
							)}
							<RpaUserCard user={user} assessment={assessments[user.userObjectId]} isDraft={isDraft} />
						</div>
					))}
				</div>
			)}
			{activity.status === "completed" && (
				<Alert variant="success" size="small">
					Aktiviteten er fullført.
				</Alert>
			)}
		</VStack>
	)
}
