import { BodyLong, Button, Detail, Heading, HStack, Select, Table, Tag, VStack } from "@navikt/ds-react"
import { data, Form, Link, useLoaderData } from "react-router"
import { countSyncJobSummaries, listSyncJobSummaries } from "~/db/queries/sync-jobs.server"
import type { SyncJobState } from "~/db/schema/sync-jobs"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"
import { getSyncJobStateLabel, getSyncJobStateTagVariant, SYNC_JOB_STATE_VALUES } from "~/lib/sync-job-state-tags"
import { ALL_SYNC_JOB_TYPES } from "~/lib/sync-job-types"
import { CYCLE_INTERVAL_MS } from "~/lib/unified-scheduler.server"
import { formatDateTimeOslo } from "~/lib/utils"
import type { Route } from "./+types/index"

const PAGE_SIZE = 25

const SYNC_JOB_STATES: Array<{ value: SyncJobState; label: string }> = SYNC_JOB_STATE_VALUES.map((value) => ({
	value,
	label: getSyncJobStateLabel(value),
}))

export async function loader({ request, url }: Route.LoaderArgs) {
	const authedUser = await requireAuthenticatedUser(request)
	requireAdmin(authedUser)

	const stateParam = url.searchParams.get("state") || ""
	const jobTypeParam = url.searchParams.get("jobType") || ""
	const requestedPage = parsePositiveInt(url.searchParams.get("page"))

	// Validate state filter against known values
	const stateFilter = (SYNC_JOB_STATE_VALUES.includes(stateParam as SyncJobState) ? stateParam : "") as
		| SyncJobState
		| ""

	// Validate jobType filter against known values
	const jobTypeFilter = ALL_SYNC_JOB_TYPES.includes(jobTypeParam as (typeof ALL_SYNC_JOB_TYPES)[number])
		? jobTypeParam
		: ""

	const totalSyncJobs = await countSyncJobSummaries({
		state: stateFilter || undefined,
		jobType: jobTypeFilter || undefined,
	})
	const totalPages = totalSyncJobs > 0 ? Math.ceil(totalSyncJobs / PAGE_SIZE) : 1
	const page = Math.min(requestedPage, totalPages)
	const offset = (page - 1) * PAGE_SIZE

	const syncJobs = await listSyncJobSummaries({
		state: stateFilter || undefined,
		jobType: jobTypeFilter || undefined,
		limit: PAGE_SIZE,
		offset,
	})

	return data({
		syncJobs,
		stateFilter,
		jobTypeFilter,
		totalSyncJobs,
		page,
		pageSize: PAGE_SIZE,
		totalPages,
		naisSyncEnabled: process.env.ENABLE_NAIS_SYNC === "true",
		naisSyncIntervalMinutes: Math.round(CYCLE_INTERVAL_MS / 60_000),
	})
}

export default function AdminSyncJobsPage() {
	const {
		syncJobs,
		stateFilter,
		jobTypeFilter,
		totalSyncJobs,
		page,
		pageSize,
		totalPages,
		naisSyncEnabled,
		naisSyncIntervalMinutes,
	} = useLoaderData<typeof loader>()
	const firstItemOnPage = totalSyncJobs === 0 ? 0 : (page - 1) * pageSize + 1
	const lastItemOnPage = totalSyncJobs === 0 ? 0 : firstItemOnPage + syncJobs.length - 1

	return (
		<div style={{ padding: "var(--a-spacing-8)" }}>
			<VStack gap="space-16">
				<VStack gap="space-4">
					<Heading level="1" size="large">
						Synkjobber
					</Heading>
					<BodyLong>Oversikt over kjørte og pågående synkjobber i systemet.</BodyLong>
					{naisSyncEnabled ? (
						<Tag variant="success" size="small" style={{ alignSelf: "flex-start" }}>
							Automatisk synkronisering aktiv (hvert {naisSyncIntervalMinutes}. minutt)
						</Tag>
					) : (
						<Tag variant="neutral" size="small" style={{ alignSelf: "flex-start" }}>
							Automatisk synkronisering deaktivert
						</Tag>
					)}
				</VStack>

				<section
					className="admin-sync-filters"
					style={{ padding: "var(--a-spacing-8)", backgroundColor: "var(--a-bg-subtle)" }}
				>
					<Form method="get">
						<VStack gap="space-8">
							<HStack gap="space-8" wrap>
								<Select label="Status" name="state" defaultValue={stateFilter} style={{ minWidth: "200px" }}>
									<option value="">Alle statuser</option>
									{SYNC_JOB_STATES.map((s) => (
										<option key={s.value} value={s.value}>
											{s.label}
										</option>
									))}
								</Select>

								<Select label="Jobbtype" name="jobType" defaultValue={jobTypeFilter} style={{ minWidth: "200px" }}>
									<option value="">Alle jobber</option>
									{ALL_SYNC_JOB_TYPES.map((jt) => (
										<option key={jt} value={jt}>
											{jt}
										</option>
									))}
								</Select>
							</HStack>
							<input type="hidden" name="page" value="1" />

							<HStack gap="space-4">
								<Button type="submit" variant="primary">
									Søk
								</Button>
								<Button as="a" href="/admin/synkjobber" variant="secondary">
									Tilbakestill
								</Button>
							</HStack>
						</VStack>
					</Form>
				</section>

				{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table wrapper needs keyboard access */}
				<section className="table-scroll" tabIndex={0} aria-label="Synkjobber">
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Tidspunkt</Table.HeaderCell>
								<Table.HeaderCell scope="col">Jobbtype</Table.HeaderCell>
								<Table.HeaderCell scope="col">Status</Table.HeaderCell>
								<Table.HeaderCell scope="col">Melding</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{syncJobs.map((job) => (
								<Table.Row key={job.id}>
									<Table.DataCell>
										<Link to={`/admin/synkjobber/${job.id}`}>
											<Detail>{formatDateTimeOslo(job.createdAt)}</Detail>
										</Link>
									</Table.DataCell>
									<Table.DataCell>
										<Detail>{job.jobType}</Detail>
									</Table.DataCell>
									<Table.DataCell>
										<Tag variant={getSyncJobStateTagVariant(job.state)} size="xsmall">
											{getSyncJobStateLabel(job.state)}
										</Tag>
									</Table.DataCell>
									<Table.DataCell>
										<Detail>{job.error ?? job.message ?? "—"}</Detail>
									</Table.DataCell>
								</Table.Row>
							))}
							{syncJobs.length === 0 && (
								<Table.Row>
									<Table.DataCell colSpan={4}>
										<Detail textColor="subtle">Ingen synkjobber funnet.</Detail>
									</Table.DataCell>
								</Table.Row>
							)}
						</Table.Body>
					</Table>
				</section>

				<HStack gap="space-4" align="center" justify="space-between">
					<Detail textColor="subtle">
						Viser {firstItemOnPage}–{lastItemOnPage} av {totalSyncJobs} synkjobber.
					</Detail>
					<HStack gap="space-2">
						{page > 1 ? (
							<Button
								as={Link}
								to={buildSyncJobsLink(stateFilter, jobTypeFilter, page - 1)}
								variant="secondary"
								size="small"
							>
								Forrige
							</Button>
						) : (
							<Button variant="secondary" size="small" disabled>
								Forrige
							</Button>
						)}
						{page < totalPages ? (
							<Button
								as={Link}
								to={buildSyncJobsLink(stateFilter, jobTypeFilter, page + 1)}
								variant="secondary"
								size="small"
							>
								Neste
							</Button>
						) : (
							<Button variant="secondary" size="small" disabled>
								Neste
							</Button>
						)}
					</HStack>
				</HStack>
			</VStack>
		</div>
	)
}

function parsePositiveInt(value: string | null): number {
	const parsed = Number(value)
	if (!Number.isInteger(parsed) || parsed < 1) {
		return 1
	}
	return parsed
}

function buildSyncJobsLink(stateFilter: string, jobTypeFilter: string, page: number): string {
	const query = new URLSearchParams()
	if (stateFilter) {
		query.set("state", stateFilter)
	}
	if (jobTypeFilter) {
		query.set("jobType", jobTypeFilter)
	}
	query.set("page", String(page))
	return `/admin/synkjobber?${query.toString()}`
}
