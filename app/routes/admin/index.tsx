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
				<Link to="/admin/nais-overvaking" className="admin-card">
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
				<Link to="/admin/screening" className="admin-card">
					<Heading size="small" level="3">
						Innledende spørsmål
					</Heading>
					<BodyLong size="small">Definer ja/nei-spørsmål som automatisk kan styre compliance-status.</BodyLong>
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
				<Link to="/admin/dokumenter" className="admin-card">
					<Heading size="small" level="3">
						Dokumenter
					</Heading>
					<BodyLong size="small">Last opp dokumenter som kan lenkes til fra compliance-vurderinger.</BodyLong>
				</Link>
				<Link to="/admin/vedlikehold" className="admin-card">
					<Heading size="small" level="3">
						Vedlikehold
					</Heading>
					<BodyLong size="small">Synkronisering og vedlikeholdsoperasjoner for systemet.</BodyLong>
				</Link>
				<Link to="/admin/synkjobber" className="admin-card">
					<Heading size="small" level="3">
						Synkjobber
					</Heading>
					<BodyLong size="small">Se og filtrer alle synkroniseringsjobber fra NAIS og RPA.</BodyLong>
				</Link>
				<Link to="/admin/okonomisystemer" className="admin-card">
					<Heading size="small" level="3">
						Økonomisystemer
					</Heading>
					<BodyLong size="small">Oversikt over applikasjoner klassifisert som økonomisystem.</BodyLong>
				</Link>
				<Link to="/admin/rpa-grupper" className="admin-card">
					<Heading size="small" level="3">
						RPA-grupper
					</Heading>
					<BodyLong size="small">Konfigurer Entra ID-grupper som identifiserer RPA-brukere (roboter).</BodyLong>
				</Link>
				<Link to="/admin/audit-logg-volum" className="admin-card">
					<Heading size="small" level="3">
						Audit-logg volum
					</Heading>
					<BodyLong size="small">
						Analyser volumet av audit-logg-oppføringer for å identifisere unormal aktivitet.
					</BodyLong>
				</Link>
			</div>
		</VStack>
	)
}
