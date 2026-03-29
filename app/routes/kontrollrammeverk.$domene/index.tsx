import { Accordion, BodyLong, Heading, VStack } from "@navikt/ds-react"
import type { LoaderFunctionArgs } from "react-router"
import { data, Link, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { mockDomains } from "~/lib/mock-data.server"

export async function loader({ params }: LoaderFunctionArgs) {
	const domainCode = params.domene?.toUpperCase()
	const domain = domainCode ? mockDomains[domainCode] : undefined

	if (!domain) {
		throw new Response("Domene ikke funnet", { status: 404 })
	}

	return data({ domain })
}

export default function DomainDetail() {
	const { domain } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-6">
			<VStack gap="space-2">
				<Heading size="xlarge" level="2">
					{domain.name}
				</Heading>
				<BodyLong>
					Risikoer og kontroller for domenet {domain.name} ({domain.code}).
				</BodyLong>
			</VStack>

			<Accordion>
				{domain.risks.map((risk) => (
					<Accordion.Item key={risk.id}>
						<Accordion.Header>
							{risk.id}: {risk.name}
						</Accordion.Header>
						<Accordion.Content>
							<VStack gap="space-4">
								{risk.controls.map((control) => (
									<Link key={control.id} to={`/kontrollrammeverk/${domain.code}/${control.id}`} className="navds-link">
										{control.id}: {control.name}
									</Link>
								))}
							</VStack>
						</Accordion.Content>
					</Accordion.Item>
				))}
			</Accordion>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
