import { DownloadIcon } from "@navikt/aksel-icons"
import {
	Link as AkselLink,
	BodyLong,
	BodyShort,
	Box,
	Button,
	Chips,
	Detail,
	Heading,
	HStack,
	Label,
	Table,
	Tag,
	VStack,
} from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getReview, getRoutine } from "~/db/queries/routines.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { renderMarkdown } from "~/lib/markdown.server"
import { getFrequencyLabel } from "~/lib/routine-frequencies"

export async function loader({ params }: LoaderFunctionArgs) {
	const { seksjon, rutineId, gjennomgangId } = params
	if (!seksjon || !rutineId || !gjennomgangId) {
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

	const review = await getReview(gjennomgangId)
	if (!review) {
		throw data({ message: "Fant ikke gjennomgang" }, { status: 404 })
	}

	return data({
		section,
		routine,
		review: {
			...review,
			reviewedAt: review.reviewedAt.toISOString(),
			createdAt: review.createdAt.toISOString(),
			summaryHtml: renderMarkdown(review.summary),
			participants: review.participants.map((p) => ({
				...p,
				confirmedAt: p.confirmedAt?.toISOString() ?? null,
			})),
			attachments: review.attachments.map((a) => ({
				...a,
				uploadedAt: a.uploadedAt.toISOString(),
			})),
		},
	})
}

function formatDate(dateStr: string) {
	return new Date(dateStr).toLocaleDateString("nb-NO", {
		day: "numeric",
		month: "long",
		year: "numeric",
	})
}

function formatFileSize(bytes: number | null) {
	if (!bytes) return "—"
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function GjennomgangDetalj() {
	const { section, routine, review } = useLoaderData<typeof loader>()
	const confirmedCount = review.participants.filter((p) => p.confirmedAt).length

	return (
		<VStack gap="space-8" style={{ maxWidth: "64rem" }}>
			<div>
				<Detail>
					<Link to={`/seksjoner/${section.slug}/rutiner/${routine.id}`}>← Tilbake til {routine.name}</Link>
				</Detail>
				<Heading size="xlarge" level="2" spacing>
					{review.title}
				</Heading>
			</div>

			{/* Metadata */}
			<Box padding="space-8" borderWidth="1" borderColor="neutral-subtle" borderRadius="8">
				<HStack gap="space-12" wrap>
					<VStack gap="space-2">
						<Label size="small">Rutine</Label>
						<BodyShort>
							<AkselLink as={Link} to={`/seksjoner/${section.slug}/rutiner/${routine.id}`}>
								{routine.name}
							</AkselLink>
						</BodyShort>
					</VStack>
					<VStack gap="space-2">
						<Label size="small">Frekvens</Label>
						<BodyShort>{getFrequencyLabel(routine.frequency)}</BodyShort>
					</VStack>
					<VStack gap="space-2">
						<Label size="small">Gjennomgangsdato</Label>
						<BodyShort>{formatDate(review.reviewedAt)}</BodyShort>
					</VStack>
					<VStack gap="space-2">
						<Label size="small">Opprettet av</Label>
						<BodyShort>{review.createdBy}</BodyShort>
					</VStack>
					<VStack gap="space-2">
						<Label size="small">Opprettet</Label>
						<BodyShort>{formatDate(review.createdAt)}</BodyShort>
					</VStack>
					{review.applicationId && (
						<VStack gap="space-2">
							<Label size="small">Applikasjon</Label>
							<BodyShort>
								<AkselLink as={Link} to={`/applikasjoner/${review.applicationId}/detaljer`}>
									{review.applicationId}
								</AkselLink>
							</BodyShort>
						</VStack>
					)}
				</HStack>
			</Box>

			{/* Summary */}
			{review.summaryHtml && (
				<VStack gap="space-2">
					<Heading size="medium" level="3">
						Oppsummering / referat
					</Heading>
					<Box padding="space-8" borderWidth="1" borderColor="neutral-subtle" borderRadius="8">
						<div
							className="markdown-content"
							// biome-ignore lint/security/noDangerouslySetInnerHtml: server-sanitized
							dangerouslySetInnerHTML={{ __html: review.summaryHtml }}
						/>
					</Box>
				</VStack>
			)}

			{/* Participants */}
			{review.participants.length > 0 && (
				<VStack gap="space-4">
					<Heading size="medium" level="3">
						Deltakere ({confirmedCount}/{review.participants.length} bekreftet)
					</Heading>
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell>Ident</Table.HeaderCell>
								<Table.HeaderCell>Navn</Table.HeaderCell>
								<Table.HeaderCell>Status</Table.HeaderCell>
								<Table.HeaderCell>Bekreftet</Table.HeaderCell>
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
									<Table.DataCell>{p.confirmedAt ? formatDate(p.confirmedAt) : "—"}</Table.DataCell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				</VStack>
			)}

			{/* Attachments */}
			{review.attachments.length > 0 && (
				<VStack gap="space-4">
					<Heading size="medium" level="3">
						Vedlegg ({review.attachments.length})
					</Heading>
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell>Filnavn</Table.HeaderCell>
								<Table.HeaderCell>Type</Table.HeaderCell>
								<Table.HeaderCell>Størrelse</Table.HeaderCell>
								<Table.HeaderCell>Lastet opp av</Table.HeaderCell>
								<Table.HeaderCell>Dato</Table.HeaderCell>
								<Table.HeaderCell />
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{review.attachments.map((a) => (
								<Table.Row key={a.id}>
									<Table.DataCell>{a.fileName}</Table.DataCell>
									<Table.DataCell>{a.contentType}</Table.DataCell>
									<Table.DataCell>{formatFileSize(a.sizeBytes)}</Table.DataCell>
									<Table.DataCell>{a.uploadedBy}</Table.DataCell>
									<Table.DataCell>{formatDate(a.uploadedAt)}</Table.DataCell>
									<Table.DataCell>
										<Button
											as="a"
											href={`/api/rutine-vedlegg/${a.id}`}
											variant="tertiary"
											size="xsmall"
											icon={<DownloadIcon aria-hidden />}
										>
											Last ned
										</Button>
									</Table.DataCell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				</VStack>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
