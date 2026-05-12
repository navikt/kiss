/**
 * Evidence provider factory.
 *
 * Returns the correct EvidenceProvider implementation based on provider type.
 * New providers are registered here.
 */

import { EVIDENCE_PROVIDER_TYPES, type EvidenceProviderType } from "~/db/schema/routines"
import type { EvidenceProvider } from "./types"

let providers: Map<EvidenceProviderType, EvidenceProvider> | null = null

async function loadProviders(): Promise<Map<EvidenceProviderType, EvidenceProvider>> {
	if (providers) return providers
	const [{ OracleEvidenceProvider }, { NdaEvidenceProvider }] = await Promise.all([
		import("./oracle.server"),
		import("./nda.server"),
	])
	providers = new Map<EvidenceProviderType, EvidenceProvider>([
		["oracle", new OracleEvidenceProvider()],
		["deployments", new NdaEvidenceProvider()],
	])
	return providers
}

/**
 * Get an evidence provider by type.
 *
 * @throws Error if the provider type is not registered
 */
export async function getEvidenceProvider(type: EvidenceProviderType): Promise<EvidenceProvider> {
	const map = await loadProviders()
	const provider = map.get(type)
	if (!provider) {
		throw new Error(`Unknown evidence provider type: ${type}`)
	}
	return provider
}

/** Check if a provider type is registered */
export function isEvidenceProviderType(type: string): type is EvidenceProviderType {
	return (EVIDENCE_PROVIDER_TYPES as readonly string[]).includes(type)
}

/** Get all registered provider types */
export async function getRegisteredProviderTypes(): Promise<EvidenceProviderType[]> {
	const map = await loadProviders()
	return [...map.keys()]
}
