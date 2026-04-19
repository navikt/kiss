import { BodyLong, HStack, Tag } from "@navikt/ds-react"
import { Link } from "react-router"

export function LenkedeAppsTab({ linkedApps }: { linkedApps: Array<{ id: string; name: string }> }) {
	return (
		<div>
			<BodyLong>
				Disse applikasjonene er testdeploymenter eller varianter som arver compliance-vurderinger fra denne
				applikasjonen.
			</BodyLong>
			<HStack gap="space-4" wrap style={{ marginTop: "var(--ax-space-8)" }}>
				{linkedApps.map((la) => (
					<Tag key={la.id} variant="neutral" size="small">
						<Link to={`/applikasjoner/${la.id}/detaljer`}>{la.name}</Link>
					</Tag>
				))}
			</HStack>
		</div>
	)
}
