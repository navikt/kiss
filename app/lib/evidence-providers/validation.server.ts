/**
 * Provider-specific validation helpers for evidence API routes.
 *
 * Each provider may have specific requirements for params and access control
 * that the generic evidence routes delegate to.
 */

import { data } from "react-router"
import { type ActivityContext, isInstanceConfiguredForApp } from "~/db/queries/evidence-downloads.server"
import { getEvidenceTypesForActivity, getProviderTypeForActivity } from "~/lib/activity-types"
import type { EvidenceProviderType } from "~/lib/evidence-providers/types"

/**
 * Extract provider-specific params from a URLSearchParams or FormData source.
 * Returns a Record<string, unknown> that can be passed to provider.getStatus() / provider.downloadFile().
 */
export function extractProviderParams(
	providerType: EvidenceProviderType,
	source: URLSearchParams | FormData,
): Record<string, unknown> {
	switch (providerType) {
		case "oracle":
			return {
				instanceId: getStringValue(source, "instanceId"),
				fromUtc: getStringValue(source, "fromUtc") || undefined,
				toUtc: getStringValue(source, "toUtc") || undefined,
			}
		case "deployments":
			return {
				team: getStringValue(source, "team"),
				environment: getStringValue(source, "environment"),
				appName: getStringValue(source, "appName"),
				periodType: getStringValue(source, "periodType"),
				periodStart: getStringValue(source, "periodStart"),
			}
		default: {
			const _exhaustive: never = providerType
			throw new Error(`Unknown provider type: ${_exhaustive}`)
		}
	}
}

/**
 * Validate provider-specific access and configuration.
 * Throws Response (via `data()`) if validation fails.
 */
export async function validateProviderAccess(
	providerType: EvidenceProviderType,
	params: Record<string, unknown>,
	ctx: ActivityContext,
): Promise<void> {
	switch (providerType) {
		case "oracle":
			await validateOracleAccess(params, ctx)
			break
		case "deployments":
			throw data({ error: "Deployments-provider er ikke implementert ennå" }, { status: 501 })
		default: {
			const _exhaustive: never = providerType
			throw new Error(`Unknown provider type: ${_exhaustive}`)
		}
	}
}

/**
 * Validate provider-specific evidence type constraints for download.
 * Throws Response (via `data()`) if the evidence type is not allowed for the activity.
 */
export function validateProviderEvidenceType(
	providerType: EvidenceProviderType,
	evidenceType: string,
	ctx: ActivityContext,
): void {
	const activityProvider = getProviderTypeForActivity(ctx.activityType)
	if (activityProvider === null) {
		throw data({ error: "Aktiviteten er ikke en bevistype" }, { status: 400 })
	}
	if (activityProvider !== providerType) {
		throw data(
			{ error: `Provider-type '${providerType}' matcher ikke aktivitetstypen '${ctx.activityType}'` },
			{ status: 400 },
		)
	}
	const allowed = getEvidenceTypesForActivity(ctx.activityType)
	if (!allowed || !allowed.includes(evidenceType)) {
		throw data({ error: `Bevistypen '${evidenceType}' er ikke tillatt for denne aktiviteten` }, { status: 400 })
	}
}

/**
 * Build provider-specific metadata for recording a download.
 */
export function buildProviderMetadata(
	providerType: EvidenceProviderType,
	params: Record<string, unknown>,
	extra: Record<string, unknown>,
): Record<string, unknown> {
	switch (providerType) {
		case "oracle":
			return {
				instanceId: params.instanceId,
				evidenceType: extra.evidenceType ?? null,
				apiInstanceName: extra.apiInstanceName ?? null,
				reviewProgressSnapshot: extra.reviewProgressSnapshot ?? null,
			}
		case "deployments":
			return {
				team: params.team,
				environment: params.environment,
				appName: params.appName,
				periodType: params.periodType,
				periodStart: params.periodStart,
				...extra,
			}
		default: {
			const _exhaustive: never = providerType
			throw new Error(`Unknown provider type: ${_exhaustive}`)
		}
	}
}

// ─── Oracle-specific validation ──────────────────────────────────────────

async function validateOracleAccess(params: Record<string, unknown>, ctx: ActivityContext): Promise<void> {
	const instanceId = params.instanceId
	if (typeof instanceId !== "string" || !instanceId) {
		throw data({ error: "instanceId er påkrevd" }, { status: 400 })
	}
	if (!ctx.applicationId) {
		throw data({ error: "Gjennomgangen mangler applikasjonstilknytning" }, { status: 400 })
	}
	const configured = await isInstanceConfiguredForApp(ctx.applicationId, instanceId)
	if (!configured) {
		throw data({ error: "Oracle-instansen er ikke konfigurert for denne applikasjonen" }, { status: 403 })
	}

	// Date format and range validation
	const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
	const fromUtc = typeof params.fromUtc === "string" ? params.fromUtc : undefined
	const toUtc = typeof params.toUtc === "string" ? params.toUtc : undefined
	if (fromUtc && !DATE_PATTERN.test(fromUtc)) {
		throw data({ error: "Ugyldig datoformat for fromUtc (forventet YYYY-MM-DD)" }, { status: 400 })
	}
	if (toUtc && !DATE_PATTERN.test(toUtc)) {
		throw data({ error: "Ugyldig datoformat for toUtc (forventet YYYY-MM-DD)" }, { status: 400 })
	}
	if (fromUtc && toUtc && fromUtc > toUtc) {
		throw data({ error: "Fra-dato kan ikke være etter til-dato" }, { status: 400 })
	}
}

/**
 * Validate provider-specific download constraints.
 * Called after evidence type validation but before downloading.
 */
export function validateProviderDownloadConstraints(
	providerType: EvidenceProviderType,
	evidenceType: string,
	params: Record<string, unknown>,
): void {
	switch (providerType) {
		case "oracle":
			// Period evidence requires date range
			if (evidenceType === "period") {
				if (!params.fromUtc || !params.toUtc) {
					throw data({ error: "Periodebevis krever fra- og til-dato" }, { status: 400 })
				}
			}
			break
		case "deployments":
			break
		default: {
			const _exhaustive: never = providerType
			throw new Error(`Unknown provider type: ${_exhaustive}`)
		}
	}
}

/**
 * Derive a provider-specific source identifier for storage paths and audit logging.
 * Oracle uses instanceId, NDA will use team/env/app.
 */
export function getProviderSourceId(providerType: EvidenceProviderType, params: Record<string, unknown>): string {
	switch (providerType) {
		case "oracle":
			return (params.instanceId as string) || ""
		case "deployments": {
			const parts = [params.team, params.environment, params.appName].filter(Boolean)
			return parts.join("/") || ""
		}
		default: {
			const _exhaustive: never = providerType
			throw new Error(`Unknown provider type: ${_exhaustive}`)
		}
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function getStringValue(source: URLSearchParams | FormData, key: string): string {
	const value = source.get(key)
	return typeof value === "string" ? value.trim() : ""
}
