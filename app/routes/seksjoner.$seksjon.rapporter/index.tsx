import { DownloadIcon } from "@navikt/aksel-icons"
import {
	Alert,
	BodyShort,
	Box,
	Button,
	Checkbox,
	CheckboxGroup,
	Heading,
	HStack,
	Loader,
	Switch,
	Table,
	Tag,
	VStack,
} from "@navikt/ds-react"
import { and, inArray, isNull } from "drizzle-orm"
import { useEffect, useState } from "react"
import { data, useActionData, useLoaderData, useNavigation, useRevalidator, useSubmit } from "react-router"
import { db } from "~/db/connection.server"
import { getEconomyClassifications } from "~/db/queries/economy-classification.server"
import { getReportsForSection } from "~/db/queries/reports.server"
import { getEffectiveAppIdsInSection, getSectionDetail } from "~/db/queries/sections.server"
import { type EconomySystemType, economySystemTypeLabels, monitoredApplications } from "~/db/schema/applications"
import { getAuthenticatedUser } from "~/lib/auth.server"
import { canManageSection, requireSectionReportAccess } from "~/lib/authorization.server"
import { startSectionBatchReport } from "~/lib/section-report-jobs.server"
import type { Route } from "./+types/index"

export async function loader({ params, request }: Route.LoaderArgs) {
	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })

	const user = await getAuthenticatedUser(request)
	if (!user) throw new Response("Ikke autentisert", { status: 401 })

	const section = await getSectionDetail(seksjon)
	if (!section) throw new Response("Seksjon ikke funnet", { status: 404 })

	requireSectionReportAccess(user, section.section.id)

	const effectiveAppIds = await getEffectiveAppIdsInSection(section.section.id)

	const [appRows, economyMap, existingReports] = await Promise.all([
		effectiveAppIds.length > 0
			? db
					.select({ id: monitoredApplications.id, name: monitoredApplications.name })
					.from(monitoredApplications)
					.where(and(inArray(monitoredApplications.id, effectiveAppIds), isNull(monitoredApplications.archivedAt)))
					.orderBy(monitoredApplications.name)
			: Promise.resolve([]),
		getEconomyClassifications(effectiveAppIds),
		getReportsForSection(section.section.id),
	])

	const apps = appRows.map((a) => ({
		id: a.id,
		name: a.name,
		isEconomySystem: economyMap.get(a.id)?.isEconomySystem ?? null,
		economySystemType: (economyMap.get(a.id)?.economySystemType ?? null) as EconomySystemType | null,
	}))

	return data({
		seksjon,
		seksjonId: section.section.id,
		seksjonName: section.section.name,
		apps,
		existingReports: existingReports.map((r) => ({
			id: r.id,
			name: r.name,
			status: r.status,
			progressMessage: r.progressMessage,
			reportBucketPath: r.reportBucketPath,
			createdAt: r.createdAt.toISOString(),
			createdBy: r.createdBy,
		})),
		canManage: canManageSection(user, section.section.id),
	})
}

export async function action({ params, request }: Route.ActionArgs) {
	const seksjon = params.seksjon
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })

	const user = await getAuthenticatedUser(request)
	if (!user) throw new Response("Ikke autentisert", { status: 401 })

	const section = await getSectionDetail(seksjon)
	if (!section) throw new Response("Seksjon ikke funnet", { status: 404 })

	requireSectionReportAccess(user, section.section.id)

	const formData = await request.formData()
	const rawIds = formData.get("appIds")
	// Deduplicate and trim to prevent crafted requests from inflating work
	const selectedAppIds = [
		...new Set(
			typeof rawIds === "string"
				? rawIds
						.split(",")
						.map((s) => s.trim())
						.filter(Boolean)
				: [],
		),
	]

	// Server-side scope validation — filter out any IDs outside the section
	const allowedIds = await getEffectiveAppIdsInSection(section.section.id)
	const allowedSet = new Set(allowedIds)
	const validatedIds = selectedAppIds.filter((id) => allowedSet.has(id))

	if (validatedIds.length === 0) {
		return data({ success: false, error: "Velg minst én applikasjon." })
	}

	const includeAttachments = formData.get("includeAttachments") === "true"
	const includeRoutineDescription = formData.get("includeRoutineDescription") === "true"
	// Vedlegg og rutinebeskrivelse avhenger av gjennomgangsdata — tving includeReviews om nødvendig
	const includeReviews = formData.get("includeReviews") === "true" || includeAttachments || includeRoutineDescription

	const { reportId } = await startSectionBatchReport({
		sectionId: section.section.id,
		sectionName: section.section.name,
		sectionSlug: seksjon,
		selectedAppIds: validatedIds,
		includeReviews,
		includeAttachments,
		includeRoutineDescription,
		createdBy: user.navIdent,
	})

	return data({ success: true, reportId, error: null })
}

export default function SeksjonRapporter() {
	const { seksjonName, apps, existingReports } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const navigation = useNavigation()
	const submit = useSubmit()
	const { revalidate } = useRevalidator()

	const [onlyEconomy, setOnlyEconomy] = useState(false)
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
	const [reportOptions, setReportOptions] = useState<string[]>(["includeReviews", "includeAttachments"])

	const isSubmitting = navigation.state === "submitting"

	// Poll every 3 seconds while any report is pending/running
	const hasActiveReport = existingReports.some((r) => r.status === "pending" || r.status === "running")
	useEffect(() => {
		if (!hasActiveReport) return
		const id = setInterval(() => revalidate(), 3000)
		return () => clearInterval(id)
	}, [hasActiveReport, revalidate])

	const visibleApps = onlyEconomy ? apps.filter((a) => a.isEconomySystem === true) : apps

	const allVisible = visibleApps.length > 0 && visibleApps.every((a) => selectedIds.has(a.id))
	const toggleAll = () => {
		if (allVisible) {
			setSelectedIds((prev) => {
				const next = new Set(prev)
				for (const a of visibleApps) next.delete(a.id)
				return next
			})
		} else {
			setSelectedIds((prev) => {
				const next = new Set(prev)
				for (const a of visibleApps) next.add(a.id)
				return next
			})
		}
	}

	const toggleApp = (id: string) => {
		setSelectedIds((prev) => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}

	const handleGenerate = () => {
		const fd = new FormData()
		fd.set("appIds", [...selectedIds].join(","))
		fd.set("includeReviews", String(reportOptions.includes("includeReviews")))
		fd.set("includeAttachments", String(reportOptions.includes("includeAttachments")))
		fd.set("includeRoutineDescription", String(reportOptions.includes("includeRoutineDescription")))
		submit(fd, { method: "post" })
	}

	const economyLabel = (type: EconomySystemType | null) => (type ? economySystemTypeLabels[type] : "Ukjent type")

	return (
		<VStack gap="space-8">
			<Heading size="large" level="1">
				Rapporter – {seksjonName}
			</Heading>

			{/* App selection */}
			<Box background="sunken" padding="space-6" borderRadius="8">
				<VStack gap="space-6">
					<HStack justify="space-between" align="center">
						<Heading size="medium" level="2">
							Velg applikasjoner ({selectedIds.size} valgt)
						</Heading>
						<Switch
							size="small"
							checked={onlyEconomy}
							onChange={(e) => {
								setOnlyEconomy(e.target.checked)
							}}
						>
							Vis kun økonomisystemer
						</Switch>
					</HStack>

					{visibleApps.length === 0 ? (
						<BodyShort>
							{onlyEconomy
								? "Ingen applikasjoner er klassifisert som økonomisystem."
								: "Ingen applikasjoner i seksjonen."}
						</BodyShort>
					) : (
						// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table needs keyboard access
						<section className="table-scroll" tabIndex={0} aria-label="Applikasjoner for rapportvalg">
							<Table size="small">
								<Table.Header>
									<Table.Row>
										<Table.HeaderCell style={{ width: "2rem" }}>
											<Checkbox
												size="small"
												hideLabel
												checked={allVisible}
												indeterminate={!allVisible && visibleApps.some((a) => selectedIds.has(a.id))}
												onChange={toggleAll}
											>
												Velg alle
											</Checkbox>
										</Table.HeaderCell>
										<Table.HeaderCell>Applikasjon</Table.HeaderCell>
										<Table.HeaderCell>Økonomisystem</Table.HeaderCell>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{visibleApps.map((app) => (
										<Table.Row key={app.id}>
											<Table.DataCell>
												<Checkbox
													size="small"
													hideLabel
													checked={selectedIds.has(app.id)}
													onChange={() => toggleApp(app.id)}
												>
													Velg
												</Checkbox>
											</Table.DataCell>
											<Table.DataCell>{app.name}</Table.DataCell>
											<Table.DataCell>
												{app.isEconomySystem === true ? (
													<Tag variant="info" size="small">
														{economyLabel(app.economySystemType)}
													</Tag>
												) : app.isEconomySystem === false ? (
													<BodyShort size="small">Nei</BodyShort>
												) : (
													<BodyShort size="small" textColor="subtle">
														–
													</BodyShort>
												)}
											</Table.DataCell>
										</Table.Row>
									))}
								</Table.Body>
							</Table>
						</section>
					)}
				</VStack>
			</Box>

			{/* Report options */}
			<Box background="sunken" padding="space-6" borderRadius="8">
				<VStack gap="space-4">
					<Heading size="medium" level="2">
						Rapportinnhold
					</Heading>
					<CheckboxGroup
						legend="Inkluder i rapporten"
						size="small"
						value={reportOptions}
						onChange={(val) => setReportOptions(val)}
					>
						<Checkbox value="includeReviews">Rutinegjennomganger</Checkbox>
						<Checkbox value="includeRoutineDescription">Rutinebeskrivelse</Checkbox>
						<Checkbox value="includeAttachments">Vedlegg fra gjennomganger</Checkbox>
					</CheckboxGroup>

					{actionData && !actionData.success && actionData.error && (
						<Alert variant="error" size="small">
							{actionData.error}
						</Alert>
					)}
					{actionData?.success && (
						<Alert variant="success" size="small">
							Rapportgenerering startet. Siden oppdateres automatisk når rapporten er klar.
						</Alert>
					)}

					<div>
						<Button
							type="button"
							variant="primary"
							size="small"
							loading={isSubmitting}
							disabled={selectedIds.size === 0}
							onClick={handleGenerate}
						>
							Generer rapport for {selectedIds.size} applikasjon{selectedIds.size !== 1 ? "er" : ""}
						</Button>
					</div>
				</VStack>
			</Box>

			{/* Generated reports */}
			<Box>
				<Heading size="medium" level="2" spacing>
					Genererte rapporter
				</Heading>
				{existingReports.length === 0 ? (
					<BodyShort>Ingen rapporter er generert ennå.</BodyShort>
				) : (
					// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table needs keyboard access
					<section className="table-scroll" tabIndex={0} aria-label="Genererte rapporter">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell>Rapport</Table.HeaderCell>
									<Table.HeaderCell>Status</Table.HeaderCell>
									<Table.HeaderCell>Generert</Table.HeaderCell>
									<Table.HeaderCell>Av</Table.HeaderCell>
									<Table.HeaderCell>Last ned</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{existingReports.map((r) => (
									<Table.Row key={r.id}>
										<Table.DataCell>{r.name}</Table.DataCell>
										<Table.DataCell>
											<ReportStatusCell status={r.status} message={r.progressMessage} />
										</Table.DataCell>
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
											{r.status === "completed" && r.reportBucketPath ? (
												<Button
													as="a"
													href={`/api/rapporter/${r.id}/pdf?download=true`}
													variant="tertiary"
													size="xsmall"
													icon={<DownloadIcon aria-hidden />}
												>
													Last ned (zip)
												</Button>
											) : null}
										</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				)}
			</Box>
		</VStack>
	)
}

function ReportStatusCell({ status, message }: { status: string; message: string | null }) {
	if (status === "pending" || status === "running") {
		return (
			<HStack gap="space-2" align="center">
				<Loader size="xsmall" title="Genererer" />
				<BodyShort size="small">{message ?? "Genererer…"}</BodyShort>
			</HStack>
		)
	}
	if (status === "failed") {
		return (
			<Tag variant="error" size="small">
				Feilet
			</Tag>
		)
	}
	return (
		<Tag variant="success" size="small">
			Klar
		</Tag>
	)
}
