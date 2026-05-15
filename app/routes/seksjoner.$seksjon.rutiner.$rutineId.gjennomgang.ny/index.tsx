import { BodyShort, Button, Detail, Heading, HStack, Label, Select, TextField, VStack } from "@navikt/ds-react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, redirect, useLoaderData, useSearchParams } from "react-router"
import { MarkdownEditor } from "~/components/MarkdownEditor"
import { ParticipantsCombobox } from "~/components/ParticipantsCombobox"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import {
	autoCreateActivityForReview,
	createReview,
	getAppsRequiringRoutine,
	getRoutine,
} from "~/db/queries/routines.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
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

	const activityProviderType = routine.activityType ? getProviderTypeForActivity(routine.activityType) : null
	const oracleInstancesByAppId: Record<string, string[]> = {}
	if (activityProviderType === "oracle" && routine.isSectionRoutine !== 1) {
		const { getOracleInstancesForApp } = await import("~/db/queries/audit-evidence.server")
		const perApp = await Promise.all(
			apps.map(async (app) => ({
				appId: app.id,
				instances: (await getOracleInstancesForApp(app.id)).map((instance) => instance.instanceId),
			})),
		)
		for (const entry of perApp) {
			oracleInstancesByAppId[entry.appId] = entry.instances
		}
	}

	return data({ section, routine, apps, oracleInstancesByAppId, activityProviderType })
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
	const activityProviderType = routine.activityType ? getProviderTypeForActivity(routine.activityType) : null
	let providerConfig: { instanceId: string } | null = null

	if (activityProviderType === "oracle") {
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

	await autoCreateActivityForReview(review.id, rutineId, effectiveAppId, authedUser.navIdent, providerConfig)

	return redirect(`/seksjoner/${seksjon}/rutiner/${rutineId}/gjennomgang/${review.id}`)
}

export default function NyGjennomgang() {
	const { routine, apps, oracleInstancesByAppId, activityProviderType } = useLoaderData<typeof loader>()
	const [searchParams] = useSearchParams()
	const preselectedAppId = searchParams.get("appId") ?? ""
	const [selectedAppId, setSelectedAppId] = useState(preselectedAppId)
	const today = new Date().toISOString().split("T")[0]
	const defaultTitle = `${routine.name} — ${new Date().toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" })}`
	const instanceOptions =
		activityProviderType === "oracle" && selectedAppId ? (oracleInstancesByAppId[selectedAppId] ?? []) : []
	const hasOracleInstanceSelection =
		activityProviderType === "oracle" && routine.isSectionRoutine !== 1 && selectedAppId

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
									{activityProviderType === "oracle" ? "Velg applikasjon" : "Generell (ikke applikasjonsspesifikk)"}
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
									defaultValue={instanceOptions.length === 1 ? instanceOptions[0] : ""}
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
