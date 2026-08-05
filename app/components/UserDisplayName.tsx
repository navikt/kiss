export function UserDisplayName({ navIdent, name }: { navIdent: string; name: string | null | undefined }) {
	if (!name) return <>{navIdent}</>
	return (
		<>
			{name} ({navIdent})
		</>
	)
}
