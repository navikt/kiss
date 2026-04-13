import type { OracleInstance } from "./oracle-revisjon.server"

const ADMIN_GROUP_IDS = (process.env.KISS_ADMIN_GROUP_IDS ?? "").split(",").filter(Boolean)

/** Check if a user can see a specific Oracle instance based on group membership. */
export function canUserSeeInstance(instance: Pick<OracleInstance, "group">, userGroups: string[]): boolean {
	if (instance.group === null) return true
	if (ADMIN_GROUP_IDS.length > 0 && userGroups.some((g) => ADMIN_GROUP_IDS.includes(g))) return true
	return userGroups.includes(instance.group)
}

/** Filter a list of Oracle instances to only those the user has access to. */
export function filterInstancesByAccess<T extends Pick<OracleInstance, "group">>(
	instances: T[],
	userGroups: string[],
): T[] {
	return instances.filter((inst) => canUserSeeInstance(inst, userGroups))
}
