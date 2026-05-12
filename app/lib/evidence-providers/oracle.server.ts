/**
 * Oracle evidence provider — wraps oracle-revisjon.server.ts behind the
 * generic EvidenceProvider interface.
 */

import { ORACLE_EVIDENCE_TYPES, type OracleEvidenceType } from "~/lib/oracle-revisjon.server"
import type { EvidenceFile, EvidenceProvider, EvidenceStatusItem, EvidenceStatusResponse } from "./types"

/** Oracle-specific parameters for status and download calls */
export interface OracleProviderParams {
	instanceId: string
	fromUtc?: string
	toUtc?: string
}

function assertOracleParams(params: Record<string, unknown>): OracleProviderParams {
	const instanceId = params.instanceId
	if (typeof instanceId !== "string" || !instanceId) {
		throw new Error("Oracle provider requires 'instanceId' parameter")
	}
	return {
		instanceId,
		fromUtc: typeof params.fromUtc === "string" ? params.fromUtc : undefined,
		toUtc: typeof params.toUtc === "string" ? params.toUtc : undefined,
	}
}

function mapOracleStatus(status: string): EvidenceStatusItem["status"] {
	switch (status) {
		case "OK":
			return "ok"
		case "PARTIAL":
			return "partial"
		case "FAILED":
			return "failed"
		default:
			return "not_available"
	}
}

export class OracleEvidenceProvider implements EvidenceProvider {
	readonly type = "oracle" as const

	async getStatus(params: Record<string, unknown>): Promise<EvidenceStatusResponse | null> {
		const { instanceId, fromUtc, toUtc } = assertOracleParams(params)

		const { getEvidenceStatus } = await import("~/lib/oracle-revisjon.server")
		const status = await getEvidenceStatus(instanceId, fromUtc, toUtc)
		if (!status) return null

		return {
			providerType: "oracle",
			sourceLabel: status.instanceName,
			collectedAt: status.collectedAt,
			externalUrl: status.reviewUrl,
			items: status.evidenceTypes.map(
				(et): EvidenceStatusItem => ({
					id: et.type,
					label: et.title,
					status: mapOracleStatus(et.status),
					formats: et.formats.map((f) => f.toLowerCase()),
					canDownload: et.available,
					error: et.error,
					details: et.review ? { review: et.review } : undefined,
				}),
			),
			metadata: {
				instanceId: status.instanceId,
				instanceName: status.instanceName,
			},
		}
	}

	async downloadFile(params: Record<string, unknown>, itemId: string, format: string): Promise<EvidenceFile> {
		const { instanceId, fromUtc, toUtc } = assertOracleParams(params)

		if (!(ORACLE_EVIDENCE_TYPES as readonly string[]).includes(itemId)) {
			throw new Error(`Unsupported evidence type: ${itemId}. Supported: ${ORACLE_EVIDENCE_TYPES.join(", ")}`)
		}

		const normalizedFormat = format.toLowerCase()
		if (normalizedFormat !== "excel" && normalizedFormat !== "pdf") {
			throw new Error(`Unsupported format: ${format}. Supported formats: excel, pdf`)
		}

		const { downloadEvidenceFile } = await import("~/lib/oracle-revisjon.server")
		return downloadEvidenceFile(instanceId, itemId as OracleEvidenceType, normalizedFormat, fromUtc, toUtc)
	}
}
