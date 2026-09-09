import { Alert, BodyLong, Button, Heading, HStack, Tag, VStack } from "@navikt/ds-react"
import { sql } from "drizzle-orm"
import { data, useFetcher, useLoaderData } from "react-router"
import { db } from "~/db/connection.server"
import { syncAllApplicationControls } from "~/db/queries/application-controls.server"
import { backfillKnownDevFssOracleClusters, backfillOracleClustersForAllApps } from "~/db/queries/audit-logging.server"
import { migrateExistingReplacementChains } from "~/db/queries/routines.server"
import { requireAuthenticatedUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"
import type { Route } from "./+types/index"
export async function loader({ request }: Route.LoaderArgs) {
	const authedUser = await requireAuthenticatedUser(request)
	requireAdmin(authedUser)

	const appControlStats = await getApplicationControlStats()

	return data({ appControlStats })
}

async function getApplicationControlStats() {
	const [totalApps] = (
		await db.execute<{ count: string }>(sql`
		SELECT COUNT(*)::text AS count FROM monitored_applications
		WHERE primary_application_id IS NULL
	`)
	).rows

	const [syncedApps] = (
		await db.execute<{ count: string }>(sql`
		SELECT COUNT(DISTINCT application_id)::text AS count FROM application_controls
	`)
	).rows

	return {
		totalApps: Number(totalApps.count),
		syncedApps: Number(syncedApps.count),
	}
}

export async function action({ request }: Route.ActionArgs) {
	const authedUser = await requireAuthenticatedUser(request)
	requireAdmin(authedUser)

	const formData = await request.formData()
	const intent = formData.get("intent")

	if (intent === "sync-controls") {
		const start = Date.now()
		const result = await syncAllApplicationControls(authedUser.navIdent)
		const elapsed = Date.now() - start

		return data({
			intent: "sync-controls",
			success: true,
			synced: result.synced,
			errors: result.errors,
			elapsed,
		})
	}

	if (intent === "backfill-oracle-clusters") {
		const start = Date.now()
		const result = await backfillOracleClustersForAllApps(authedUser.navIdent)
		const elapsed = Date.now() - start

		return data({
			intent: "backfill-oracle-clusters",
			success: true,
			appsProcessed: result.appsProcessed,
			entriesAffected: result.entriesAffected,
			elapsed,
		})
	}

	if (intent === "backfill-known-dev-fss-oracle-clusters") {
		const start = Date.now()
		const result = await backfillKnownDevFssOracleClusters(authedUser.navIdent)
		const elapsed = Date.now() - start

		return data({
			intent: "backfill-known-dev-fss-oracle-clusters",
			success: true,
			rowsUpdated: result.rowsUpdated,
			rowsSkipped: result.rowsSkipped,
			elapsed,
		})
	}

	if (intent === "migrate-routine-links") {
		const start = Date.now()
		const result = await migrateExistingReplacementChains(authedUser.navIdent)
		const elapsed = Date.now() - start

		if (result === null) {
			return data(
				{ intent: "migrate-routine-links", success: false, message: "Migrering pågår allerede." },
				{ status: 409 },
			)
		}

		return data({
			intent: "migrate-routine-links",
			success: true,
			presets: result.presets,
			selections: result.selections,
			arrayReplacements: result.arrayReplacements,
			reviewsInherited: result.reviewsInherited,
			titlesBackfilled: result.titlesBackfilled,
			elapsed,
		})
	}

	return data({ intent: "unknown", success: false, message: "Ukjent handling" }, { status: 400 })
}

export { RouteErrorBoundary as ErrorBoundary } from "~/components/RouteErrorBoundary"

export default function AdminVedlikehold() {
	const { appControlStats } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-8">
			<VStack gap="space-2">
				<Heading size="xlarge" level="2">
					Vedlikehold
				</Heading>
				<BodyLong>Synkronisering og vedlikeholdsoperasjoner for systemet.</BodyLong>
			</VStack>

			<VStack gap="space-6">
				<SyncControlsCard stats={appControlStats} />
				<BackfillOracleClustersCard />
				<BackfillKnownDevFssOracleClustersCard />
				<MigrateRoutineLinksCard />
			</VStack>
		</VStack>
	)
}

function SyncControlsCard({ stats }: { stats: { totalApps: number; syncedApps: number } }) {
	const fetcher = useFetcher<typeof action>()
	const isSubmitting = fetcher.state !== "idle"
	const result = fetcher.data?.intent === "sync-controls" ? fetcher.data : null

	return (
		<section className="admin-maintenance-card">
			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Synkroniser kontroller
				</Heading>
				<BodyLong>
					Synkroniserer applikasjonskontroller basert på compliance-vurderinger, screening-svar og regelsett. Dette
					oppdaterer kontroll-status, rutineetterlevelse og kommentarfelt for alle applikasjoner.
				</BodyLong>

				<HStack gap="space-4" align="center">
					<Tag variant="info" size="small">
						{stats.syncedApps} av {stats.totalApps} applikasjoner synkronisert
					</Tag>
					{stats.syncedApps < stats.totalApps && (
						<Tag variant="warning" size="small">
							{stats.totalApps - stats.syncedApps} mangler synkronisering
						</Tag>
					)}
				</HStack>

				<HStack gap="space-4" align="center">
					<fetcher.Form method="post">
						<input type="hidden" name="intent" value="sync-controls" />
						<Button type="submit" variant="primary" size="small" loading={isSubmitting}>
							{isSubmitting ? "Synkroniserer..." : "Kjør synkronisering"}
						</Button>
					</fetcher.Form>
				</HStack>

				{result?.success && "synced" in result && (
					<Alert variant="success" size="small">
						Synkronisering fullført på {formatElapsed(result.elapsed)}. {result.synced} applikasjoner synkronisert
						{result.errors > 0 ? `, ${result.errors} feil` : ""}.
					</Alert>
				)}
			</VStack>
		</section>
	)
}

function BackfillOracleClustersCard() {
	const fetcher = useFetcher<typeof action>()
	const isSubmitting = fetcher.state !== "idle"
	const result = fetcher.data?.intent === "backfill-oracle-clusters" ? fetcher.data : null

	return (
		<section className="admin-maintenance-card">
			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Backfill cluster på Oracle-koblinger
				</Heading>
				<BodyLong>
					Engangsoperasjon som går gjennom alle applikasjoner med aktive Oracle-instanskoblinger og setter/backfiller
					`cluster` på tilhørende persistence-rader (kun når appen har nøyaktig ett aktivt cluster). Oppretter også
					manglende rader for instanser som ikke har en tilsvarende persistence-rad ennå. Trygg å kjøre flere ganger.
				</BodyLong>
				<HStack gap="space-4" align="center">
					<fetcher.Form method="post">
						<input type="hidden" name="intent" value="backfill-oracle-clusters" />
						<Button type="submit" variant="secondary" size="small" loading={isSubmitting}>
							{isSubmitting ? "Backfiller..." : "Kjør backfill"}
						</Button>
					</fetcher.Form>
				</HStack>
				{result?.success && "appsProcessed" in result && (
					<Alert variant="success" size="small">
						Fullført på {formatElapsed(result.elapsed)}. {result.appsProcessed} applikasjoner behandlet,{" "}
						{result.entriesAffected} persistence-rader oppdatert/opprettet.
					</Alert>
				)}
			</VStack>
		</section>
	)
}

function BackfillKnownDevFssOracleClustersCard() {
	const fetcher = useFetcher<typeof action>()
	const isSubmitting = fetcher.state !== "idle"
	const result = fetcher.data?.intent === "backfill-known-dev-fss-oracle-clusters" ? fetcher.data : null

	return (
		<section className="admin-maintenance-card">
			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Sett cluster på kjente dev-fss Oracle-baser
				</Heading>
				<BodyLong>
					Engangsoperasjon som setter `cluster = 'dev-fss'` manuelt på to spesifikke Oracle-persistence-rader
					(`supstonad-historisk/oracle/historisk_exodus_q1` og `supstonad-historisk/oracle/su_infotrygd_q`) som ikke kan
					cluster-utledes automatisk fordi applikasjonen finnes som to separate rader (prod-fss og dev-fss). Trygg å
					kjøre flere ganger — hopper over rader som allerede har cluster satt.
				</BodyLong>
				<HStack gap="space-4" align="center">
					<fetcher.Form method="post">
						<input type="hidden" name="intent" value="backfill-known-dev-fss-oracle-clusters" />
						<Button type="submit" variant="secondary" size="small" loading={isSubmitting}>
							{isSubmitting ? "Oppdaterer..." : "Sett cluster"}
						</Button>
					</fetcher.Form>
				</HStack>
				{result?.success && "rowsUpdated" in result && (
					<Alert variant="success" size="small">
						Fullført på {formatElapsed(result.elapsed)}. {result.rowsUpdated} rad(er) oppdatert, {result.rowsSkipped}{" "}
						hoppet over (allerede satt).
					</Alert>
				)}
			</VStack>
		</section>
	)
}

function MigrateRoutineLinksCard() {
	const fetcher = useFetcher<typeof action>()
	const isSubmitting = fetcher.state !== "idle"
	const result = fetcher.data?.intent === "migrate-routine-links" ? fetcher.data : null

	return (
		<section className="admin-maintenance-card">
			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Migrer rutinelenker
				</Heading>
				<BodyLong>
					Engangsoperasjon som fikser stale lenker i eksisterende rutinekjeder: oppdaterer forvalgte rutiner i
					screening, aktive rutinevalg og kontrollcachen slik at alle peker på gjeldende rutine. Arver også
					gjennomganger for «fortsett»-kjeder. Trygg å kjøre flere ganger — hopper over det som allerede er oppdatert.
				</BodyLong>
				<HStack gap="space-4" align="center">
					<fetcher.Form method="post">
						<input type="hidden" name="intent" value="migrate-routine-links" />
						<Button type="submit" variant="secondary" size="small" loading={isSubmitting}>
							{isSubmitting ? "Migrerer..." : "Kjør migrering"}
						</Button>
					</fetcher.Form>
				</HStack>
				{result?.success && "presets" in result && (
					<Alert variant="success" size="small">
						Migrering fullført på {formatElapsed(result.elapsed)}. {result.presets} forvalgte rutiner,{" "}
						{result.selections} rutinevalg, {result.arrayReplacements} kontrollcache-rader, {result.reviewsInherited}{" "}
						arvede gjennomganger og {result.titlesBackfilled} titler oppdatert.
					</Alert>
				)}
				{result?.success === false && "message" in result && (
					<Alert variant="warning" size="small">
						{result.message}
					</Alert>
				)}
			</VStack>
		</section>
	)
}

function formatElapsed(ms: number): string {
	if (ms < 1000) return `${ms}ms`
	return `${(ms / 1000).toFixed(1)}s`
}
