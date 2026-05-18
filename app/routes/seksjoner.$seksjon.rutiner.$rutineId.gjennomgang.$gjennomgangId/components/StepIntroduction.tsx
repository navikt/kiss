import {
	Link as AkselLink,
	Alert,
	BodyShort,
	Button,
	Heading,
	HStack,
	Label,
	Table,
	Tag,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { Form, Link, useActionData, useNavigation } from "react-router"
import { ParticipantsCombobox } from "~/components/ParticipantsCombobox"

type ActionResult = {
	success: boolean
	message?: string
	error?: string
	intent?: string
}

type Props = {
	review: {
		id: string
		title: string
		reviewedAt: string
		createdAt: string
		summary: string | null
		createdBy: string
		applicationId: string | null
		applicationName: string | null
		participants: Array<{ id: string; userIdent: string; userName: string | null; confirmedAt: string | null }>
	}
	isDraft: boolean
}

export function StepIntroduction({ review, isDraft }: Props) {
	const actionData = useActionData<ActionResult>()
	const navigation = useNavigation()
	const isSubmitting = navigation.state === "submitting"

	const reviewDate = new Date(review.reviewedAt)
	const defaultDate = reviewDate.toISOString().split("T")[0]
	const defaultTime = reviewDate.toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" })

	if (!isDraft) {
		const confirmedCount = review.participants.filter((p) => p.confirmedAt).length
		return (
			<VStack gap="space-6">
				<Heading size="medium" level="3">
					Innledning
				</Heading>
				<VStack gap="space-4">
					<div>
						<Label size="small">Tittel</Label>
						<BodyShort>{review.title}</BodyShort>
					</div>
					<div>
						<Label size="small">Gjennomgangsdato</Label>
						<BodyShort>
							{reviewDate.toLocaleDateString("nb-NO", {
								day: "numeric",
								month: "long",
								year: "numeric",
								hour: "2-digit",
								minute: "2-digit",
							})}
						</BodyShort>
					</div>
					{review.applicationId && (
						<div>
							<Label size="small">Applikasjon</Label>
							<BodyShort>
								<AkselLink as={Link} to={`/applikasjoner/${review.applicationId}/detaljer`}>
									{review.applicationName ?? review.applicationId}
								</AkselLink>
							</BodyShort>
						</div>
					)}
					<div>
						<Label size="small">Opprettet av</Label>
						<BodyShort>{review.createdBy}</BodyShort>
					</div>
					<div>
						<Label size="small">Opprettet</Label>
						<BodyShort>
							{new Date(review.createdAt).toLocaleDateString("nb-NO", {
								day: "numeric",
								month: "long",
								year: "numeric",
								hour: "2-digit",
								minute: "2-digit",
							})}
						</BodyShort>
					</div>
					{review.participants.length > 0 && (
						<VStack gap="space-2">
							<Label size="small">
								Deltakere ({confirmedCount}/{review.participants.length} bekreftet)
							</Label>
							{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access */}
							<section className="table-scroll" tabIndex={0} aria-label="Deltakere">
								<Table size="small">
									<Table.Header>
										<Table.Row>
											<Table.HeaderCell scope="col">Ident</Table.HeaderCell>
											<Table.HeaderCell scope="col">Navn</Table.HeaderCell>
											<Table.HeaderCell scope="col">Status</Table.HeaderCell>
											<Table.HeaderCell scope="col">Bekreftet</Table.HeaderCell>
										</Table.Row>
									</Table.Header>
									<Table.Body>
										{review.participants.map((p) => (
											<Table.Row key={p.id}>
												<Table.DataCell>{p.userIdent}</Table.DataCell>
												<Table.DataCell>{p.userName ?? "—"}</Table.DataCell>
												<Table.DataCell>
													{p.confirmedAt ? (
														<Tag variant="success" size="xsmall">
															Bekreftet
														</Tag>
													) : (
														<Tag variant="warning" size="xsmall">
															Venter
														</Tag>
													)}
												</Table.DataCell>
												<Table.DataCell>
													{p.confirmedAt
														? new Date(p.confirmedAt).toLocaleDateString("nb-NO", {
																day: "numeric",
																month: "short",
																year: "numeric",
															})
														: "—"}
												</Table.DataCell>
											</Table.Row>
										))}
									</Table.Body>
								</Table>
							</section>
						</VStack>
					)}
				</VStack>
			</VStack>
		)
	}

	return (
		<VStack gap="space-6">
			<div>
				<Heading size="medium" level="3" spacing>
					Innledning
				</Heading>
				<BodyShort size="small" textColor="subtle">
					Registrer grunnleggende informasjon om gjennomgangen.
				</BodyShort>
			</div>

			<Form method="post" data-wizard-form>
				<input type="hidden" name="intent" value="update-review" />
				<VStack gap="space-6">
					<TextField label="Tittel" name="title" size="small" autoComplete="off" defaultValue={review.title} />

					{review.applicationId && (
						<div>
							<Label size="small">Applikasjon</Label>
							<BodyShort>
								<AkselLink as={Link} to={`/applikasjoner/${review.applicationId}/detaljer`}>
									{review.applicationName ?? review.applicationId}
								</AkselLink>
							</BodyShort>
						</div>
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
								defaultValue={defaultDate}
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
								defaultValue={defaultTime}
								className="navds-text-field__input navds-body-short navds-body-short--small"
							/>
						</div>
					</HStack>

					<ParticipantsCombobox
						key={review.id}
						name="participants"
						label="Deltakere"
						description="Søk på navn eller e-post for å legge til personer. Du kan også skrive inn en NAV-ident direkte."
						defaultParticipants={review.participants.map((p) => ({
							navIdent: p.userIdent,
							displayName: p.userName,
						}))}
					/>

					{actionData?.intent === "update-review" && actionData.error && (
						<Alert variant="error" size="small">
							{actionData.error}
						</Alert>
					)}

					<HStack>
						<Button type="submit" variant="primary" size="small" loading={isSubmitting}>
							Lagre endringer
						</Button>
					</HStack>
				</VStack>
			</Form>
		</VStack>
	)
}
