import { Link as AkselLink } from "@navikt/ds-react"
import { Link } from "react-router"

/** Small hint text linking to the Markdown help page. */
export function MarkdownHint() {
	return (
		<AkselLink as={Link} to="/hjelp/markdown" target="_blank" style={{ fontSize: "var(--ax-font-size-small)" }}>
			Støtter Markdown-formatering
		</AkselLink>
	)
}
