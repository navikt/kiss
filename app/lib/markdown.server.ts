import DOMPurify from "isomorphic-dompurify"
import { marked } from "marked"

/** Parse Markdown to sanitized HTML. Safe for use with dangerouslySetInnerHTML. */
export function renderMarkdown(markdown: string | null | undefined): string {
	if (!markdown?.trim()) return ""
	const raw = marked.parse(markdown, { async: false }) as string
	return DOMPurify.sanitize(raw, {
		ALLOWED_TAGS: [
			"p",
			"br",
			"strong",
			"b",
			"em",
			"i",
			"ul",
			"ol",
			"li",
			"a",
			"code",
			"pre",
			"h1",
			"h2",
			"h3",
			"h4",
			"h5",
			"h6",
			"blockquote",
		],
		ALLOWED_ATTR: ["href", "target", "rel"],
	})
}
