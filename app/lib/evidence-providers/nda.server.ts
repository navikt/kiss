/**
 * NDA (deployment audit) evidence provider — stub implementation.
 *
 * Will be implemented when the NDA audit-reports API is ready.
 * Supports async report generation via requestGeneration() + getJobStatus().
 */

import type { EvidenceFile, EvidenceJobResult, EvidenceProvider, EvidenceStatusResponse } from "./types"

export class NdaEvidenceProvider implements EvidenceProvider {
	readonly type = "deployments" as const

	async getStatus(_params: Record<string, unknown>): Promise<EvidenceStatusResponse | null> {
		return null
	}

	async downloadFile(_params: Record<string, unknown>, _itemId: string, _format: string): Promise<EvidenceFile> {
		throw new Error("NDA evidence provider is not yet implemented")
	}

	async requestGeneration(_params: Record<string, unknown>, _reason?: string): Promise<{ jobId: string }> {
		throw new Error("NDA evidence provider is not yet implemented")
	}

	async getJobStatus(_params: Record<string, unknown>, _jobId: string): Promise<EvidenceJobResult> {
		throw new Error("NDA evidence provider is not yet implemented")
	}
}
