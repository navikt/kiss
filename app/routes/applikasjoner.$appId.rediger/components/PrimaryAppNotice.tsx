import { BodyLong, Box, Button } from "@navikt/ds-react"
import { Form, Link } from "react-router"

export function PrimaryAppNotice({ primaryApp }: { primaryApp: { id: string; name: string } }) {
	return (
		<Box>
			<BodyLong spacing>
				Denne applikasjonen er lenket til primærapplikasjonen{" "}
				<Link to={`/applikasjoner/${primaryApp.id}/detaljer`}>{primaryApp.name}</Link>.
			</BodyLong>
			<Form method="post">
				<input type="hidden" name="intent" value="promoteThis" />
				<input type="hidden" name="currentPrimaryId" value={primaryApp.id} />
				<Button variant="secondary" size="small" type="submit">
					Gjør denne til hovedapplikasjon
				</Button>
			</Form>
		</Box>
	)
}
