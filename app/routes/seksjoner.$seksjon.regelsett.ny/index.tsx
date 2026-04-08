import { Button, Heading, HStack, Select, Textarea, TextField, VStack } from "@navikt/ds-react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, redirect, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { createRuleset } from "~/db/queries/rulesets.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"
import {
	frequencyLabels,
	isRoutineFrequency,
	ROUTINE_FREQUENCIES,
	type RoutineFrequency,
} from "~/lib/routine-frequencies"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const { seksjon } = params
	if (!seksjon) throw data({ message: "Mangler seksjonsparameter" }, { status: 400 })

	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const section = await getSectionBySlug(seksjon)
	if (!section) throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })

	return data({
		section,
		frequencies: ROUTINE_FREQUENCIES.map((f) => ({ value: f, label: frequencyLabels[f] })),
	})
}

type ActionResult = { success: false; error: string }

export async function action({ request, params }: ActionFunctionArgs) {
	const { seksjon } = params
	if (!seksjon) throw data({ message: "Mangler seksjonsparameter" }, { status: 400 })

	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const section = await getSectionBySlug(seksjon)
	if (!section) throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })

	const formData = await request.formData()
	const code = formData.get("code")
	const name = formData.get("name")
	const description = formData.get("description")
	const responsibleIdent = formData.get("responsibleIdent")
	const responsibleName = formData.get("responsibleName")
	const frequency = formData.get("frequency")

	if (typeof code !== "string" || !code.trim()) {
		return data<ActionResult>({ success: false, error: "Kode er påkrevd." })
	}
	if (typeof name !== "string" || !name.trim()) {
		return data<ActionResult>({ success: false, error: "Navn er påkrevd." })
	}
	if (!isRoutineFrequency(frequency)) {
		return data<ActionResult>({ success: false, error: "Ugyldig frekvens." })
	}

	const id = await createRuleset({
		sectionId: section.id,
		code: code.trim(),
		name: name.trim(),
		description: typeof description === "string" && description.trim() ? description.trim() : undefined,
		responsibleIdent:
			typeof responsibleIdent === "string" && responsibleIdent.trim()
				? responsibleIdent.trim().toUpperCase()
				: undefined,
		responsibleName: typeof responsibleName === "string" && responsibleName.trim() ? responsibleName.trim() : undefined,
		frequency: frequency as RoutineFrequency,
		createdBy: authedUser.navIdent,
	})

	return redirect(`/seksjoner/${seksjon}/regelsett/${id}`)
}

export default function NyttRegelsett() {
	const { section, frequencies } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-6">
			<Heading size="large">Opprett regelsett — {section.name}</Heading>

			<Form method="post">
				<VStack gap="space-4">
					<TextField label="Kode" name="code" required placeholder="f.eks. RS-PEN.01" />
					<TextField label="Navn" name="name" required />
					<Textarea label="Beskrivelse" name="description" />
					<HStack gap="space-4" wrap>
						<TextField label="Ansvarlig (NAV-ident)" name="responsibleIdent" htmlSize={12} />
						<TextField label="Ansvarlig (navn)" name="responsibleName" htmlSize={30} />
					</HStack>
					<Select label="Frekvens" name="frequency" required>
						<option value="">Velg frekvens</option>
						{frequencies.map((f) => (
							<option key={f.value} value={f.value}>
								{f.label}
							</option>
						))}
					</Select>
					<div>
						<Button type="submit" variant="primary">
							Opprett
						</Button>
					</div>
				</VStack>
			</Form>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
