import { BodyLong, Button, Heading, HStack, Table, Tag, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { type ApprovalStatus, getRulesetsForSection } from "~/db/queries/rulesets.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { getAuthenticatedUser } from "~/lib/auth.server"
import { isAdmin } from "~/lib/authorization.server"
import { getFrequencyLabel } from "~/lib/routine-frequencies"

const statusConfig: Record<ApprovalStatus, { label: string; variant: "success" | "warning" | "error" | "neutral" }> = {
	draft: { label: "Utkast", variant: "neutral" },
	valid: { label: "Gyldig", variant: "success" },
	expiring_soon: { label: "Utløper snart", variant: "warning" },
	expired: { label: "Utløpt", variant: "error" },
}

export async function loader({ request, params }: LoaderFunctionArgs) {
	const { seksjon } = params
	if (!seksjon) throw data({ message: "Mangler seksjonsparameter" }, { status: 400 })

	const user = await getAuthenticatedUser(request)
	const section = await getSectionBySlug(seksjon)
	if (!section) throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })

	const rulesets = await getRulesetsForSection(section.id)

	return data({
		section,
		rulesets,
		canAdmin: user ? isAdmin(user) : false,
	})
}

export default function SeksjonRegelsettIndex() {
	const { section, rulesets, canAdmin } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-6">
			<HStack justify="space-between" align="center">
				<Heading size="large">Regelsett — {section.name}</Heading>
				{canAdmin && (
					<Button as={Link} to={`/seksjoner/${section.slug}/regelsett/ny`} variant="primary" size="small">
						Opprett nytt regelsett
					</Button>
				)}
			</HStack>
			<BodyLong>
				Regelsett definerer regler og retningslinjer som skal følges. Hvert regelsett har en ansvarlig og en frekvens
				for godkjenning.
			</BodyLong>

			{rulesets.length === 0 ? (
				<BodyLong textColor="subtle">Ingen regelsett opprettet for denne seksjonen ennå.</BodyLong>
			) : (
				/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */
				<section className="table-scroll" tabIndex={0} aria-label="Regelsett">
					<Table size="small">
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Kode</Table.HeaderCell>
								<Table.HeaderCell scope="col">Navn</Table.HeaderCell>
								<Table.HeaderCell scope="col">Ansvarlig</Table.HeaderCell>
								<Table.HeaderCell scope="col">Frekvens</Table.HeaderCell>
								<Table.HeaderCell scope="col">Siste godkjenning</Table.HeaderCell>
								<Table.HeaderCell scope="col">Status</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{rulesets.map((rs) => {
								const cfg = statusConfig[rs.approvalStatus]
								return (
									<Table.Row key={rs.id}>
										<Table.DataCell>
											<Link to={`/seksjoner/${section.slug}/regelsett/${rs.id}`}>{rs.code}</Link>
										</Table.DataCell>
										<Table.DataCell>{rs.name}</Table.DataCell>
										<Table.DataCell>{rs.responsibleName ?? "–"}</Table.DataCell>
										<Table.DataCell>{getFrequencyLabel(rs.frequency)}</Table.DataCell>
										<Table.DataCell>
											{rs.lastApproval ? new Date(rs.lastApproval.validFrom).toLocaleDateString("nb-NO") : "–"}
										</Table.DataCell>
										<Table.DataCell>
											<Tag variant={cfg.variant} size="xsmall">
												{cfg.label}
											</Tag>
										</Table.DataCell>
									</Table.Row>
								)
							})}
						</Table.Body>
					</Table>
				</section>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
