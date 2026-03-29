import { index, type RouteConfig, route } from "@react-router/dev/routes"

export default [
	index("routes/_index/index.tsx"),
	route("kontrollrammeverk", "routes/kontrollrammeverk/index.tsx"),
	route("kontrollrammeverk/:domene", "routes/kontrollrammeverk.$domene/index.tsx"),
	route("kontrollrammeverk/:domene/:kontrollId", "routes/kontrollrammeverk.$domene.$kontrollId/index.tsx"),
	route("import", "routes/import/index.tsx"),
	route("seksjoner", "routes/seksjoner/index.tsx"),
	route("seksjoner/:seksjon", "routes/seksjoner.$seksjon/index.tsx"),
	route("seksjoner/:seksjon/team/:team", "routes/seksjoner.$seksjon.team.$team/index.tsx"),
	route("applikasjoner", "routes/applikasjoner/index.tsx"),
	route("applikasjoner/:appId/compliance", "routes/applikasjoner.$appId.compliance/index.tsx"),
	route("rapporter", "routes/rapporter/index.tsx"),
	route("rapporter/generer", "routes/rapporter.generer/index.tsx"),
	route("rapporter/:rapportId", "routes/rapporter.$rapportId/index.tsx"),
	route("nais-overvaking", "routes/nais-overvaking/index.tsx"),
	route("admin", "routes/admin/index.tsx"),
	route("api/isalive", "routes/api.isalive/index.tsx"),
	route("api/isready", "routes/api.isready/index.tsx"),
] satisfies RouteConfig
