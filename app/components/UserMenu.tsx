import { ChevronDownIcon, MoonIcon, PersonIcon, ShieldLockIcon, SunIcon } from "@navikt/aksel-icons"
import { ActionMenu, BodyShort, Detail, InternalHeader, Tag } from "@navikt/ds-react"
import { useFetcher, useNavigate } from "react-router"
import { useTheme } from "~/hooks/useTheme"

interface UserSection {
	sectionName: string
	sectionSlug: string
	roleLabel: string
}

interface UserMenuProps {
	name: string
	navIdent: string
	isAdmin: boolean
	isAuditor: boolean
	isActualAdmin: boolean
	adminSuppressed: boolean
	sections: UserSection[]
}

export function UserMenu({
	name,
	navIdent,
	isAdmin,
	isAuditor,
	isActualAdmin,
	adminSuppressed,
	sections,
}: UserMenuProps) {
	const navigate = useNavigate()
	const { theme, setTheme } = useTheme()
	const fetcher = useFetcher()

	function toggleAdminMode() {
		fetcher.submit(
			{ intent: "toggleAdminMode", elevate: adminSuppressed ? "true" : "false" },
			{ method: "POST", action: "/" },
		)
	}

	return (
		<ActionMenu>
			<ActionMenu.Trigger>
				<InternalHeader.Button
					style={{
						paddingRight: "var(--ax-space-16)",
						paddingLeft: "var(--ax-space-16)",
						gap: "var(--ax-space-8)",
					}}
				>
					<BodyShort size="small">{name}</BodyShort>
					{isActualAdmin && adminSuppressed && (
						<Tag variant="alt3" size="xsmall">
							Vanlig bruker
						</Tag>
					)}
					<ChevronDownIcon title="Brukermeny" />
				</InternalHeader.Button>
			</ActionMenu.Trigger>

			<ActionMenu.Content align="end">
				{/* User name + NAV ident */}
				<ActionMenu.Label>
					<dl style={{ margin: 0 }}>
						<BodyShort as="dt" size="small" weight="semibold">
							{name}
						</BodyShort>
						<Detail as="dd" style={{ margin: 0 }}>
							{navIdent}
						</Detail>
					</dl>
				</ActionMenu.Label>

				{/* Min profil link */}
				<ActionMenu.Item
					onSelect={() => navigate("/profil")}
					icon={<PersonIcon aria-hidden style={{ fontSize: "1.5rem" }} />}
				>
					Min profil
				</ActionMenu.Item>

				<ActionMenu.Divider />

				{/* Admin mode toggle */}
				{isActualAdmin && (
					<>
						<ActionMenu.Group label="Admin-modus">
							<ActionMenu.Item
								onSelect={toggleAdminMode}
								icon={<ShieldLockIcon aria-hidden style={{ fontSize: "1.5rem" }} />}
							>
								{adminSuppressed ? "Aktiver admin-modus" : "Deaktiver admin-modus"}
							</ActionMenu.Item>
						</ActionMenu.Group>
						<ActionMenu.Divider />
					</>
				)}

				{/* Sections with role badges */}
				{sections.length > 0 && (
					<>
						<ActionMenu.Group label="Seksjoner">
							{sections.map((s) => (
								<ActionMenu.Item key={s.sectionSlug} onSelect={() => navigate(`/seksjoner/${s.sectionSlug}`)}>
									{s.sectionName}
									<Detail as="span" textColor="subtle" style={{ marginLeft: "var(--ax-space-8)" }}>
										{s.roleLabel}
									</Detail>
								</ActionMenu.Item>
							))}
						</ActionMenu.Group>
						<ActionMenu.Divider />
					</>
				)}

				{/* Global roles if no section roles */}
				{sections.length === 0 && (isAdmin || isAuditor) && (
					<>
						<ActionMenu.Group label="Roller">
							{isAdmin && <ActionMenu.Item onSelect={() => navigate("/admin")}>Admin</ActionMenu.Item>}
							{isAuditor && !isAdmin && <ActionMenu.Item onSelect={() => navigate("/admin")}>Revisor</ActionMenu.Item>}
						</ActionMenu.Group>
						<ActionMenu.Divider />
					</>
				)}

				{/* Theme toggle */}
				<ActionMenu.Group label="Tema">
					<ActionMenu.Item
						onSelect={() => setTheme("light")}
						disabled={theme === "light"}
						icon={<SunIcon aria-hidden style={{ fontSize: "1.5rem" }} />}
					>
						Lyst tema
					</ActionMenu.Item>
					<ActionMenu.Item
						onSelect={() => setTheme("dark")}
						disabled={theme === "dark"}
						icon={<MoonIcon aria-hidden style={{ fontSize: "1.5rem" }} />}
					>
						Mørkt tema
					</ActionMenu.Item>
				</ActionMenu.Group>
			</ActionMenu.Content>
		</ActionMenu>
	)
}
