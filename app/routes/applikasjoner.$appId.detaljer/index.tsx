import { BodyLong, Box, Heading, HStack, Label, Table, Tag, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import type { ComplianceStatusValue } from "~/components/ComplianceStatus"
import { ComplianceStatusBadge } from "~/components/ComplianceStatus"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getAppAssessments } from "~/db/queries/applications.server"
import { getApplicationDetail } from "~/db/queries/nais.server"
import { compliancePercent } from "~/lib/utils"

const persistenceLabels: Record<string, string> = {
	cloud_sql_postgres: "Cloud SQL (PostgreSQL)",
	nais_postgres: "Nais Postgres",
	opensearch: "OpenSearch",
	bucket: "GCS Bucket",
	valkey: "Valkey (cache)",
	oracle: "Oracle",
	other: "Annet",
}

const persistenceVariants: Record<
	string,
	"info" | "success" | "warning" | "error" | "neutral" | "alt1" | "alt2" | "alt3"
> = {
	cloud_sql_postgres: "info",
	nais_postgres: "info",
	opensearch: "alt1",
	bucket: "alt2",
	valkey: "alt3",
	oracle: "warning",
	other: "neutral",
}

export async function loader({ params }: LoaderFunctionArgs) {
	const appId = params.appId
	if (!appId) throw new Response("Mangler app-ID", { status: 400 })

	const [detail, assessmentsResult] = await Promise.all([getApplicationDetail(appId), getAppAssessments(appId)])

	if (!detail) throw new Response("Applikasjon ikke funnet", { status: 404 })

	const assessments = assessmentsResult?.assessments ?? []
	const totalControls = assessments.length
	const implemented = assessments.filter((a) => a.status === "implemented").length
	const partial = assessments.filter((a) => a.status === "partially_implemented").length
	const notImplemented = assessments.filter((a) => a.status === "not_implemented").length
	const notRelevant = assessments.filter((a) => a.status === "not_relevant").length
	const notAssessed = assessments.filter((a) => !a.status).length

	return data({
		app: detail.app,
		environments: detail.environments,
		persistence: detail.persistence,
		teams: detail.teams,
		compliance: {
			totalControls,
			implemented,
			partial,
			notImplemented,
			notRelevant,
			notAssessed,
			percent: compliancePercent(implemented, partial, totalControls),
		},
		assessments,
	})
}

export default function ApplikasjonDetalj() {
	const { app, environments, persistence, teams, compliance, assessments } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-8">
			<div>
				<Heading size="xlarge" level="2">
					{app.name}
				</Heading>
				{app.description && <BodyLong>{app.description}</BodyLong>}
			</div>

			{/* Teams */}
			<Box>
				<Heading size="medium" level="3" spacing>
					Team
				</Heading>
				{teams.length > 0 ? (
					<HStack gap="space-4" wrap>
						{teams.map((t) => (
							<Tag key={t.teamId} variant="info" size="small">
								{t.teamName}
							</Tag>
						))}
					</HStack>
				) : (
					<BodyLong>Ikke tilknyttet noe utviklerteam.</BodyLong>
				)}
			</Box>

			{/* Environments */}
			<Box>
				<Heading size="medium" level="3" spacing>
					Miljøer
				</Heading>
				{environments.length > 0 ? (
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Klynge</Table.HeaderCell>
								<Table.HeaderCell scope="col">Namespace</Table.HeaderCell>
								<Table.HeaderCell scope="col">Nais-team</Table.HeaderCell>
								<Table.HeaderCell scope="col">Oppdaget</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{environments.map((env) => (
								<Table.Row key={env.id}>
									<Table.DataCell>
										<Tag variant="neutral" size="xsmall">
											{env.cluster}
										</Tag>
									</Table.DataCell>
									<Table.DataCell>{env.namespace}</Table.DataCell>
									<Table.DataCell>{env.naisTeamSlug ?? "–"}</Table.DataCell>
									<Table.DataCell>{new Date(env.discoveredAt).toLocaleDateString("nb-NO")}</Table.DataCell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				) : (
					<BodyLong>Ingen kjente miljøer.</BodyLong>
				)}
			</Box>

			{/* Persistence */}
			<Box>
				<Heading size="medium" level="3" spacing>
					Persistens
				</Heading>
				{persistence.length > 0 ? (
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Type</Table.HeaderCell>
								<Table.HeaderCell scope="col">Navn</Table.HeaderCell>
								<Table.HeaderCell scope="col">Versjon</Table.HeaderCell>
								<Table.HeaderCell scope="col">Tier</Table.HeaderCell>
								<Table.HeaderCell scope="col">HA</Table.HeaderCell>
								<Table.HeaderCell scope="col">Audit logging</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{persistence.map((p) => (
								<Table.Row key={p.id}>
									<Table.DataCell>
										<Tag variant={persistenceVariants[p.type] ?? "neutral"} size="xsmall">
											{persistenceLabels[p.type] ?? p.type}
										</Tag>
									</Table.DataCell>
									<Table.DataCell>{p.name}</Table.DataCell>
									<Table.DataCell>{p.version ?? "–"}</Table.DataCell>
									<Table.DataCell>{p.tier ?? "–"}</Table.DataCell>
									<Table.DataCell>
										{p.highAvailability === true ? "✓" : p.highAvailability === false ? "✗" : "–"}
									</Table.DataCell>
									<Table.DataCell>
										{p.auditLogging === true ? (
											p.auditLogUrl ? (
												<a href={p.auditLogUrl} target="_blank" rel="noopener noreferrer" className="aksel-link">
													✓ Logg
												</a>
											) : (
												<Tag variant="success" size="xsmall">
													✓ På
												</Tag>
											)
										) : p.auditLogging === false ? (
											<Tag variant="error" size="xsmall">
												✗ Av
											</Tag>
										) : (
											"–"
										)}
									</Table.DataCell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				) : (
					<BodyLong>Ingen kjent persistens fra Nais.</BodyLong>
				)}
			</Box>

			{/* Compliance summary */}
			<Box>
				<Heading size="medium" level="3" spacing>
					Compliance
				</Heading>
				<HStack gap="space-6" wrap>
					<VStack gap="space-1">
						<Label size="small">Total</Label>
						<Heading size="large" level="4">
							<Tag variant={compliance.percent >= 80 ? "success" : compliance.percent >= 50 ? "warning" : "error"}>
								{compliance.percent} %
							</Tag>
						</Heading>
					</VStack>
					<VStack gap="space-1">
						<Label size="small">Implementert</Label>
						<BodyLong>{compliance.implemented}</BodyLong>
					</VStack>
					<VStack gap="space-1">
						<Label size="small">Delvis</Label>
						<BodyLong>{compliance.partial}</BodyLong>
					</VStack>
					<VStack gap="space-1">
						<Label size="small">Ikke implementert</Label>
						<BodyLong>{compliance.notImplemented}</BodyLong>
					</VStack>
					<VStack gap="space-1">
						<Label size="small">Ikke relevant</Label>
						<BodyLong>{compliance.notRelevant}</BodyLong>
					</VStack>
					<VStack gap="space-1">
						<Label size="small">Ikke vurdert</Label>
						<BodyLong>{compliance.notAssessed}</BodyLong>
					</VStack>
				</HStack>
				<div style={{ marginTop: "var(--ax-space-4)" }}>
					<Link to={`/applikasjoner/${app.id}/compliance`}>Gå til compliance-vurdering →</Link>
				</div>
			</Box>

			{/* Controls needing attention */}
			{compliance.notAssessed + compliance.notImplemented > 0 && (
				<Box>
					<Heading size="medium" level="3" spacing>
						Kontroller som trenger oppfølging
					</Heading>
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Kontroll-ID</Table.HeaderCell>
								<Table.HeaderCell scope="col">Navn</Table.HeaderCell>
								<Table.HeaderCell scope="col">Domene</Table.HeaderCell>
								<Table.HeaderCell scope="col">Status</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{assessments
								.filter((a) => !a.status || a.status === "not_implemented" || a.status === "partially_implemented")
								.map((a) => (
									<Table.Row key={a.controlUuid}>
										<Table.DataCell>{a.controlId}</Table.DataCell>
										<Table.DataCell>{a.controlName}</Table.DataCell>
										<Table.DataCell>
											<Tag variant="neutral" size="xsmall">
												{a.domainCode}
											</Tag>
										</Table.DataCell>
										<Table.DataCell>
											{a.status ? (
												<ComplianceStatusBadge status={a.status as ComplianceStatusValue} />
											) : (
												<Tag variant="neutral" size="xsmall">
													Ikke vurdert
												</Tag>
											)}
										</Table.DataCell>
									</Table.Row>
								))}
						</Table.Body>
					</Table>
				</Box>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
