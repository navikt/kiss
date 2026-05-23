import { BodyShort, Heading, HStack, Table, Tag, VStack } from "@navikt/ds-react"
import { Link } from "react-router"
import type { ApprovalStatus } from "~/db/queries/rulesets.server"
import { type UserRole, userRoleLabels } from "~/db/schema/organization"
import { approvalStatusConfig } from "~/lib/approval-status"
import { getFrequencyLabel } from "~/lib/routine-frequencies"

type AppRuleset = {
	id: string
	code: string | null
	name: string
	description: string | null
	frequency: string
	status: string
	sectionId: string
	sectionSlug: string
	sectionName: string
	responsibleName: string | null
	responsibleRole: string | null
	approvalStatus: ApprovalStatus
	lastApproval: { validFrom: string; validUntil: string } | null
	controls: Array<{ id: string; controlId: string; shortTitle: string | null }>
}

export function RegelsettTab({ rulesets }: { rulesets: AppRuleset[] }) {
	if (rulesets.length === 0) {
		return (
			<VStack gap="space-8">
				<Heading size="small" level="3">
					Regelsett
				</Heading>
				<BodyShort textColor="subtle">Ingen regelsett er knyttet til denne applikasjonen via screening-svar.</BodyShort>
			</VStack>
		)
	}

	return (
		<VStack gap="space-8">
			<Heading size="small" level="3">
				Regelsett ({rulesets.length})
			</Heading>
			<BodyShort size="small" textColor="subtle">
				Regelsett som gjelder for denne applikasjonen basert på screening-svar.
			</BodyShort>
			{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table needs keyboard access */}
			<section className="table-scroll" tabIndex={0} aria-label="Regelsett for applikasjon">
				<Table size="small">
					<Table.Header>
						<Table.Row>
							<Table.HeaderCell>Regelsett</Table.HeaderCell>
							<Table.HeaderCell>Seksjon</Table.HeaderCell>
							<Table.HeaderCell>Frekvens</Table.HeaderCell>
							<Table.HeaderCell>Status</Table.HeaderCell>
							<Table.HeaderCell>Kontroller</Table.HeaderCell>
							<Table.HeaderCell>Ansvarlig</Table.HeaderCell>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{rulesets.map((rs) => {
							const cfg = approvalStatusConfig[rs.approvalStatus]
							return (
								<Table.Row key={rs.id}>
									<Table.DataCell>
										<VStack gap="space-2">
											<Link to={`/seksjoner/${rs.sectionSlug}/regelsett/${rs.id}`} className="navds-link">
												<BodyShort size="small" weight="semibold" as="span">
													{rs.code ? `${rs.code} – ${rs.name}` : rs.name}
												</BodyShort>
											</Link>
											{rs.description && (
												<BodyShort size="small" textColor="subtle" truncate>
													{rs.description}
												</BodyShort>
											)}
										</VStack>
									</Table.DataCell>
									<Table.DataCell>
										<BodyShort size="small">{rs.sectionName}</BodyShort>
									</Table.DataCell>
									<Table.DataCell>
										<BodyShort size="small">{getFrequencyLabel(rs.frequency)}</BodyShort>
									</Table.DataCell>
									<Table.DataCell>
										<Tag variant={cfg.variant} size="xsmall">
											{cfg.label}
										</Tag>
									</Table.DataCell>
									<Table.DataCell>
										<HStack gap="space-2" wrap>
											{rs.controls.slice(0, 3).map((c) => (
												<Tag key={c.id} variant="neutral" size="xsmall">
													{c.controlId}
												</Tag>
											))}
											{rs.controls.length > 3 && (
												<Tag variant="neutral" size="xsmall">
													+{rs.controls.length - 3}
												</Tag>
											)}
										</HStack>
									</Table.DataCell>
									<Table.DataCell>
										<BodyShort size="small">
											{rs.responsibleName ??
												(rs.responsibleRole
													? (userRoleLabels[rs.responsibleRole as UserRole] ?? rs.responsibleRole)
													: "—")}
										</BodyShort>
									</Table.DataCell>
								</Table.Row>
							)
						})}
					</Table.Body>
				</Table>
			</section>
		</VStack>
	)
}
