import { Button, Detail, Heading, HStack, Label, Select, TextField, VStack } from "@navikt/ds-react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, redirect, useLoaderData, useSearchParams } from "react-router"
import { MarkdownEditor } from "~/components/MarkdownEditor"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { createReview, getAppsRequiringRoutine, getRoutine } from "~/db/queries/routines.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"

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

	const apps = await getAppsRequiringRoutine(rutineId)

	return data({ section, routine, apps })
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
	const participantsRaw = (formData.get("participants") as string)?.trim() || ""

	if (!title) {
		throw data({ message: "Tittel er påkrevd" }, { status: 400 })
	}

	const participants = participantsRaw
		.split(",")
		.map((ident) => ident.trim())
		.filter(Boolean)
		.map((ident) => ({ userIdent: ident, userName: ident }))

	const review = await createReview({
		routineId: rutineId,
		applicationId,
		title,
		summary,
		routineSnapshotPath: null,
		reviewedAt: reviewedAt ? new Date(`${reviewedAt}T${reviewedTime}`) : new Date(),
		createdBy: authedUser.navIdent,
		participants,
	})

	return redirect(`/seksjoner/${seksjon}/rutiner/${rutineId}/gjennomgang/${review.id}`)
}

export default function NyGjennomgang() {
	const { routine, apps } = useLoaderData<typeof loader>()
	const [searchParams] = useSearchParams()
	const preselectedAppId = searchParams.get("appId") ?? ""
	const today = new Date().toISOString().split("T")[0]
	const defaultTitle = `${routine.name} — ${new Date().toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" })}`

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

					<Select
						label="Applikasjon"
						name="applicationId"
						size="small"
						defaultValue={preselectedAppId}
						disabled={!!preselectedAppId}
					>
						<option value="">Generell (ikke applikasjonsspesifikk)</option>
						{apps.map((app) => (
							<option key={app.id} value={app.id}>
								{app.name}
							</option>
						))}
					</Select>
					{preselectedAppId && <input type="hidden" name="applicationId" value={preselectedAppId} />}

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

					<TextField
						label="Deltakere"
						name="participants"
						size="small"
						description="Kommaseparert liste med NAV-identer"
						autoComplete="off"
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
