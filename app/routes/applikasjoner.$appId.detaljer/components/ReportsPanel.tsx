import { DownloadIcon, EyeIcon } from "@navikt/aksel-icons"
import {
	Alert,
	BodyShort,
	Box,
	Button,
	Checkbox,
	CheckboxGroup,
	Heading,
	HStack,
	Label,
	Table,
	VStack,
} from "@navikt/ds-react"
import { useState } from "react"
import { useActionData, useNavigation, useSubmit } from "react-router"
import type { action } from "../action.server"

export function ReportsPanel({
	appReports,
	completedReviews,
}: {
	appReports: Array<{
		id: string
		name: string
		createdAt: string
		createdBy: string
		reportBucketPath: string | null
	}>
	completedReviews: Array<{
		id: string
		title: string
		routineName: string
		reviewedAt: Date | string
		status: string
		createdBy: string
	}>
}) {
	const submit = useSubmit()
	const navigation = useNavigation()
	const actionData = useActionData<typeof action>()
	const isGenerating = navigation.state === "submitting"
	const [reportOptions, setReportOptions] = useState<string[]>([
		"includeReviews",
		"includeRoutineDescription",
		"includeAttachments",
	])
	const includeReviews = reportOptions.includes("includeReviews")

	const completed = completedReviews.filter((r) => r.status === "completed" || r.status === "needs_follow_up")
	const [selectedReviewIds, setSelectedReviewIds] = useState<string[]>(() => completed.map((r) => r.id))

	const toggleReview = (reviewId: string) => {
		setSelectedReviewIds((prev) =>
			prev.includes(reviewId) ? prev.filter((id) => id !== reviewId) : [...prev, reviewId],
		)
	}

	const allSelected = completed.length > 0 && selectedReviewIds.length === completed.length
	const toggleAll = () => {
		setSelectedReviewIds(allSelected ? [] : completed.map((r) => r.id))
	}

	return (
		<VStack gap="space-8">
			{/* Generate report section */}
			<Box background="sunken" padding="space-6" borderRadius="8">
				<Heading size="medium" level="3" spacing>
					Generer rapport
				</Heading>
				<VStack gap="space-4">
					<BodyShort>
						Generer en compliance-rapport for denne applikasjonen som PDF. Rapporten lagres og kan lastes ned eller
						vises senere.
					</BodyShort>
					<CheckboxGroup
						legend="Inkluder i rapporten"
						size="small"
						value={reportOptions}
						onChange={(val) => setReportOptions(val)}
					>
						<Checkbox value="includeReviews">Rutinegjennomganger</Checkbox>
						<Checkbox value="includeRoutineDescription">Rutinebeskrivelse (vises på gjennomgangssider)</Checkbox>
						<Checkbox value="includeAttachments">Vedlegg fra gjennomganger (legges i vedleggspakken)</Checkbox>
					</CheckboxGroup>

					{/* Review selection */}
					{includeReviews && completed.length > 0 && (
						<Box padding="space-4" borderWidth="1" borderColor="neutral" borderRadius="8">
							<VStack gap="space-2">
								<HStack justify="space-between" align="center">
									<Label size="small">
										Velg gjennomganger ({selectedReviewIds.length} av {completed.length})
									</Label>
									<Button variant="tertiary" size="xsmall" onClick={toggleAll}>
										{allSelected ? "Fjern alle" : "Velg alle"}
									</Button>
								</HStack>
								<Table size="small">
									<Table.Header>
										<Table.Row>
											<Table.HeaderCell style={{ width: "2rem" }} />
											<Table.HeaderCell>Tittel</Table.HeaderCell>
											<Table.HeaderCell>Rutine</Table.HeaderCell>
											<Table.HeaderCell>Dato</Table.HeaderCell>
											<Table.HeaderCell>Status</Table.HeaderCell>
											<Table.HeaderCell>Av</Table.HeaderCell>
										</Table.Row>
									</Table.Header>
									<Table.Body>
										{completed.map((review) => (
											<Table.Row key={review.id} onClick={() => toggleReview(review.id)} style={{ cursor: "pointer" }}>
												<Table.DataCell>
													<Checkbox
														size="small"
														hideLabel
														checked={selectedReviewIds.includes(review.id)}
														onChange={() => toggleReview(review.id)}
														onClick={(e) => e.stopPropagation()}
													>
														Velg
													</Checkbox>
												</Table.DataCell>
												<Table.DataCell>{review.title}</Table.DataCell>
												<Table.DataCell>{review.routineName}</Table.DataCell>
												<Table.DataCell>{new Date(review.reviewedAt).toLocaleDateString("nb-NO")}</Table.DataCell>
												<Table.DataCell>{review.status === "completed" ? "Fullført" : "Må følges opp"}</Table.DataCell>
												<Table.DataCell>{review.createdBy}</Table.DataCell>
											</Table.Row>
										))}
									</Table.Body>
								</Table>
							</VStack>
						</Box>
					)}

					{includeReviews && completed.length === 0 && (
						<BodyShort size="small" textColor="subtle">
							Ingen fullførte gjennomganger eller gjennomganger med åpne oppfølgingspunkter tilgjengelig.
						</BodyShort>
					)}

					{actionData?.success && (
						<Alert variant="success" size="small">
							{actionData.message}
						</Alert>
					)}
					{actionData && !actionData.success && actionData.error && (
						<Alert variant="error" size="small">
							{actionData.error}
						</Alert>
					)}
					<div>
						<Button
							type="button"
							variant="primary"
							size="small"
							loading={isGenerating}
							onClick={() => {
								const fd = new FormData()
								fd.set("intent", "generate-report")
								fd.set("includeReviews", String(includeReviews))
								fd.set("includeAttachments", String(reportOptions.includes("includeAttachments")))
								fd.set("includeRoutineDescription", String(reportOptions.includes("includeRoutineDescription")))
								if (includeReviews) {
									fd.set("reviewIds", selectedReviewIds.join(","))
								}
								submit(fd, { method: "post" })
							}}
						>
							Generer compliance-rapport
						</Button>
					</div>
				</VStack>
			</Box>

			{/* Generated reports list */}
			<Box>
				<Heading size="medium" level="3" spacing>
					Genererte rapporter
				</Heading>
				{appReports.length === 0 ? (
					<BodyShort>Ingen rapporter er generert ennå.</BodyShort>
				) : (
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell>Rapport</Table.HeaderCell>
								<Table.HeaderCell>Generert</Table.HeaderCell>
								<Table.HeaderCell>Av</Table.HeaderCell>
								<Table.HeaderCell>Vis</Table.HeaderCell>
								<Table.HeaderCell>Last ned</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{appReports.map((r) => {
								const isZip = r.reportBucketPath?.endsWith(".zip")
								return (
									<Table.Row key={r.id}>
										<Table.DataCell>{r.name}</Table.DataCell>
										<Table.DataCell>
											{new Date(r.createdAt).toLocaleString("nb-NO", {
												day: "numeric",
												month: "short",
												year: "numeric",
												hour: "2-digit",
												minute: "2-digit",
											})}
										</Table.DataCell>
										<Table.DataCell>{r.createdBy}</Table.DataCell>
										<Table.DataCell>
											{r.reportBucketPath && !isZip && (
												<Button
													as="a"
													href={`/api/rapporter/${r.id}/pdf`}
													target="_blank"
													rel="noopener noreferrer"
													variant="tertiary"
													size="xsmall"
													icon={<EyeIcon aria-hidden />}
												>
													Vis
												</Button>
											)}
										</Table.DataCell>
										<Table.DataCell>
											{r.reportBucketPath && (
												<Button
													as="a"
													href={`/api/rapporter/${r.id}/pdf?download=true`}
													variant="tertiary"
													size="xsmall"
													icon={<DownloadIcon aria-hidden />}
												>
													Last ned {isZip ? "(zip)" : ""}
												</Button>
											)}
										</Table.DataCell>
									</Table.Row>
								)
							})}
						</Table.Body>
					</Table>
				)}
			</Box>
		</VStack>
	)
}
