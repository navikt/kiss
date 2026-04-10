import { ChevronRightIcon, HouseIcon } from "@navikt/aksel-icons"
import { Detail } from "@navikt/ds-react"
import { Link, useLocation, useMatches, useParams } from "react-router"
import { buildBreadcrumbs } from "~/lib/breadcrumbs"

export function Breadcrumbs() {
	const location = useLocation()
	const matches = useMatches()
	const params = useParams()

	if (location.pathname === "/") return null

	const leafMatch = matches[matches.length - 1]
	const loaderData = (leafMatch?.data as Record<string, unknown>) ?? {}
	const crumbs = buildBreadcrumbs(location.pathname, loaderData, params)

	if (crumbs.length === 0) return null

	return (
		<nav aria-label="Brødsmulesti" className="breadcrumbs">
			<ol className="breadcrumbs-list">
				<li className="breadcrumbs-item">
					<Link to="/" className="breadcrumbs-link" aria-label="Hjem">
						<HouseIcon aria-hidden fontSize="1rem" />
					</Link>
				</li>
				{crumbs.map((crumb, _i) => (
					<li key={crumb.label} className="breadcrumbs-item">
						<ChevronRightIcon aria-hidden fontSize="1rem" className="breadcrumbs-separator" />
						{crumb.to ? (
							<Link to={crumb.to} className="breadcrumbs-link">
								<Detail as="span">{crumb.label}</Detail>
							</Link>
						) : (
							<Detail as="span" aria-current="page" className="breadcrumbs-current">
								{crumb.label}
							</Detail>
						)}
					</li>
				))}
			</ol>
		</nav>
	)
}
