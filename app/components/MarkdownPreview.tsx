import { useEffect, useState } from "react"

const ALLOWED_TAGS = [
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
]
const ALLOWED_ATTR = ["href", "target", "rel"]

async function renderPreview(content: string, setHtml: (html: string) => void) {
	const [{ marked }, { default: DOMPurify }] = await Promise.all([import("marked"), import("isomorphic-dompurify")])
	const raw = marked.parse(content, { async: false }) as string
	setHtml(DOMPurify.sanitize(raw, { ALLOWED_TAGS, ALLOWED_ATTR }))
}

export function MarkdownPreview({ content }: { content: string }) {
	const [html, setHtml] = useState("")

	useEffect(() => {
		void renderPreview(content, setHtml)
	}, [content])

	return (
		<div
			className="markdown-content"
			style={{
				padding: "var(--ax-space-8)",
				border: "1px solid var(--ax-border-subtle)",
				borderRadius: "var(--ax-radius-8)",
				background: "var(--ax-bg-sunken)",
				flex: 1,
				minHeight: "10rem",
				overflowY: "auto",
			}}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: client-side preview, sanitized via DOMPurify above
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	)
}
