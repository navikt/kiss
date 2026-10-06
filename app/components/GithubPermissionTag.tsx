import { Tag } from "@navikt/ds-react"
import { GITHUB_PERMISSION_TAG_VARIANTS } from "~/lib/github-user-access"

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
