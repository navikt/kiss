import type { useLoaderData } from "react-router"
import type { loader } from "./loader.server"

export type LoaderData = ReturnType<typeof useLoaderData<typeof loader>>
export type ScreeningQuestion = LoaderData["screening"][number]
export type RulesetOption = LoaderData["rulesetOptions"][number]
export type PersistenceEntry = LoaderData["persistence"][number]
export type EntraGroupsData = LoaderData["entraGroupsData"]

export function slugify(text: string) {
	return text
		.toLowerCase()
		.replace(/[æ]/g, "ae")
		.replace(/[ø]/g, "oe")
		.replace(/[å]/g, "aa")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "")
}

export const persistenceVariants: Record<string, "info" | "warning" | "alt1" | "alt2" | "alt3" | "neutral"> = {
	cloud_sql_postgres: "info",
	nais_postgres: "info",
	on_prem_postgres: "warning",
	opensearch: "alt1",
	bucket: "alt2",
	valkey: "alt3",
	oracle: "warning",
	other: "neutral",
}
