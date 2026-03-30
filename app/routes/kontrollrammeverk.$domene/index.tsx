import { PencilIcon } from "@navikt/aksel-icons"
import {
	Accordion,
	Link as AkselLink,
	BodyLong,
	Button,
	Heading,
	HStack,
	Table,
	Tag,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getDomainDetail, updateControlShortTitle, updateRiskShortTitle } from "~/db/queries/framework.server"
import { getAuthenticatedUser } from "~/lib/auth.server"
import { compliancePercent } from "~/lib/utils"

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
	const user = await getAuthenticatedUser(request)
	const userName = user?.navIdent ?? "system"
	const formData = await request.formData()
	const type = formData.get("type") as string
	const id = formData.get("id") as string
	const shortTitle = formData.get("shortTitle") as string

	if (!type || !id) {
		return data({ error: "Manglende data" }, { status: 400 })
	}

	try {
		if (type === "risk") {
			await updateRiskShortTitle(id, shortTitle, userName)
		} else if (type === "control") {
			await updateControlShortTitle(id, shortTitle, userName)
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

function ControlComplianceTag({
	control,
}: {
	control: {
		totalApps: number
		implemented: number
		partial: number
		notImplemented: number
		notAssessed: number
		gaps: Array<{ appId: string; appName: string; status: string }>
	}
}) {
	if (control.totalApps === 0)
		return (
			<Tag variant="neutral" size="small">
				Ingen applikasjoner
			</Tag>
		)
	if (control.implemented === control.totalApps)
		return (
			<Tag variant="success" size="small">
				Alle OK
			</Tag>
		)
	if (control.notAssessed === control.totalApps)
		return (
			<Tag variant="neutral" size="small">
				Ikke vurdert
			</Tag>
		)
	if (control.notImplemented > 0)
		return (
			<Tag variant="error" size="small">
				{control.gaps.length} mangler
			</Tag>
		)
	if (control.partial > 0)
		return (
			<Tag variant="warning" size="small">
				{control.partial} delvis
			</Tag>
		)
	return (
		<Tag variant="info" size="small">
			{control.notAssessed} ikke vurdert
		</Tag>
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
				{domain.risks.map((risk) => {
					const riskGaps = risk.controls.reduce((sum, c) => sum + c.gaps.length, 0)
					return (
						<Accordion.Item key={risk.id}>
							<Accordion.Header>
								<HStack gap="space-4" align="center" wrap={false}>
									<span>
										{risk.id}: {risk.name}
									</span>
									{riskGaps > 0 ? (
										<Tag variant="error" size="small">
											{riskGaps} mangler
										</Tag>
									) : risk.controls.length > 0 ? (
										<Tag variant="success" size="small">
											OK
										</Tag>
									) : null}
								</HStack>
							</Accordion.Header>
							<Accordion.Content>
								<VStack gap="space-6">
									<EditableTitle id={risk.id} type="risk" currentName={risk.name} />
									<VStack gap="space-8">
										{risk.controls.map((control) => {
											const pct = compliancePercent(control.implemented, control.partial, control.totalApps)
											return (
												<VStack key={control.id} gap="space-4">
													<HStack gap="space-4" align="center" wrap={false}>
														<AkselLink as={Link} to={`/kontrollrammeverk/${domain.code}/${control.id}`}>
															{control.id}: {control.name}
														</AkselLink>
														<ControlComplianceTag control={control} />
													</HStack>
													{control.totalApps > 0 && (
														<div
															className="domain-status-bar"
															role="progressbar"
															aria-valuenow={pct}
															aria-valuemin={0}
															aria-valuemax={100}
															aria-label={`${control.id} compliance ${pct}%`}
														>
															<div
																className="domain-status-bar-implemented"
																style={{
																	width: `${(control.implemented / control.totalApps) * 100}%`,
																}}
															/>
															<div
																className="domain-status-bar-partial"
																style={{
																	width: `${(control.partial / control.totalApps) * 100}%`,
																}}
															/>
														</div>
													)}
													{control.gaps.length > 0 && (
														/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
														<section className="table-scroll" tabIndex={0} aria-label={`Mangler for ${control.id}`}>
															<Table size="small">
																<Table.Header>
																	<Table.Row>
																		<Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
																		<Table.HeaderCell scope="col">Status</Table.HeaderCell>
																	</Table.Row>
																</Table.Header>
																<Table.Body>
																	{control.gaps.map((gap) => (
																		<Table.Row key={gap.appId}>
																			<Table.DataCell>
																				<AkselLink as={Link} to={`/applikasjoner/${gap.appId}/compliance`}>
																					{gap.appName}
																				</AkselLink>
																			</Table.DataCell>
																			<Table.DataCell>
																				<Tag
																					variant={
																						gap.status === "Ikke implementert"
																							? "error"
																							: gap.status === "Delvis implementert"
																								? "warning"
																								: "neutral"
																					}
																					size="small"
																				>
																					{gap.status}
																				</Tag>
																			</Table.DataCell>
																		</Table.Row>
																	))}
																</Table.Body>
															</Table>
														</section>
													)}
												</VStack>
											)
										})}
									</VStack>
								</VStack>
							</Accordion.Content>
						</Accordion.Item>
					)
				})}
			</Accordion>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
