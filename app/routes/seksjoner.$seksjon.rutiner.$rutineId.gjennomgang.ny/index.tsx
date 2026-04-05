import { Button, Heading, HStack, Label, Select, Textarea, TextField, VStack } from "@navikt/ds-react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, redirect, useLoaderData } from "react-router"
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

	return data({
		section,
		routine,
		apps,
	})
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

	await createReview({
		routineId: rutineId,
		applicationId,
		title,
		summary,
		routineSnapshotPath: null,
		reviewedAt: reviewedAt ? new Date(reviewedAt) : new Date(),
		createdBy: authedUser.navIdent,
		participants,
	})

	return redirect(`/seksjoner/${seksjon}/rutiner/${rutineId}`)
}

export default function NyGjennomgang() {
	const { routine, apps } = useLoaderData<typeof loader>()
	const today = new Date().toISOString().split("T")[0]

	return (
		<VStack gap="space-8">
			<div>
				<Link to="../..">← Tilbake til {routine.name}</Link>
				<Heading size="xlarge" level="2" spacing>
					Ny gjennomgang — {routine.name}
				</Heading>
			</div>

			<Form method="post">
				<VStack gap="space-6">
					<TextField label="Tittel" name="title" size="small" autoComplete="off" />

					<Select label="Applikasjon" name="applicationId" size="small">
						<option value="">Generell (ikke applikasjonsspesifikk)</option>
						{apps.map((app) => (
							<option key={app.id} value={app.id}>
								{app.name}
							</option>
						))}
					</Select>

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

					<Textarea
						label="Oppsummering/referat"
						name="summary"
						size="small"
						description="Støtter Markdown"
						minRows={6}
					/>

					<TextField
						label="Deltakere"
						name="participants"
						size="small"
						description="Kommaseparert liste med NAV-identer"
						autoComplete="off"
					/>

					<HStack gap="space-4">
						<Button type="submit" variant="primary" size="small">
							Opprett gjennomgang
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
