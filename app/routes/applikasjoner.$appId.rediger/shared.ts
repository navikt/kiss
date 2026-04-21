export type AppElement = {
	id: string
	name: string
	slug: string
	source: string
	linkId: string
	confirmedAt: Date | string | null
	confirmedBy: string | null
	rejectedAt: Date | string | null
	rejectedBy: string | null
	rejectionReason: string | null
}

export function statusVariant(status: string): "success" | "warning" | "error" {
	if (status === "OK") return "success"
	if (status === "PARTIAL") return "warning"
	return "error"
}
