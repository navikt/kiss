import { ExternalLinkIcon, LinkIcon, TrashIcon } from "@navikt/aksel-icons"
import {
	Link as AkselLink,
	Alert,
	BodyShort,
	Box,
	Button,
	Heading,
	HStack,
	Table,
	TextField,
	VStack,
} from "@navikt/ds-react"
import { useState } from "react"
import { Form, useActionData, useNavigation } from "react-router"
import { MarkdownEditor } from "~/components/MarkdownEditor"

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"])

function isSafeUrl(url: string): boolean {
	try {
		return SAFE_PROTOCOLS.has(new URL(url).protocol)
	} catch {
		return false
	}
}

type ActionResult = {
	success: boolean
	message?: string
	error?: string
	intent?: string
}

type LinkItem = {
	id: string
	url: string
	title: string | null
	addedBy: string
	addedAt: string
}

type Props = {
	review: {
		id: string
		summary: string | null
		summaryHtml: string | null
		links: LinkItem[]
	}
	isDraft: boolean
}

function formatDate(dateStr: string) {
	return new Date(dateStr).toLocaleDateString("nb-NO", {
		day: "numeric",
		month: "long",
		year: "numeric",
	})
}

export function StepSummary({ review, isDraft }: Props) {
	return (
		<VStack gap="space-6">
			<div>
				<Heading size="medium" level="3" spacing>
					Sammendrag, notater og lenker
				</Heading>
				<BodyShort size="small" textColor="subtle">
					Skriv ned observasjoner og funn fra gjennomgangen, og legg til relevante lenker.
				</BodyShort>
			</div>

			{isDraft ? (
				<Form method="post" data-wizard-form>
					<input type="hidden" name="intent" value="update-review" />
					<VStack gap="space-6">
						<MarkdownEditor label="Oppsummering / referat" name="summary" defaultValue={review.summary ?? ""} />

						<HStack>
							<Button type="submit" variant="primary" size="small">
								Lagre sammendrag
							</Button>
						</HStack>
					</VStack>
				</Form>
			) : review.summaryHtml ? (
				<Box padding="space-8" borderWidth="1" borderColor="neutral-subtle" borderRadius="8">
					<div
						className="markdown-content"
						// biome-ignore lint/security/noDangerouslySetInnerHtml: server-sanitized
						dangerouslySetInnerHTML={{ __html: review.summaryHtml }}
					/>
				</Box>
			) : (
				<Box padding="space-6" borderRadius="8" background="sunken">
					<BodyShort>Ingen oppsummering er skrevet.</BodyShort>
				</Box>
			)}

			{/* Links section */}
			<VStack gap="space-4">
				<Heading size="small" level="4">
					Lenker
				</Heading>
				{review.links.length > 0 ? (
					/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
					<section className="table-scroll" tabIndex={0} aria-label="Lenker">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Tittel</Table.HeaderCell>
									<Table.HeaderCell scope="col">URL</Table.HeaderCell>
									<Table.HeaderCell scope="col">Lagt til av</Table.HeaderCell>
									<Table.HeaderCell scope="col">Dato</Table.HeaderCell>
									{isDraft && <Table.HeaderCell scope="col" />}
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{review.links.map((l) => (
									<Table.Row key={l.id}>
										<Table.DataCell>{l.title || "—"}</Table.DataCell>
										<Table.DataCell>
											{isSafeUrl(l.url) ? (
												<AkselLink href={l.url} target="_blank" rel="noopener noreferrer">
													{l.url.length > 60 ? `${l.url.slice(0, 60)}…` : l.url}
													<ExternalLinkIcon aria-hidden style={{ marginLeft: "0.25rem" }} />
												</AkselLink>
											) : (
												<BodyShort size="small" textColor="subtle">
													{l.url.length > 60 ? `${l.url.slice(0, 60)}…` : l.url}
												</BodyShort>
											)}
										</Table.DataCell>
										<Table.DataCell>{l.addedBy}</Table.DataCell>
										<Table.DataCell>{formatDate(l.addedAt)}</Table.DataCell>
										{isDraft && (
											<Table.DataCell>
												<Form method="post">
													<input type="hidden" name="intent" value="delete-link" />
													<input type="hidden" name="linkId" value={l.id} />
													<Button
														type="submit"
														variant="tertiary-neutral"
														size="xsmall"
														icon={<TrashIcon aria-hidden />}
													>
														Fjern
													</Button>
												</Form>
											</Table.DataCell>
										)}
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				) : (
					<Box padding="space-6" borderRadius="8" background="sunken">
						<BodyShort>Ingen lenker er lagt til.</BodyShort>
					</Box>
				)}
			</VStack>

			{isDraft && <AddLinkSection />}
		</VStack>
	)
}

function AddLinkSection() {
	const actionData = useActionData<ActionResult>()
	const navigation = useNavigation()
	const isSubmitting = navigation.state === "submitting"
	const [url, setUrl] = useState("")
	const [title, setTitle] = useState("")

	return (
		<Box padding="space-6" borderWidth="1" borderColor="neutral-subtle" borderRadius="8">
			<Heading size="small" level="4" spacing>
				Legg til lenke
			</Heading>
			<Form
				method="post"
				onSubmit={() => {
					setTimeout(() => {
						setUrl("")
						setTitle("")
					}, 100)
				}}
			>
				<input type="hidden" name="intent" value="add-link" />
				<VStack gap="space-4">
					<HStack gap="space-4" align="end" style={{ flexWrap: "wrap" }}>
						<TextField
							label="Tittel (valgfritt)"
							name="linkTitle"
							size="small"
							autoComplete="off"
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							style={{ minWidth: "15rem", flex: 1 }}
						/>
						<TextField
							label="URL"
							name="url"
							size="small"
							type="url"
							autoComplete="off"
							value={url}
							onChange={(e) => setUrl(e.target.value)}
							placeholder="https://..."
							style={{ minWidth: "20rem", flex: 2 }}
						/>
						<Button
							type="submit"
							variant="secondary"
							size="small"
							loading={isSubmitting}
							icon={<LinkIcon aria-hidden />}
						>
							Legg til
						</Button>
					</HStack>
					{actionData?.intent === "add-link" && actionData.error && (
						<Alert variant="error" size="small">
							{actionData.error}
						</Alert>
					)}
				</VStack>
			</Form>
		</Box>
	)
}
