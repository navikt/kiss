import type { ApprovalStatus } from "~/db/queries/rulesets.server"

export const approvalStatusConfig: Record<
	ApprovalStatus,
	{ label: string; variant: "success" | "warning" | "error" | "neutral" }
> = {
	draft: { label: "Utkast", variant: "neutral" },
	valid: { label: "Gjeldende", variant: "success" },
	expiring_soon: { label: "Utløper snart", variant: "warning" },
	expired: { label: "Utløpt", variant: "error" },
}
