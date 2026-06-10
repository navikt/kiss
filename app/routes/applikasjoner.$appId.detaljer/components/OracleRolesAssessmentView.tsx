import { Link as AkselLink, BodyShort, Heading, Table, Tag, VStack } from "@navikt/ds-react"
import { Link } from "react-router"
import type { GroupCriticality } from "~/db/schema/applications"
import { groupCriticalityLabels } from "~/db/schema/applications"
import { criticalityTagColor, criticalityTagVariant } from "../shared"

interface OracleRoleAssessmentRow {
	instanceId: string
	roleName: string
	criticality: GroupCriticality
}

function parseAssessments(
	assessments: Record<string, { criticality: GroupCriticality; updatedBy: string; updatedAt: string }>,
): OracleRoleAssessmentRow[] {
	return Object.entries(assessments)
		.map(([key, val]) => {
			const colonIdx = key.indexOf(":")
			if (colonIdx === -1) return null
			return {
				instanceId: key.slice(0, colonIdx),
				roleName: key.slice(colonIdx + 1),
				criticality: val.criticality,
			}
		})
		.filter((r): r is OracleRoleAssessmentRow => r !== null)
		.sort((a, b) => a.instanceId.localeCompare(b.instanceId, "nb") || a.roleName.localeCompare(b.roleName, "nb"))
}

export function OracleRolesAssessmentView({
	assessments,
	sourceReview,
}: {
	assessments: Record<string, { criticality: GroupCriticality; updatedBy: string; updatedAt: string }>
	sourceReview: {
		reviewId: string
		title: string
		reviewedAt: string
		gjennomgangUrl: string | null
	} | null
}) {
	const rows = parseAssessments(assessments)

	return (
		<VStack gap="space-4">
			<Heading size="xsmall" level="4">
				{rows.length > 0 ? `Oracle Database-roller (${rows.length})` : "Oracle Database-roller"}
			</Heading>

			{rows.length === 0 ? (
				<BodyShort size="small" textColor="subtle">
					Ingen kritikalitetsvurdering av Oracle-roller er registrert for denne applikasjonen. Fullfør en
					rutinegjennomgang med Oracle-rollekritikalitet for å se vurderingen her.
				</BodyShort>
			) : (
				<>
					{sourceReview && (
						<BodyShort size="small" textColor="subtle">
							Fra gjennomgang:{" "}
							{sourceReview.gjennomgangUrl ? (
								<AkselLink as={Link} to={sourceReview.gjennomgangUrl}>
									{sourceReview.title}
								</AkselLink>
							) : (
								sourceReview.title
							)}{" "}
							({new Date(sourceReview.reviewedAt).toLocaleDateString("nb-NO")})
						</BodyShort>
					)}
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
					<section className="table-scroll" tabIndex={0} aria-label="Oracle Database-roller">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Instans</Table.HeaderCell>
									<Table.HeaderCell scope="col">Rolle</Table.HeaderCell>
									<Table.HeaderCell scope="col">Kritikalitet</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{rows.map((r) => (
									<Table.Row key={`${r.instanceId}:${r.roleName}`}>
										<Table.DataCell>
											<BodyShort size="small">{r.instanceId.toUpperCase()}</BodyShort>
										</Table.DataCell>
										<Table.DataCell>
											<BodyShort size="small" style={{ fontFamily: "monospace" }}>
												{r.roleName}
											</BodyShort>
										</Table.DataCell>
										<Table.DataCell>
											<Tag
												variant={criticalityTagVariant[r.criticality] ?? "neutral"}
												size="xsmall"
												style={
													r.criticality === "high"
														? { backgroundColor: criticalityTagColor.high, borderColor: criticalityTagColor.high }
														: undefined
												}
											>
												{groupCriticalityLabels[r.criticality] ?? r.criticality}
											</Tag>
										</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				</>
			)}
		</VStack>
	)
}
