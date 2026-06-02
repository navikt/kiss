import { Page } from "@navikt/ds-react"
import { useMemo } from "react"
import { Link, useLocation } from "react-router"

interface NavItem {
	label: string
	href: string
}

const baseNavItems: NavItem[] = [
	{ label: "Dashboard", href: "/dashboard" },
	{ label: "Kontrollrammeverk", href: "/kontrollrammeverk" },
	{ label: "Seksjoner", href: "/seksjoner" },
]

interface AppNavigationProps {
	isAdmin: boolean
	sections: { sectionName: string; sectionSlug: string }[]
	teams: { teamName: string; teamSlug: string; sectionSlug: string }[]
}

export function AppNavigation({ isAdmin, sections, teams }: AppNavigationProps) {
	const location = useLocation()

	const navItems = useMemo(() => {
		const items = [...baseNavItems]
		const seksjonerIdx = items.findIndex((i) => i.href === "/seksjoner")

		let insertAt = seksjonerIdx + 1

		if (sections.length === 1) {
			const s = sections[0]
			items.splice(insertAt, 0, { label: s.sectionName, href: `/seksjoner/${s.sectionSlug}` })
			insertAt++
		}

		if (teams.length === 1) {
			const t = teams[0]
			items.splice(insertAt, 0, {
				label: t.teamName,
				href: `/seksjoner/${t.sectionSlug}/team/${t.teamSlug}`,
			})
		} else if (teams.length > 1) {
			items.splice(insertAt, 0, { label: "Mine team", href: "/mine-team" })
		}

		if (isAdmin) {
			items.push({ label: "Admin", href: "/admin" })
		}

		return items
	}, [sections, teams, isAdmin])

	// Find the single most specific (longest href) match
	const activeHref = useMemo(() => {
		let best = ""
		for (const item of navItems) {
			const matches = location.pathname === item.href || (item.href !== "/" && location.pathname.startsWith(item.href))
			if (matches && item.href.length > best.length) {
				best = item.href
			}
		}
		return best
	}, [navItems, location.pathname])

	return (
		<nav className="app-nav" aria-label="Hovednavigasjon">
			<Page.Block width="2xl" gutters>
				<ul className="app-nav-list">
					{navItems.map((item) => {
						const isActive = item.href === activeHref
						return (
							<li key={item.href}>
								<Link
									to={item.href}
									className={`app-nav-link ${isActive ? "app-nav-link--active" : ""}`}
									aria-current={isActive ? "page" : undefined}
								>
									{item.label}
								</Link>
							</li>
						)
					})}
				</ul>
			</Page.Block>
		</nav>
	)
}
