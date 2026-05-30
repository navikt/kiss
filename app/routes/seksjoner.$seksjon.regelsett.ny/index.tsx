import { Alert, Button, Heading, HStack, Radio, RadioGroup, Select, TextField, VStack } from "@navikt/ds-react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, redirect, useActionData, useLoaderData } from "react-router"
import { MarkdownEditor } from "~/components/MarkdownEditor"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { createRuleset } from "~/db/queries/rulesets.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { type UserRole, userRoleLabels } from "~/db/schema/organization"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { requireAnySectionRole } from "~/lib/authorization.server"
import {
	frequencyLabels,
	isRoutineFrequency,
	ROUTINE_FREQUENCIES,
	type RoutineFrequency,
} from "~/lib/routine-frequencies"

const assignableRoles: UserRole[] = [
	"section_manager",
	"tech_manager",
	"delivery_manager",
	"product_owner",
	"tech_lead",
	"system_owner",
]

export async function loader({ request, params }: LoaderFunctionArgs) {
	const { seksjon } = params
	if (!seksjon) throw data({ message: "Mangler seksjonsparameter" }, { status: 400 })

	const authedUser = await requireAuthenticatedUser(request)

	const section = await getSectionBySlug(seksjon)
	if (!section) throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })
	requireAnySectionRole(authedUser, section.id)

	return data({
		section,
		frequencies: ROUTINE_FREQUENCIES.map((f) => ({ value: f, label: frequencyLabels[f] })),
	})
}

type ActionResult = { success: false; error: string }

export async function action({ request, params }: ActionFunctionArgs) {
	const { seksjon } = params
	if (!seksjon) throw data({ message: "Mangler seksjonsparameter" }, { status: 400 })

	const authedUser = await requireAuthenticatedUser(request)

	const section = await getSectionBySlug(seksjon)
	if (!section) throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })
	requireAnySectionRole(authedUser, section.id)

	const formData = await request.formData()
	const name = formData.get("name")
	const description = formData.get("description")
	const responsibleType = formData.get("responsibleType")
	const responsibleIdent = formData.get("responsibleIdent")
	const responsibleName = formData.get("responsibleName")
	const responsibleRole = formData.get("responsibleRole")
	const frequency = formData.get("frequency")

	if (typeof name !== "string" || !name.trim()) {
		return data<ActionResult>({ success: false, error: "Navn er påkrevd." })
	}
	if (!isRoutineFrequency(frequency)) {
		return data<ActionResult>({ success: false, error: "Ugyldig frekvens." })
	}

	const isRoleBased = responsibleType === "role"

	const id = await createRuleset({
		sectionId: section.id,
		name: name.trim(),
		description: typeof description === "string" && description.trim() ? description.trim() : undefined,
		responsibleIdent:
			!isRoleBased && typeof responsibleIdent === "string" && responsibleIdent.trim()
				? responsibleIdent.trim().toUpperCase()
				: undefined,
		responsibleName:
			!isRoleBased && typeof responsibleName === "string" && responsibleName.trim()
				? responsibleName.trim()
				: undefined,
		responsibleRole:
			isRoleBased && typeof responsibleRole === "string" && responsibleRole.trim() ? responsibleRole.trim() : undefined,
		frequency: frequency as RoutineFrequency,
		createdBy: authedUser.navIdent,
	})

	return redirect(`/seksjoner/${seksjon}/regelsett/${id}`)
}

export default function NyttRegelsett() {
	const { section, frequencies } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const [responsibleType, setResponsibleType] = useState<"person" | "role">("person")

	return (
		<VStack gap="space-6">
			<Heading size="large">Opprett regelsett — {section.name}</Heading>

			{actionData && "success" in actionData && !actionData.success && (
				<Alert variant="error">{actionData.error}</Alert>
			)}

			<Form method="post">
				<VStack gap="space-4">
					<TextField label="Navn" name="name" />
					<MarkdownEditor label="Beskrivelse" name="description" />

					<RadioGroup
						legend="Ansvarlig"
						value={responsibleType}
						onChange={(val) => setResponsibleType(val as "person" | "role")}
						name="responsibleType"
					>
						<Radio value="person">Navngitt person</Radio>
						<Radio value="role">Rolle i seksjonen</Radio>
					</RadioGroup>

					{responsibleType === "person" ? (
						<HStack gap="space-4" wrap>
							<TextField label="NAV-ident" name="responsibleIdent" htmlSize={12} />
							<TextField label="Navn" name="responsibleName" htmlSize={30} />
						</HStack>
					) : (
						<Select label="Velg rolle" name="responsibleRole">
							<option value="">Velg rolle</option>
							{assignableRoles.map((role) => (
								<option key={role} value={role}>
									{userRoleLabels[role]}
								</option>
							))}
						</Select>
					)}

					<Select label="Frekvens" name="frequency">
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
