import { Link, useLocation } from "react-router"
import { ThemeToggle } from "./ThemeToggle"

interface NavItem {
	label: string
	href: string
}

const navItems: NavItem[] = [
	{ label: "Dashboard", href: "/" },
	{ label: "Kontrollrammeverk", href: "/kontrollrammeverk" },
	{ label: "Applikasjoner", href: "/applikasjoner" },
	{ label: "Seksjoner", href: "/seksjoner" },
	{ label: "Rapporter", href: "/rapporter" },
	{ label: "Import", href: "/import" },
	{ label: "Nais", href: "/nais-overvaking" },
	{ label: "Admin", href: "/admin" },
]

export function AppNavigation() {
	const location = useLocation()

	return (
		<nav className="app-nav" aria-label="Hovednavigasjon">
			<div className="app-nav-content">
				<ul className="app-nav-list">
					{navItems.map((item) => {
						const isActive =
							location.pathname === item.href || (item.href !== "/" && location.pathname.startsWith(item.href))
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
				<ThemeToggle />
			</div>
		</nav>
	)
}
