import { BodyLong, Box, Detail, Heading, HStack, InternalHeader, Page, Spacer, Theme, VStack } from "@navikt/ds-react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import {
	data,
	isRouteErrorResponse,
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
	useLoaderData,
	useRouteError,
	useRouteLoaderData,
} from "react-router"
import { AppNavigation } from "./components/AppNavigation"
import { Breadcrumbs } from "./components/Breadcrumbs"
import { SearchDialog } from "./components/SearchDialog"
import { UserMenu } from "./components/UserMenu"
import { getUserRoles } from "./db/queries/users.server"
import { userRoleLabels } from "./db/schema/organization"
import { ThemeProvider, useTheme } from "./hooks/useTheme"
import { ADMIN_ELEVATED_COOKIE, getAuthenticatedUser } from "./lib/auth.server"
import { isAdmin, isAuditor } from "./lib/authorization.server"
import { getFeatureFlags } from "./lib/feature-flags.server"

import "@navikt/ds-css/dist/index.css"
import "./styles/global.css"

import type { LinksFunction } from "react-router"

export const links: LinksFunction = () => [{ rel: "icon", href: "/favicon.ico" }]

function getTheme(request: Request): "light" | "dark" {
	const cookieHeader = request.headers.get("Cookie") ?? ""
	const match = cookieHeader.match(/kiss-theme=(light|dark)/)
	return (match?.[1] as "light" | "dark") ?? "light"
}

export async function loader({ request }: LoaderFunctionArgs) {
	const theme = getTheme(request)
	const user = await getAuthenticatedUser(request)

	let userSections: { sectionName: string; sectionSlug: string; roleLabel: string }[] = []
	let userTeams: { teamName: string; teamSlug: string; sectionSlug: string }[] = []
	if (user) {
		try {
			const fullRoles = await getUserRoles(user.navIdent)
			const sectionMap = new Map<string, { sectionName: string; sectionSlug: string; roleLabel: string }>()
			const teamMap = new Map<string, { teamName: string; teamSlug: string; sectionSlug: string }>()
			for (const r of fullRoles) {
				if (r.sectionId && r.sectionName && r.sectionSlug) {
					if (!sectionMap.has(r.sectionId)) {
						sectionMap.set(r.sectionId, {
							sectionName: r.sectionName,
							sectionSlug: r.sectionSlug,
							roleLabel: userRoleLabels[r.role] ?? r.role,
						})
					}
				}
				if (r.devTeamId && r.devTeamName && r.devTeamSlug && r.sectionSlug) {
					if (!teamMap.has(r.devTeamId)) {
						teamMap.set(r.devTeamId, {
							teamName: r.devTeamName,
							teamSlug: r.devTeamSlug,
							sectionSlug: r.sectionSlug,
						})
					}
				}
			}
			userSections = [...sectionMap.values()]
			userTeams = [...teamMap.values()]
		} catch {
			// DB unavailable during startup
		}
	}

	return data({
		theme,
		featureFlags: getFeatureFlags(),
		user: user
			? {
					navIdent: user.navIdent,
					name: user.name,
					email: user.email,
					isAdmin: isAdmin(user),
					isAuditor: isAuditor(user),
					isActualAdmin: user.isActualAdmin,
					adminSuppressed: user.adminSuppressed,
					sections: userSections,
					teams: userTeams,
				}
			: null,
	})
}

export async function action({ request }: ActionFunctionArgs) {
	const formData = await request.formData()
	const intent = formData.get("intent")

	if (intent === "toggleAdminMode") {
		const user = await getAuthenticatedUser(request)
		if (!user?.isActualAdmin) {
			return data({ ok: false }, { status: 403 })
		}
		const elevate = formData.get("elevate") === "true"
		const secure = process.env.NODE_ENV === "production" ? "; Secure" : ""
		const cookieValue = elevate
			? `${ADMIN_ELEVATED_COOKIE}=true; SameSite=Lax; Path=/; Max-Age=28800; HttpOnly${secure}`
			: `${ADMIN_ELEVATED_COOKIE}=; SameSite=Lax; Path=/; Max-Age=0; HttpOnly${secure}`
		return data({ ok: true }, { headers: { "Set-Cookie": cookieValue } })
	}

	const theme = formData.get("theme") === "dark" ? "dark" : "light"
	return data(
		{ theme },
		{
			headers: {
				"Set-Cookie": `kiss-theme=${theme}; SameSite=Lax; Path=/; Max-Age=31536000; HttpOnly`,
			},
		},
	)
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
		<ThemeProvider initialTheme={theme}>
			<AppShell user={user} />
		</ThemeProvider>
	)
}

function AppShell({
	user,
}: {
	user: {
		navIdent: string
		name: string
		isAdmin: boolean
		isAuditor: boolean
		isActualAdmin: boolean
		adminSuppressed: boolean
		sections: { sectionName: string; sectionSlug: string; roleLabel: string }[]
		teams: { teamName: string; teamSlug: string; sectionSlug: string }[]
	} | null
}) {
	const { theme } = useTheme()

	return (
		<Theme theme={theme} className="app-container" hasBackground>
			<a href="#main-content" className="skip-link">
				Hopp til hovedinnhold
			</a>
			<InternalHeader>
				<InternalHeader.Title as="a" href="/">
					KISS
				</InternalHeader.Title>
				<HStack align="center" style={{ alignSelf: "center", paddingInline: "var(--ax-space-20)" }}>
					<SearchDialog />
				</HStack>
				<Spacer />
				<Detail textColor="subtle" style={{ alignSelf: "center", marginRight: "var(--ax-space-4)" }}>
					{__BUILD_VERSION__}
				</Detail>
				{user && (
					<UserMenu
						name={user.name}
						navIdent={user.navIdent}
						isAdmin={user.isAdmin}
						isAuditor={user.isAuditor}
						isActualAdmin={user.isActualAdmin}
						adminSuppressed={user.adminSuppressed}
						sections={user.sections}
					/>
				)}
			</InternalHeader>
			<AppNavigation isAdmin={user?.isAdmin ?? false} sections={user?.sections ?? []} teams={user?.teams ?? []} />
			<main id="main-content" className="app-main">
				<Page.Block width="2xl" gutters>
					<Breadcrumbs />
					<Outlet />
				</Page.Block>
			</main>
		</Theme>
	)
}

export function ErrorBoundary() {
	const error = useRouteError()
	const rootData = useRouteLoaderData<typeof loader>("root")
	const admin = rootData?.user?.isAdmin === true
	const showDetails = admin || import.meta.env.DEV

	const message =
		error instanceof Error
			? error.message
			: typeof error === "object" && error !== null && "message" in error
				? String((error as { message: unknown }).message)
				: "Ukjent feil"
	const stack =
		error instanceof Error
			? error.stack
			: typeof error === "object" && error !== null && "stack" in error
				? String((error as { stack: unknown }).stack)
				: undefined

	if (isRouteErrorResponse(error)) {
		return (
			<Box as="main" padding="space-24">
				<VStack gap="space-6">
					<Heading size="xlarge" level="1">
						{error.status} {error.statusText}
					</Heading>
					{error.data && (
						<BodyLong>
							{typeof error.data === "string"
								? error.data
								: typeof error.data === "object" && error.data !== null && "message" in error.data
									? String((error.data as { message: unknown }).message)
									: "En uventet feil oppsto"}
						</BodyLong>
					)}
					{showDetails && error.data && typeof error.data === "object" && (
						<Detail as="pre" style={{ whiteSpace: "pre-wrap", overflowX: "auto" }}>
							{JSON.stringify(error.data, null, 2)}
						</Detail>
					)}
					{showDetails && stack && (
						<Detail as="pre" style={{ whiteSpace: "pre-wrap", overflowX: "auto" }}>
							{stack}
						</Detail>
					)}
				</VStack>
			</Box>
		)
	}

	return (
		<Box as="main" padding="space-24">
			<VStack gap="space-6">
				<Heading size="xlarge" level="1">
					Noe gikk galt
				</Heading>
				<BodyLong>{message}</BodyLong>
				{showDetails && stack && (
					<Detail as="pre" style={{ whiteSpace: "pre-wrap", overflowX: "auto" }}>
						{stack}
					</Detail>
				)}
				{showDetails && !stack && error != null ? (
					<Detail as="pre" style={{ whiteSpace: "pre-wrap", overflowX: "auto" }}>
						{typeof error === "object" ? JSON.stringify(error, null, 2) : String(error)}
					</Detail>
				) : null}
			</VStack>
		</Box>
	)
}
