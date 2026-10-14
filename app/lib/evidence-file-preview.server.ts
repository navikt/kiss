import * as XLSX from "xlsx"

const MAX_PREVIEW_BYTES = 10 * 1024 * 1024
const MAX_PREVIEW_SHEETS = 10
const MAX_PREVIEW_ROWS = 5_000
const MAX_PREVIEW_COLUMNS = 50

export function createSpreadsheetPreviewHtml(buffer: Buffer, title: string): string {
	if (buffer.length > MAX_PREVIEW_BYTES) {
		throw new Response("Regnearket er for stort til å vises.", { status: 413 })
	}

	let workbook: XLSX.WorkBook
	try {
		const sheetNames = XLSX.read(buffer, { type: "buffer", bookSheets: true }).SheetNames
		workbook = XLSX.read(buffer, {
			type: "buffer",
			cellDates: true,
			sheetRows: MAX_PREVIEW_ROWS + 1,
			sheets: Array.from({ length: Math.min(sheetNames.length, MAX_PREVIEW_SHEETS) }, (_, index) => index),
		})
		workbook.SheetNames = sheetNames
	} catch {
		throw new Response("Regnearket kunne ikke vises.", { status: 422 })
	}

	let truncated = workbook.SheetNames.length > MAX_PREVIEW_SHEETS
	const sheets = workbook.SheetNames.slice(0, MAX_PREVIEW_SHEETS)
		.map((sheetName) => {
			const worksheet = workbook.Sheets[sheetName]
			if (!worksheet) return ""
			let columnsClamped = false
			if (worksheet["!ref"]) {
				const range = XLSX.utils.decode_range(worksheet["!ref"])
				if (range.e.c - range.s.c + 1 > MAX_PREVIEW_COLUMNS) {
					range.e.c = range.s.c + MAX_PREVIEW_COLUMNS - 1
					worksheet["!ref"] = XLSX.utils.encode_range(range)
					columnsClamped = true
				}
			}
			const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: "", raw: false })
			const columnCount = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0)
			if (rows.length > MAX_PREVIEW_ROWS || columnsClamped) truncated = true
			const body = rows
				.slice(0, MAX_PREVIEW_ROWS)
				.map(
					(row, rowIndex) =>
						`<tr>${Array.from({ length: columnCount }, (_, columnIndex) => {
							const cell = escapeHtml(String(row[columnIndex] ?? ""))
							return rowIndex === 0 ? `<th scope="col">${cell}</th>` : `<td>${cell}</td>`
						}).join("")}</tr>`,
				)
				.join("")

			return `<section><h2>${escapeHtml(sheetName)}</h2><div class="table-scroll"><table><tbody>${body}</tbody></table></div></section>`
		})
		.filter(Boolean)
		.join("")

	return `<!doctype html>
<html lang="no">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>${escapeHtml(title)}</title>
	<style>
		:root { color-scheme: light; font-family: system-ui, sans-serif; color: #23262a; background: #f7f7f7; }
		body { margin: 0; }
		main { max-width: 90rem; margin: 0 auto; padding: 2rem; }
		h1 { font-size: 1.5rem; }
		h2 { font-size: 1.125rem; margin-top: 2rem; }
		.table-scroll { max-height: 75vh; overflow: auto; background: white; border: 1px solid #c6c2bf; }
		table { border-collapse: collapse; min-width: 100%; }
		th, td { border-bottom: 1px solid #e6e4e2; border-right: 1px solid #e6e4e2; padding: .5rem .75rem; text-align: left; white-space: pre-wrap; }
		th { position: sticky; top: 0; background: #f1f1f1; }
		@media (max-width: 40rem) { main { padding: 1rem; } }
	</style>
</head>
<body>
	<main>
		<h1>${escapeHtml(title)}</h1>
		<p>Skrivebeskyttet visning av regnearket.${truncated ? " Visningen er avkortet. Last ned filen for å se alt." : ""}</p>
		${sheets || "<p>Regnearket har ingen synlige ark.</p>"}
	</main>
</body>
</html>`
}

export function createInlinePdfResponse(file: { buffer: Buffer; contentType: string; fileName: string }): Response {
	if (!isPdf(file.contentType, file.fileName)) {
		throw new Response("Filen er ikke en PDF.", { status: 415 })
	}

	return new Response(new Uint8Array(file.buffer), {
		headers: {
			"Content-Type": "application/pdf",
			"Content-Disposition": `inline; ${contentDispositionFilename(file.fileName)}`,
			"Content-Length": file.buffer.length.toString(),
			"Cache-Control": "private, no-store",
			"X-Content-Type-Options": "nosniff",
		},
	})
}

export function createSpreadsheetPreviewResponse(file: {
	buffer: Buffer
	contentType: string
	fileName: string
}): Response {
	if (!isSpreadsheet(file.contentType, file.fileName)) {
		throw new Response("Filen er ikke et regneark.", { status: 415 })
	}

	return new Response(createSpreadsheetPreviewHtml(file.buffer, file.fileName), {
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "private, no-store",
			"Content-Security-Policy":
				"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
			"X-Content-Type-Options": "nosniff",
		},
	})
}

export function isPdf(contentType: string, fileName: string): boolean {
	return contentType === "application/pdf" || /\.pdf$/i.test(fileName)
}

export function isSpreadsheet(contentType: string, fileName: string): boolean {
	return (
		contentType.includes("spreadsheet") || contentType === "application/vnd.ms-excel" || /\.(xlsx|xls)$/i.test(fileName)
	)
}

function contentDispositionFilename(fileName: string): string {
	const safeAsciiName = fileName.replace(/[^\x20-\x7E]|["\\]/g, "_")
	return `filename="${safeAsciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => {
		switch (character) {
			case "&":
				return "&amp;"
			case "<":
				return "&lt;"
			case ">":
				return "&gt;"
			case '"':
				return "&quot;"
			case "'":
				return "&#39;"
			default:
				return character
		}
	})
}
