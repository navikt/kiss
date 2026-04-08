import { BodyLong, Heading, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { Link } from "react-router"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { requireAdmin } from "~/lib/authorization.server"

export async function loader({ request }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)
	requireAdmin(authedUser)
	return null
}

export default function Admin() {
	return (
		<VStack gap="space-6">
			<Heading size="xlarge" level="2">
				Administrasjon
			</Heading>
			<BodyLong>Administrer brukere, seksjoner og systeminnstillinger.</BodyLong>

			<div className="admin-grid">
				<Link to="/admin/brukere" className="admin-card">
					<Heading size="small" level="3">
						Brukere og roller
					</Heading>
					<BodyLong size="small">Tildel og administrer roller for brukere.</BodyLong>
				</Link>
				<Link to="/admin/seksjoner" className="admin-card">
					<Heading size="small" level="3">
						Seksjoner
					</Heading>
					<BodyLong size="small">Administrer seksjoner, klynger og utviklingsteam.</BodyLong>
				</Link>
				<Link to="/nais-overvaking" className="admin-card">
					<Heading size="small" level="3">
						Nais-overvåking
					</Heading>
					<BodyLong size="small">Godkjenn eller ignorer oppdagede Nais-team.</BodyLong>
				</Link>
				<Link to="/admin/import" className="admin-card">
					<Heading size="small" level="3">
						Import
					</Heading>
					<BodyLong size="small">Last opp nye versjoner av kontrollrammeverket.</BodyLong>
				</Link>
				<Link to="/rapporter" className="admin-card">
					<Heading size="small" level="3">
						Rapporter
					</Heading>
					<BodyLong size="small">Generer og last ned compliance-rapporter.</BodyLong>
				</Link>
				<Link to="/admin/screening" className="admin-card">
					<Heading size="small" level="3">
						Innledende spørsmål
					</Heading>
					<BodyLong size="small">Definer ja/nei-spørsmål som automatisk kan styre compliance-status.</BodyLong>
				</Link>
				<Link to="/admin/link-suggestions" className="admin-card">
					<Heading size="small" level="3">
						Koblingsforslag
					</Heading>
					<BodyLong size="small">
						Se og godkjenn foreslåtte koblinger mellom prod- og test-varianter av applikasjoner.
					</BodyLong>
				</Link>
				<Link to="/admin/domener" className="admin-card">
					<Heading size="small" level="3">
						Domener
					</Heading>
					<BodyLong size="small">Administrer domener for risikoer og kontroller i kontrollrammeverket.</BodyLong>
				</Link>
				<Link to="/admin/teknologielementer" className="admin-card">
					<Heading size="small" level="3">
						Teknologielementer
					</Heading>
					<BodyLong size="small">Administrer teknologielementer som brukes i kontroller og applikasjoner.</BodyLong>
				</Link>
				<Link to="/dokumenter" className="admin-card">
					<Heading size="small" level="3">
						Dokumenter
					</Heading>
					<BodyLong size="small">Last opp dokumenter som kan lenkes til fra compliance-vurderinger.</BodyLong>
				</Link>
			</div>
		</VStack>
	)
}
