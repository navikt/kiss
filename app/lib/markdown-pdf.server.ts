import { marked, type Token, type Tokens } from "marked"

interface PdfStyle {
	fontSize: number
	bold: boolean
	italic: boolean
	color: string
	indent: number
}

const defaultStyle: PdfStyle = {
	fontSize: 9,
	bold: false,
	italic: false,
	color: "#222222",
	indent: 0,
}

/**
 * Render markdown text into a pdfkit document with basic formatting.
 * Supports headings, bold, italic, lists, blockquotes, code blocks, and paragraphs.
 */
// biome-ignore lint/suspicious/noExplicitAny: pdfkit doc type
export function renderMarkdownToPdf(doc: any, markdown: string, options?: { width?: number }) {
	const width = options?.width ?? 495
	const tokens = marked.lexer(markdown)
	renderTokens(doc, tokens, { ...defaultStyle }, width)
}

// biome-ignore lint/suspicious/noExplicitAny: pdfkit doc type
function renderTokens(doc: any, tokens: Token[], style: PdfStyle, width: number) {
	for (const token of tokens) {
		renderToken(doc, token, style, width)
	}
}

// biome-ignore lint/suspicious/noExplicitAny: pdfkit doc type
function renderToken(doc: any, token: Token, style: PdfStyle, width: number) {
	switch (token.type) {
		case "heading": {
			const t = token as Tokens.Heading
			const sizes: Record<number, number> = { 1: 14, 2: 12, 3: 11, 4: 10, 5: 9, 6: 9 }
			doc.moveDown(0.4)
			const text = extractPlainText(t.tokens ?? [])
			doc
				.fontSize(sizes[t.depth] ?? 10)
				.fillColor("#0067c5")
				.text(text, { width, continued: false })
			doc.moveDown(0.2)
			doc.fontSize(style.fontSize).fillColor(style.color)
			break
		}
		case "paragraph": {
			const t = token as Tokens.Paragraph
			renderInlineTokens(doc, t.tokens ?? [], style, width)
			doc.moveDown(0.4)
			break
		}
		case "list": {
			const t = token as Tokens.List
			for (let i = 0; i < t.items.length; i++) {
				const item = t.items[i]
				const bullet = t.ordered ? `${(Number(t.start) || 1) + i}. ` : "• "
				const itemWidth = width - style.indent - 12

				doc.fontSize(style.fontSize).fillColor(style.color)
				doc.text(bullet, 50 + style.indent, undefined, { continued: true, width: 12 })

				const text = extractPlainText(item.tokens ?? [])
				doc.text(text, { width: itemWidth, continued: false })
			}
			doc.moveDown(0.3)
			break
		}
		case "blockquote": {
			const t = token as Tokens.Blockquote
			const prevIndent = style.indent
			doc.moveDown(0.1)
			const x = 50 + style.indent + 8
			doc.save()
			doc.rect(50 + style.indent, doc.y, 3, 12).fill("#cccccc")
			doc.restore()
			doc
				.fillColor("#666666")
				.fontSize(style.fontSize)
				.text(extractPlainText(t.tokens ?? []), x, undefined, { width: width - style.indent - 12 })
			doc.fillColor(style.color)
			style.indent = prevIndent
			doc.moveDown(0.3)
			break
		}
		case "code": {
			const t = token as Tokens.Code
			doc.moveDown(0.2)
			doc
				.fontSize(8)
				.fillColor("#333333")
				.font("Courier")
				.text(t.text, 50 + style.indent + 4, undefined, { width: width - style.indent - 8 })
			doc.font("Helvetica").fontSize(style.fontSize).fillColor(style.color)
			doc.moveDown(0.3)
			break
		}
		case "hr": {
			doc.moveDown(0.3)
			const y = doc.y
			doc
				.save()
				.moveTo(50, y)
				.lineTo(50 + width, y)
				.strokeColor("#cccccc")
				.lineWidth(0.5)
				.stroke()
				.restore()
			doc.moveDown(0.3)
			break
		}
		case "space": {
			doc.moveDown(0.2)
			break
		}
		default:
			// For unknown tokens, try to extract text
			if ("text" in token && typeof token.text === "string") {
				doc.fontSize(style.fontSize).fillColor(style.color).text(token.text, { width })
			}
			break
	}
}

// biome-ignore lint/suspicious/noExplicitAny: pdfkit doc type
function renderInlineTokens(doc: any, tokens: Token[], style: PdfStyle, width: number) {
	const segments = flattenInlineTokens(tokens)

	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i]
		const isLast = i === segments.length - 1

		let font = "Helvetica"
		if (seg.bold && seg.italic) font = "Helvetica-BoldOblique"
		else if (seg.bold) font = "Helvetica-Bold"
		else if (seg.italic) font = "Helvetica-Oblique"
		else if (seg.code) font = "Courier"

		doc
			.font(font)
			.fontSize(seg.code ? 8 : style.fontSize)
			.fillColor(style.color)
			.text(seg.text, { width, continued: !isLast })
	}

	// Reset font
	doc.font("Helvetica").fontSize(style.fontSize)
}

interface InlineSegment {
	text: string
	bold: boolean
	italic: boolean
	code: boolean
}

function flattenInlineTokens(tokens: Token[], bold = false, italic = false): InlineSegment[] {
	const segments: InlineSegment[] = []

	for (const token of tokens) {
		switch (token.type) {
			case "text": {
				const t = token as Tokens.Text
				if (t.tokens) {
					segments.push(...flattenInlineTokens(t.tokens, bold, italic))
				} else {
					segments.push({ text: t.text, bold, italic, code: false })
				}
				break
			}
			case "strong": {
				const t = token as Tokens.Strong
				segments.push(...flattenInlineTokens(t.tokens ?? [], true, italic))
				break
			}
			case "em": {
				const t = token as Tokens.Em
				segments.push(...flattenInlineTokens(t.tokens ?? [], bold, true))
				break
			}
			case "codespan": {
				const t = token as Tokens.Codespan
				segments.push({ text: t.text, bold, italic, code: true })
				break
			}
			case "link": {
				const t = token as Tokens.Link
				const linkText = extractPlainText(t.tokens ?? []) || t.href
				segments.push({ text: `${linkText} (${t.href})`, bold, italic, code: false })
				break
			}
			case "br": {
				segments.push({ text: "\n", bold, italic, code: false })
				break
			}
			default: {
				if ("text" in token && typeof token.text === "string") {
					segments.push({ text: token.text, bold, italic, code: false })
				}
				break
			}
		}
	}

	return segments
}

function extractPlainText(tokens: Token[]): string {
	return tokens
		.map((t) => {
			if ("tokens" in t && Array.isArray(t.tokens)) {
				return extractPlainText(t.tokens)
			}
			if ("text" in t && typeof t.text === "string") {
				return t.text
			}
			return ""
		})
		.join("")
}
