import { Tag } from "@navikt/ds-react"
import { GITHUB_PERMISSION_TAG_VARIANTS } from "~/lib/github-user-access"

/**
 * Fargekodet tag for et GitHub-tilgangsnivå (admin/maintain/push/write/triage/pull/read).
 * Delt mellom applikasjonens "GitHub-tilganger"-fane og `github_access_maintenance`-aktiviteten
 * i periodiske gjennomganger.
 */
export function GithubPermissionTag({
	permission,
	size = "xsmall",
}: {
	permission: string
	size?: "xsmall" | "small"
}) {
	return (
		<Tag variant={GITHUB_PERMISSION_TAG_VARIANTS[permission] ?? "neutral"} size={size}>
			{permission}
		</Tag>
	)
}
