export function formatDate(dateStr: string) {
	return new Date(dateStr).toLocaleDateString("nb-NO", {
		day: "numeric",
		month: "long",
		year: "numeric",
	})
}

export function formatDateTime(dateStr: string) {
	const d = new Date(dateStr)
	return d.toLocaleDateString("nb-NO", {
		day: "numeric",
		month: "long",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	})
}

export function formatFileSize(bytes: number | null) {
	if (!bytes) return "—"
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
