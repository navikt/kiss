import { BodyShort, Button, Detail, Heading, HStack, Label, Select, TextField, VStack } from "@navikt/ds-react"
import { useEffect, useMemo, useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, redirect, useLoaderData, useSearchParams } from "react-router"
import { MarkdownEditor } from "~/components/MarkdownEditor"
import { ParticipantsCombobox } from "~/components/ParticipantsCombobox"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import {
	autoCreateActivitiesForReview,
	createReview,
	getAppsRequiringRoutine,
	getRoutine,
	getRoutineActivityLinks,
} from "~/db/queries/routines.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import type { ReviewActivityProviderConfig } from "~/db/schema/routines"
import { getProviderTypeForActivity } from "~/lib/activity-types"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { parseParticipantsFormValue } from "~/lib/participants"

export async function loader({ params }: LoaderFunctionArgs) {
	const { seksjon, rutineId } = params
	if (!seksjon || !rutineId) {
		throw data({ message: "Mangler parametere" }, { status: 400 })
	}

	const section = await getSectionBySlug(seksjon)
	if (!section) {
		throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })
	}

	const routine = await getRoutine(rutineId)
	if (!routine) {
		throw data({ message: `Fant ikke rutine: ${rutineId}` }, { status: 404 })
	}

	if (routine.sectionId !== section.id) {
		throw data({ message: "Rutinen tilhører ikke denne seksjonen" }, { status: 403 })
	}

	if (routine.archivedAt) {
		throw data(
			{ message: "Kan ikke opprette gjennomgang for en arkivert rutine. Reaktiver rutinen først." },
			{ status: 403 },
		)
	}

	if (routine.status !== "approved") {
		throw data({ message: "Kun godkjente rutiner kan ha nye gjennomganger" }, { status: 400 })
	}

	const apps = await getAppsRequiringRoutine(rutineId)
	const activityLinks = await getRoutineActivityLinks(rutineId)

	// Determine provider type from activity links (fallback to legacy field for pre-migration routines)
	const activityTypes =
		activityLinks.length > 0
			? activityLinks.map((l) => l.activityType)
			: routine.activityType
				? [routine.activityType]
				: []
	const hasOracleActivity = activityTypes.some((t) => getProviderTypeForActivity(t) === "oracle")
	const oracleInstancesByAppId: Record<string, string[]> = {}
	if (hasOracleActivity && routine.isSectionRoutine !== 1) {
		const { getOracleInstancesForApps } = await import("~/db/queries/audit-evidence.server")
		const groupedInstances = await getOracleInstancesForApps(apps.map((app) => app.id))
		for (const app of apps) {
			oracleInstancesByAppId[app.id] = groupedInstances[app.id] ?? []
		}
	}

	return data({ section, routine, apps, oracleInstancesByAppId, hasOracleActivity })
}

export async function action({ request, params }: ActionFunctionArgs) {
	const { seksjon, rutineId } = params
	if (!seksjon || !rutineId) {
		throw data({ message: "Mangler parametere" }, { status: 400 })
	}

	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)

	const formData = await request.formData()
	const title = (formData.get("title") as string)?.trim()
	const applicationId = (formData.get("applicationId") as string) || null
	const reviewedAt = formData.get("reviewedAt") as string
	const reviewedTime = (formData.get("reviewedTime") as string) || "00:00"
	const summary = (formData.get("summary") as string)?.trim() || null
	const participantsRaw = formData.get("participants")
	const oracleInstanceIdRaw = (formData.get("oracleInstanceId") as string | null)?.trim() || ""

	if (!title) {
		throw data({ message: "Tittel er påkrevd" }, { status: 400 })
	}

	const participants = parseParticipantsFormValue(participantsRaw)

	// Validate section ownership and section routine handling
	const section = await getSectionBySlug(seksjon)
	if (!section) {
		throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })
	}
	const routine = await getRoutine(rutineId)
	if (!routine) {
		throw data({ message: `Fant ikke rutine: ${rutineId}` }, { status: 404 })
	}
	if (routine.sectionId !== section.id) {
		throw data({ message: "Rutinen tilhører ikke denne seksjonen" }, { status: 403 })
	}
	const effectiveAppId = routine.isSectionRoutine === 1 ? null : applicationId
	const activityLinks = await getRoutineActivityLinks(rutineId)
	const activityTypes =
		activityLinks.length > 0
			? activityLinks.map((l) => l.activityType)
			: routine.activityType
				? [routine.activityType]
				: []
	const hasOracleActivity = activityTypes.some((t) => getProviderTypeForActivity(t) === "oracle")
	let providerConfig: { instanceId: string } | null = null

	if (hasOracleActivity) {
		if (!effectiveAppId) {
			throw data({ message: "Oracle-revisjonsbevis krever at applikasjon er valgt" }, { status: 400 })
		}
		const { getOracleInstancesForApp } = await import("~/db/queries/audit-evidence.server")
		const configuredInstances = (await getOracleInstancesForApp(effectiveAppId)).map((instance) => instance.instanceId)
		if (configuredInstances.length === 0) {
			throw data({ message: "Ingen Oracle-instanser er konfigurert for valgt applikasjon" }, { status: 400 })
		}
		const selectedInstanceId = oracleInstanceIdRaw || (configuredInstances.length === 1 ? configuredInstances[0] : "")
		if (!selectedInstanceId) {
			throw data({ message: "Oracle-instans er påkrevd for denne gjennomgangen" }, { status: 400 })
		}
		if (!configuredInstances.includes(selectedInstanceId)) {
			throw data({ message: "Valgt Oracle-instans er ikke konfigurert for applikasjonen" }, { status: 400 })
		}
		providerConfig = { instanceId: selectedInstanceId }
	}

	const review = await createReview({
		routineId: rutineId,
		applicationId: effectiveAppId,
		title,
		summary,
		routineSnapshotPath: null,
		reviewedAt: reviewedAt ? new Date(`${reviewedAt}T${reviewedTime}`) : new Date(),
		createdBy: authedUser.navIdent,
		participants,
	})

	// Build provider config map for activities that need it (e.g., Oracle needs instance selection)
	const providerConfigs: Record<string, ReviewActivityProviderConfig> = {}
	if (providerConfig) {
		for (const actType of activityTypes) {
			const provType = getProviderTypeForActivity(actType)
			if (provType === "oracle") {
				providerConfigs[actType] = providerConfig
			}
		}
	}

	await autoCreateActivitiesForReview(review.id, rutineId, effectiveAppId, authedUser.navIdent, providerConfigs)

	return redirect(`/seksjoner/${seksjon}/rutiner/${rutineId}/gjennomgang/${review.id}?step=innledning`)
}

export default function NyGjennomgang() {
	const { routine, apps, oracleInstancesByAppId, hasOracleActivity } = useLoaderData<typeof loader>()
	const [searchParams] = useSearchParams()
	const preselectedAppId = searchParams.get("appId") ?? ""
	const [selectedAppId, setSelectedAppId] = useState(preselectedAppId)
	const [selectedOracleInstanceId, setSelectedOracleInstanceId] = useState("")
	const today = new Date().toISOString().split("T")[0]
	const defaultTitle = `${routine.name} — ${new Date().toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" })}`
	const instanceOptions = useMemo(
		() => (hasOracleActivity && selectedAppId ? (oracleInstancesByAppId[selectedAppId] ?? []) : []),
		[hasOracleActivity, oracleInstancesByAppId, selectedAppId],
	)
	const hasOracleInstanceSelection = hasOracleActivity && routine.isSectionRoutine !== 1 && selectedAppId

	useEffect(() => {
		setSelectedOracleInstanceId((previous) => {
			if (!hasOracleInstanceSelection) {
				return ""
			}
			if (previous && instanceOptions.includes(previous)) {
				return previous
			}
			return instanceOptions.length === 1 ? instanceOptions[0] : ""
		})
	}, [hasOracleInstanceSelection, instanceOptions])

	return (
		<VStack gap="space-8">
			<div>
				{preselectedAppId && (
					<Detail>
						<Link to={`/applikasjoner/${preselectedAppId}/detaljer?fane=rutiner`}>← Tilbake til applikasjon</Link>
					</Detail>
				)}
				<Heading size="xlarge" level="2" spacing>
					Ny gjennomgang — {routine.name}
				</Heading>
			</div>

			<Form method="post">
				<VStack gap="space-6">
					<TextField label="Tittel" name="title" size="small" autoComplete="off" defaultValue={defaultTitle} />

					{routine.isSectionRoutine === 1 ? (
						<BodyShort size="small" textColor="subtle">
							Seksjonsrutine — gjennomgangen gjelder alle applikasjoner i seksjonen.
						</BodyShort>
					) : (
						<>
							<Select
								label="Applikasjon"
								name="applicationId"
								size="small"
								defaultValue={preselectedAppId}
								disabled={!!preselectedAppId}
								onChange={(e) => setSelectedAppId(e.target.value)}
							>
								<option value="">
									{hasOracleActivity ? "Velg applikasjon" : "Generell (ikke applikasjonsspesifikk)"}
								</option>
								{apps.map((app) => (
									<option key={app.id} value={app.id}>
										{app.name}
									</option>
								))}
							</Select>
							{preselectedAppId && <input type="hidden" name="applicationId" value={preselectedAppId} />}
							{hasOracleInstanceSelection && (
								<Select
									label="Oracle-instans"
									name="oracleInstanceId"
									size="small"
									value={selectedOracleInstanceId}
									onChange={(e) => setSelectedOracleInstanceId(e.target.value)}
								>
									<option value="">Velg instans</option>
									{instanceOptions.map((instanceId) => (
										<option key={instanceId} value={instanceId}>
											{instanceId}
										</option>
									))}
								</Select>
							)}
						</>
					)}

					<HStack gap="space-6" align="end">
						<div>
							<Label size="small" htmlFor="reviewedAt">
								Dato for gjennomgang
							</Label>
							<input
								type="date"
								id="reviewedAt"
								name="reviewedAt"
								defaultValue={today}
								className="navds-text-field__input navds-body-short navds-body-short--small"
							/>
						</div>
						<div>
							<Label size="small" htmlFor="reviewedTime">
								Tidspunkt
							</Label>
							<input
								type="time"
								id="reviewedTime"
								name="reviewedTime"
								defaultValue={new Date().toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" })}
								className="navds-text-field__input navds-body-short navds-body-short--small"
							/>
						</div>
					</HStack>

					<MarkdownEditor label="Oppsummering/referat" name="summary" />

					<ParticipantsCombobox
						name="participants"
						label="Deltakere"
						description="Søk på navn eller e-post for å legge til personer. Du kan også skrive inn en NAV-ident direkte."
					/>

					<HStack gap="space-4">
						<Button type="submit" variant="primary" size="small">
							Opprett utkast
						</Button>
						<Button as={Link} to="../.." variant="tertiary" size="small">
							Avbryt
						</Button>
					</HStack>
				</VStack>
			</Form>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
