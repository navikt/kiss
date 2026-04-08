import { BodyLong, Box, Detail, Heading, InternalHeader, Spacer, Theme, VStack } from "@navikt/ds-react"
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
	useRouteLoaderData,
} from "react-router"
import { AppNavigation } from "./components/AppNavigation"
import { SearchDialog } from "./components/SearchDialog"
import { ThemeToggle } from "./components/ThemeToggle"
import { getAuthenticatedUser } from "./lib/auth.server"
import { isAdmin, isAuditor } from "./lib/authorization.server"

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
	const user = await getAuthenticatedUser(request)

	return data({
		theme,
		user: user
			? {
					navIdent: user.navIdent,
					name: user.name,
					email: user.email,
					isAdmin: isAdmin(user),
					isAuditor: isAuditor(user),
				}
			: null,
	})
}

export function Layout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="nb">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>KISS – Kontrollrammeverk for Integrert Sikker Systemutvikling</title>
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
	const { theme, user } = useLoaderData<typeof loader>()

	return (
		<Theme theme={theme} className="app-container" hasBackground>
			<a href="#main-content" className="skip-link">
				Hopp til hovedinnhold
			</a>
			<InternalHeader>
				<InternalHeader.Title as="a" href="/">
					KISS
				</InternalHeader.Title>
				<SearchDialog />
				<Spacer />
				<Detail textColor="subtle" style={{ alignSelf: "center", marginRight: "var(--ax-space-4)" }}>
					{__BUILD_VERSION__}
				</Detail>
				<ThemeToggle />
				{user && (
					<InternalHeader.User
						name={user.name}
						description={`${user.navIdent}${user.isAdmin ? " · Admin" : user.isAuditor ? " · Revisor" : ""}`}
					/>
				)}
			</InternalHeader>
			<AppNavigation />
			<main id="main-content" className="app-main">
				<Outlet />
			</main>
		</Theme>
	)
}

export function ErrorBoundary({ error }: { error: unknown }) {
	const rootData = useRouteLoaderData<typeof loader>("root")
	const admin = rootData?.user?.isAdmin === true

	if (isRouteErrorResponse(error)) {
		return (
			<Box as="main" padding="space-24">
				<VStack gap="space-6">
					<Heading size="xlarge" level="1">
						{error.status} {error.statusText}
					</Heading>
					{error.data && <BodyLong>{error.data}</BodyLong>}
				</VStack>
			</Box>
		)
	}

	const message = error instanceof Error ? error.message : "Ukjent feil"
	const stack = error instanceof Error ? error.stack : undefined

	return (
		<Box as="main" padding="space-24">
			<VStack gap="space-6">
				<Heading size="xlarge" level="1">
					Noe gikk galt
				</Heading>
				<BodyLong>{message}</BodyLong>
				{admin && stack && (
					<Detail as="pre" style={{ whiteSpace: "pre-wrap", overflowX: "auto" }}>
						{stack}
					</Detail>
				)}
			</VStack>
		</Box>
	)
}
