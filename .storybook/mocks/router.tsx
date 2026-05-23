import type { Decorator } from "@storybook/react"
import type React from "react"
import { createRoutesStub } from "react-router"
import AppRoot from "../../app/root"
import { mockRootLoaderData } from "./data"

/**
 * Wraps stories in a React Router context with an empty route at "/".
 * Use for components that rely on router hooks (useNavigate, useLocation, etc.).
 */
export const withRouter: Decorator = (Story) => {
	const Stub = createRoutesStub([
		{
			path: "/",
			Component: Story,
		},
	])
	return <Stub initialEntries={["/"]} />
}

/**
 * Renders a route component inside createRoutesStub with mock loader data.
 * Use in `render` for route pages that consume `loaderData` from props.
 *
 * @example
 * ```tsx
 * export const Default: StoryObj = {
 *   render: () => renderWithLoader(MyPage, { items: [], count: 0 }),
 * }
 * ```
 */
// biome-ignore lint/suspicious/noExplicitAny: Route components have varying prop shapes from React Router
export function renderWithLoader<T>(Component: React.ComponentType<any>, loaderData: T, path = "/") {
	const routePath = path.split("?")[0]
	const Stub = createRoutesStub([
		{
			path: routePath,
			Component,
			loader: () => loaderData,
		},
	])
	return <Stub initialEntries={[path]} />
}

/**
 * Renders a page component nested inside a layout that mimics KISS's AppShell.
 * Provides InternalHeader, AppNavigation, and Breadcrumbs around the page content.
 * Produces a full-page view for documentation screenshots.
 *
 * @example
 * ```tsx
 * export const FullPage: StoryObj = {
 *   render: () => renderWithLayout(Dashboard, { items: [] }),
 * }
 * ```
 */
export function renderWithLayout<T>(
	// biome-ignore lint/suspicious/noExplicitAny: Route components have varying prop shapes from React Router
	Component: React.ComponentType<any>,
	loaderData: T,
	options?: {
		path?: string
		initialEntry?: string
		isAdmin?: boolean
		isAuditor?: boolean
		// biome-ignore lint/suspicious/noExplicitAny: Extra routes have varying shapes
		extraRoutes?: Array<{ path: string; action?: () => any; loader?: () => any }>
	},
) {
	const path = options?.path ?? "/"
	const rootData = mockRootLoaderData({
		isAdmin: options?.isAdmin ?? true,
		isAuditor: options?.isAuditor ?? false,
	})

	const extraChildren = (options?.extraRoutes ?? []).map((r) => ({
		...r,
		path: r.path.replace(/^\//, ""),
	}))

	const Stub = createRoutesStub([
		{
			path: "/",
			// biome-ignore lint/suspicious/noExplicitAny: Layout type is incompatible with createRoutesStub's expected component type
			Component: AppRoot as any,
			loader: () => rootData,
			children: [
				{
					path: path === "/" ? undefined : path.replace(/^\//, ""),
					index: path === "/",
					Component,
					loader: () => loaderData,
				},
				...extraChildren,
			],
		},
	])
	return <Stub initialEntries={[options?.initialEntry ?? path]} />
}
