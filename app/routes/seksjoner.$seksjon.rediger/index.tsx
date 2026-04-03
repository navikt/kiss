import { PencilIcon } from "@navikt/aksel-icons"
import { Button, Heading, HStack, Textarea, TextField, VStack } from "@navikt/ds-react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, redirect, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getSectionDetail, updateSection } from "~/db/queries/sections.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })

	const result = await getSectionDetail(seksjon)
	if (!result) throw new Response("Seksjon ikke funnet", { status: 404 })

	return data({
		section: {
			id: result.section.id,
			name: result.section.name,
			slug: result.section.slug,
			description: result.section.description,
		},
		seksjon,
	})
}

export async function action({ request, params }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })

	const result = await getSectionDetail(seksjon)
	if (!result) throw new Response("Seksjon ikke funnet", { status: 404 })

	const formData = await request.formData()
	const name = (formData.get("name") as string)?.trim()
	const description = (formData.get("description") as string)?.trim() || null

	if (!name) throw new Response("Navn er påkrevd", { status: 400 })

	const updated = await updateSection(result.section.id, name, description, authedUser.navIdent)

	return redirect(`/seksjoner/${updated.slug}`)
}

export default function RedigerSeksjon() {
	const { section, seksjon } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-8">
			<div>
				<Link to={`/seksjoner/${seksjon}`}>← Tilbake til seksjon</Link>
				<Heading size="xlarge" level="2" spacing>
					Rediger seksjon
				</Heading>
			</div>

			<Form method="post">
				<VStack gap="space-6" style={{ maxWidth: "40rem" }}>
					<TextField label="Navn" name="name" defaultValue={section.name} autoComplete="off" />
					<Textarea label="Beskrivelse" name="description" defaultValue={section.description ?? ""} minRows={3} />
					<HStack gap="space-4">
						<Button type="submit" variant="primary" icon={<PencilIcon aria-hidden />}>
							Lagre endringer
						</Button>
						<Button as={Link} to={`/seksjoner/${seksjon}`} variant="secondary">
							Avbryt
						</Button>
					</HStack>
				</VStack>
			</Form>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
