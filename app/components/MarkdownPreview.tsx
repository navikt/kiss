import { useEffect, useState } from "react"

async function renderPreview(content: string, setHtml: (html: string) => void) {
	const { marked } = await import("marked")
	setHtml(marked.parse(content, { async: false }) as string)
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
			}}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: client-side preview only
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	)
}
