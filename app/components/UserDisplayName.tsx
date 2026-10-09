import { formatUserDisplayName } from "~/lib/utils"

export function UserDisplayName({ navIdent, name }: { navIdent: string; name: string | null | undefined }) {
	return <>{formatUserDisplayName(navIdent, name)}</>
}
