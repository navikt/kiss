import { BodyLong, Heading, VStack } from "@navikt/ds-react"
import { Link } from "react-router"

export default function Admin() {
	return (
		<VStack gap="space-6">
			<Heading size="xlarge" level="2">
				Administrasjon
			</Heading>
			<BodyLong>Administrer brukere, seksjoner og systeminnstillinger.</BodyLong>

			<div className="admin-grid">
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
			</div>
		</VStack>
	)
}
