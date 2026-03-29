import type { LinksFunction, LoaderFunctionArgs } from "react-router"
import {
	data,
	isRouteErrorResponse,
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
	useLoaderData,
} from "react-router"
import { AppNavigation } from "./components/AppNavigation"

import "@navikt/ds-css/dist/index.css"
import "./styles/global.css"

export const links: LinksFunction = () => [{ rel: "icon", href: "/favicon.ico" }]

function getTheme(request: Request): "light" | "dark" {
	const cookieHeader = request.headers.get("Cookie") ?? ""
	const match = cookieHeader.match(/kiss-theme=(light|dark)/)
	return (match?.[1] as "light" | "dark") ?? "light"
}

export async function loader({ request }: LoaderFunctionArgs) {
	const theme = getTheme(request)
	return data({ theme })
}

export function Layout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="nb">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<Meta />
				<Links />
			</head>
			<body>
				{children}
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	)
}

export default function App() {
	const { theme } = useLoaderData<typeof loader>()

	return (
		<div data-theme={theme} className="app-container">
			<a href="#main-content" className="skip-link">
				Hopp til hovedinnhold
			</a>
			<header className="app-header">
				<div className="app-header-content">
					<h1 className="app-header-title">KISS</h1>
					<span className="app-header-subtitle">Kontrollrammeverk for Integrert Sikker Systemutvikling</span>
				</div>
			</header>
			<AppNavigation />
			<main id="main-content" className="app-main">
				<Outlet />
			</main>
		</div>
	)
}

export function ErrorBoundary({ error }: { error: unknown }) {
	if (isRouteErrorResponse(error)) {
		return (
			<main style={{ padding: "2rem" }}>
				<h1>
					{error.status} {error.statusText}
				</h1>
				{error.data && <p>{error.data}</p>}
			</main>
		)
	}

	const message = error instanceof Error ? error.message : "Ukjent feil"

	return (
		<main style={{ padding: "2rem" }}>
			<h1>Noe gikk galt</h1>
			<p>{message}</p>
		</main>
	)
}
