import { PencilIcon } from "@navikt/aksel-icons"
import { Accordion, BodyLong, Button, Heading, HStack, TextField, VStack } from "@navikt/ds-react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getDomainDetail, updateControlShortTitle, updateRiskShortTitle } from "~/db/queries/framework.server"

export async function loader({ params }: LoaderFunctionArgs) {
	const domainCode = params.domene?.toUpperCase()
	if (!domainCode) throw new Response("Mangler domene", { status: 400 })

	const domain = await getDomainDetail(domainCode)
	if (!domain) {
		throw new Response("Domene ikke funnet", { status: 404 })
	}

	return data({ domain })
}

export async function action({ request }: ActionFunctionArgs) {
	const formData = await request.formData()
	const type = formData.get("type") as string
	const id = formData.get("id") as string
	const shortTitle = formData.get("shortTitle") as string

	if (!type || !id) {
		return data({ error: "Manglende data" }, { status: 400 })
	}

	try {
		if (type === "risk") {
			await updateRiskShortTitle(id, shortTitle)
		} else if (type === "control") {
			await updateControlShortTitle(id, shortTitle)
		}
		return data({ success: true })
	} catch (err) {
		return data({ error: err instanceof Error ? err.message : "Ukjent feil" }, { status: 500 })
	}
}

function EditableTitle({ id, type, currentName }: { id: string; type: "risk" | "control"; currentName: string }) {
	const [editing, setEditing] = useState(false)
	const [value, setValue] = useState(currentName)

	if (!editing) {
		return (
			<HStack gap="space-2" align="center" wrap={false}>
				<span>{currentName}</span>
				<Button
					type="button"
					variant="tertiary-neutral"
					size="xsmall"
					icon={<PencilIcon aria-hidden />}
					onClick={(e) => {
						e.stopPropagation()
						setEditing(true)
					}}
					aria-label={`Rediger kort tittel for ${id}`}
				/>
			</HStack>
		)
	}

	return (
		<Form method="post" onSubmit={() => setEditing(false)} onClick={(e) => e.stopPropagation()}>
			<input type="hidden" name="type" value={type} />
			<input type="hidden" name="id" value={id} />
			<HStack gap="space-2" align="end" wrap={false}>
				<TextField
					label="Kort tittel"
					hideLabel
					size="small"
					name="shortTitle"
					value={value}
					onChange={(e) => setValue(e.target.value)}
					autoFocus
				/>
				<Button type="submit" variant="primary" size="small">
					Lagre
				</Button>
				<Button
					type="button"
					variant="tertiary"
					size="small"
					onClick={() => {
						setValue(currentName)
						setEditing(false)
					}}
				>
					Avbryt
				</Button>
			</HStack>
		</Form>
	)
}

export default function DomainDetail() {
	const { domain } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-6">
			<VStack gap="space-2">
				<Heading size="xlarge" level="2">
					{domain.name}
				</Heading>
				<BodyLong>
					Risikoer og kontroller for domenet {domain.name} ({domain.code}).
				</BodyLong>
			</VStack>

			<Accordion>
				{domain.risks.map((risk) => (
					<Accordion.Item key={risk.id}>
						<Accordion.Header>
							{risk.id}: {risk.name}
						</Accordion.Header>
						<Accordion.Content>
							<VStack gap="space-6">
								<EditableTitle id={risk.id} type="risk" currentName={risk.name} />
								<VStack gap="space-4">
									{risk.controls.map((control) => (
										<Link
											key={control.id}
											to={`/kontrollrammeverk/${domain.code}/${control.id}`}
											className="navds-link"
										>
											{control.id}: {control.name}
										</Link>
									))}
								</VStack>
							</VStack>
						</Accordion.Content>
					</Accordion.Item>
				))}
			</Accordion>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
