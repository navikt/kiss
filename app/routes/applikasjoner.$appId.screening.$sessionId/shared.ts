import type { useLoaderData } from "react-router"
import type { loader } from "./loader.server"

export { slugify } from "~/lib/utils"

export type LoaderData = ReturnType<typeof useLoaderData<typeof loader>>
export type ScreeningQuestion = LoaderData["screening"][number]
export type RulesetOption = LoaderData["rulesetOptions"][number]
export type PersistenceEntry = LoaderData["persistence"][number]
export type EntraGroupsData = LoaderData["entraGroupsData"]
export type EconomyClassificationData = LoaderData["economyClassification"]

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

/**
 * Checks if a screening question is considered answered.
 * For economy_system questions, an expired classification means "not answered"
 * even if the answer is "confirmed".
 */
export function isQuestionAnswered(q: ScreeningQuestion, economyClassification?: EconomyClassificationData): boolean {
	if (q.answerType === "persistence" || q.answerType === "entra_id_groups" || q.answerType === "economy_system") {
		if (q.answer !== "confirmed") return false
		if (q.answerType === "economy_system") {
			if (!economyClassification || economyClassification.isExpired) return false
		}
		return true
	}
	return q.answer !== null
}
