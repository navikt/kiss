import { BodyLong, BodyShort, Box, Detail, Heading, HStack, Table, Tag, VStack } from "@navikt/ds-react"
import { Link } from "react-router"
import type { ApprovalStatus } from "~/db/queries/rulesets.server"
import { type UserRole, userRoleLabels } from "~/db/schema/organization"
import { approvalStatusConfig } from "~/lib/approval-status"
import { getFrequencyLabel } from "~/lib/routine-frequencies"

type Ruleset = {
	id: string
	code: string | null
	name: string
	description: string | null
	descriptionHtml: string | null
	frequency: string
	status: string
	responsibleName: string | null
	responsibleRole: string | null
	approvalStatus: string
	lastApproval: { validFrom: string; validUntil: string } | null
	controls: Array<{ id: string; controlId: string; shortTitle: string | null }>
}

type Props = {
	rulesets: Ruleset[]
	sectionSlug: string
}

export function StepRulesets({ rulesets, sectionSlug }: Props) {
	return (
		<VStack gap="space-6">
			<div>
				<Heading size="medium" level="3" spacing>
					Regelsett
				</Heading>
				<BodyShort size="small" textColor="subtle">
					Regelsett som er koblet til de samme kontrollene som denne rutinen. Gjennomgå at regelsettene er oppdaterte og
					dekkende.
				</BodyShort>
			</div>

			{rulesets.length > 0 ? (
				<VStack gap="space-8">
					{rulesets.map((rs) => (
						<RulesetCard key={rs.id} ruleset={rs} sectionSlug={sectionSlug} />
					))}
				</VStack>
			) : (
				<BodyShort textColor="subtle">Ingen regelsett er koblet til denne rutinens kontroller.</BodyShort>
			)}
		</VStack>
	)
}

function RulesetCard({ ruleset, sectionSlug }: { ruleset: Ruleset; sectionSlug: string }) {
	const cfg = approvalStatusConfig[ruleset.approvalStatus as ApprovalStatus] ?? approvalStatusConfig.draft

	return (
		<Box padding="space-8" borderWidth="1" borderColor="neutral-subtle" borderRadius="8">
			<VStack gap="space-6">
				<HStack justify="space-between" align="center" wrap>
					<Heading size="small" level="4">
						<Link to={`/seksjoner/${sectionSlug}/regelsett/${ruleset.id}`}>
							{ruleset.code ? `${ruleset.code} – ` : ""}
							{ruleset.name}
						</Link>
					</Heading>
					<Tag variant={cfg.variant} size="xsmall">
						{cfg.label}
					</Tag>
				</HStack>

				<HStack gap="space-12" wrap>
					<VStack gap="space-1">
						<Detail textColor="subtle">Ansvarlig</Detail>
						<BodyLong size="small">
							{ruleset.responsibleName ??
								(ruleset.responsibleRole
									? (userRoleLabels[ruleset.responsibleRole as UserRole] ?? ruleset.responsibleRole)
									: "Ikke angitt")}
						</BodyLong>
					</VStack>
					<VStack gap="space-1">
						<Detail textColor="subtle">Frekvens</Detail>
						<BodyLong size="small">{getFrequencyLabel(ruleset.frequency)}</BodyLong>
					</VStack>
					<VStack gap="space-1">
						<Detail textColor="subtle">Gyldig til</Detail>
						<BodyLong size="small">
							{ruleset.lastApproval
								? new Date(ruleset.lastApproval.validUntil).toLocaleDateString("nb-NO")
								: "Ikke godkjent"}
						</BodyLong>
					</VStack>
				</HStack>

				{ruleset.descriptionHtml && (
					<div
						className="markdown-content"
						// biome-ignore lint/security/noDangerouslySetInnerHtml: server-sanitized
						dangerouslySetInnerHTML={{ __html: ruleset.descriptionHtml }}
					/>
				)}

				{ruleset.controls.length > 0 && (
					<VStack gap="space-2">
						<Detail textColor="subtle">Tilknyttede kontrollkrav</Detail>
						{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
						<section className="table-scroll" tabIndex={0} aria-label={`Kontrollkrav for ${ruleset.name}`}>
							<Table size="small">
								<Table.Header>
									<Table.Row>
										<Table.HeaderCell scope="col">Kontroll-ID</Table.HeaderCell>
										<Table.HeaderCell scope="col">Navn</Table.HeaderCell>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{ruleset.controls.map((c) => (
										<Table.Row key={c.id}>
											<Table.DataCell>
												<Link to={`/kontrollrammeverk/_/${c.controlId}`}>{c.controlId}</Link>
											</Table.DataCell>
											<Table.DataCell>{c.shortTitle ?? "–"}</Table.DataCell>
										</Table.Row>
									))}
								</Table.Body>
							</Table>
						</section>
					</VStack>
				)}
			</VStack>
		</Box>
	)
}
