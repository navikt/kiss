import { index, type RouteConfig, route } from "@react-router/dev/routes"

export default [
	index("routes/_index/index.tsx"),
	route("api/isalive", "routes/api.isalive/index.tsx"),
	route("api/isready", "routes/api.isready/index.tsx"),
] satisfies RouteConfig
