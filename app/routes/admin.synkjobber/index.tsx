import { BodyLong, Button, Detail, Heading, HStack, Select, Table, Tag, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Form, Link, useLoaderData } from "react-router"
import { listSyncJobSummaries } from "~/db/queries/sync-jobs.server"
import type { SyncJobState } from "~/db/schema/sync-jobs"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"
import { ALL_SYNC_JOB_TYPES } from "~/lib/sync-job-types"
import { formatDateTimeOslo } from "~/lib/utils"

const SYNC_JOB_STATES: Array<{ value: SyncJobState; label: string }> = [
	{ value: "pending", label: "Venter" },
	{ value: "running", label: "Pågår" },
	{ value: "completed", label: "Fullført" },
	{ value: "skipped", label: "Hoppet over" },
	{ value: "failed", label: "Feilet" },
]

const VALID_STATES = SYNC_JOB_STATES.map((s) => s.value)

export async function loader({ request }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)

	const url = new URL(request.url)
	const stateParam = url.searchParams.get("state") || ""
	const jobTypeParam = url.searchParams.get("jobType") || ""

	// Validate state filter against known values
	const stateFilter = (VALID_STATES.includes(stateParam as SyncJobState) ? stateParam : "") as SyncJobState | ""

	// Validate jobType filter against known values
	const jobTypeFilter = ALL_SYNC_JOB_TYPES.includes(jobTypeParam as (typeof ALL_SYNC_JOB_TYPES)[number])
		? jobTypeParam
		: ""

	const syncJobs = await listSyncJobSummaries({
		state: stateFilter || undefined,
		jobType: jobTypeFilter || undefined,
		limit: 100,
	})

	return data({ syncJobs, stateFilter, jobTypeFilter })
}

export default function AdminSyncJobsPage() {
	const { syncJobs, stateFilter, jobTypeFilter } = useLoaderData<typeof loader>()

	return (
		<div style={{ padding: "var(--a-spacing-8)" }}>
			<VStack gap="space-16">
				<VStack gap="space-4">
					<Heading level="1" size="large">
						Synkjobber
					</Heading>
					<BodyLong>Oversikt over kjørte og pågående synkjobber i systemet.</BodyLong>
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
										<Tag variant={getSyncStateTagVariant(job.state)} size="xsmall">
											{getSyncStateLabel(job.state)}
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

				<Detail textColor="subtle">Totalt {syncJobs.length} synkjobber.</Detail>
			</VStack>
		</div>
	)
}

function getSyncStateLabel(state: SyncJobState): string {
	switch (state) {
		case "pending":
			return "Venter"
		case "running":
			return "Pågår"
		case "completed":
			return "Fullført"
		case "failed":
			return "Feilet"
		case "skipped":
			return "Hoppet over"
	}
	return "Ukjent"
}

function getSyncStateTagVariant(state: SyncJobState): "neutral" | "info" | "success" | "error" | "warning" {
	switch (state) {
		case "pending":
			return "neutral"
		case "running":
			return "info"
		case "completed":
			return "success"
		case "failed":
			return "error"
		case "skipped":
			return "warning"
	}
	return "neutral"
}

export const _testing = { getSyncStateLabel, getSyncStateTagVariant }
