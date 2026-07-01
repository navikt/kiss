import { BodyLong, Box, Heading, Table, VStack } from "@navikt/ds-react"
import { data, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { renderMarkdown } from "~/lib/markdown.server"
import type { Route } from "./+types/index"

const examples = [
	{ markdown: "**Fet tekst**", description: "Fet skrift" },
	{ markdown: "*Kursiv tekst*", description: "Kursiv" },
	{ markdown: "- Punkt 1\n- Punkt 2\n- Punkt 3", description: "Kulepunktliste" },
	{ markdown: "1. Første\n2. Andre\n3. Tredje", description: "Nummerert liste" },
	{
		markdown: "[Nav.no](https://nav.no)",
		description: "Lenke",
	},
	{ markdown: "# Overskrift 1", description: "Stor overskrift" },
	{ markdown: "## Overskrift 2", description: "Mellomstor overskrift" },
	{ markdown: "### Overskrift 3", description: "Liten overskrift" },
	{ markdown: "`kode`", description: "Inline kode" },
	{
		markdown: "```\nconst x = 42\n```",
		description: "Kodeblokk",
	},
	{ markdown: "> Et sitat", description: "Blokkitat" },
]

export async function loader(_args: Route.LoaderArgs) {
	const rendered = examples.map((e) => ({
		...e,
		html: renderMarkdown(e.markdown),
	}))
	return data({ examples: rendered })
}

export default function MarkdownHelp() {
	const { examples } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-8" style={{ maxWidth: "56rem" }}>
			<div>
				<Heading size="xlarge" level="2">
					Markdown-formatering
				</Heading>
				<BodyLong>
					Flere tekstfelter i KISS støtter Markdown-formatering. Nedenfor finner du en oversikt over hva som støttes med
					eksempler.
				</BodyLong>
			</div>

			<Table size="small">
				<Table.Header>
					<Table.Row>
						<Table.HeaderCell scope="col" style={{ width: "30%" }}>
							Beskrivelse
						</Table.HeaderCell>
						<Table.HeaderCell scope="col" style={{ width: "35%" }}>
							Markdown
						</Table.HeaderCell>
						<Table.HeaderCell scope="col" style={{ width: "35%" }}>
							Resultat
						</Table.HeaderCell>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{examples.map((e) => (
						<Table.Row key={e.markdown}>
							<Table.DataCell>{e.description}</Table.DataCell>
							<Table.DataCell>
								<Box
									as="pre"
									style={{
										margin: 0,
										whiteSpace: "pre-wrap",
										fontFamily: "monospace",
										fontSize: "var(--ax-font-size-small)",
									}}
								>
									{e.markdown}
								</Box>
							</Table.DataCell>
							<Table.DataCell>
								{/* biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized server-side */}
								<div className="markdown-content" dangerouslySetInnerHTML={{ __html: e.html }} />
							</Table.DataCell>
						</Table.Row>
					))}
				</Table.Body>
			</Table>

			<VStack gap="space-4">
				<Heading size="small" level="3">
					Tips
				</Heading>
				<ul style={{ paddingLeft: "1.5rem", margin: 0 }}>
					<li>
						<BodyLong size="small">Bruk en tom linje mellom avsnitt for å lage linjeskift.</BodyLong>
					</li>
					<li>
						<BodyLong size="small">
							Kombinasjoner fungerer: <code>**fet *og kursiv***</code> gir{" "}
							<strong>
								<em>fet og kursiv</em>
							</strong>
						</BodyLong>
					</li>
					<li>
						<BodyLong size="small">Bilder, tabeller og HTML-tagger er ikke støttet.</BodyLong>
					</li>
				</ul>
			</VStack>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
