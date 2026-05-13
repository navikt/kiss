/**
 * Evidence provider abstraction layer.
 *
 * Defines common interfaces for evidence providers (Oracle, NDA/deployments, etc.)
 * so that the evidence download/status UI and API routes can work provider-agnostically.
 *
 * Each provider implements EvidenceProvider and is registered in the factory
 * (index.server.ts). Provider-specific details are encapsulated behind these
 * interfaces — consumers never need to know which provider they're talking to.
 */

// ─── Provider types ──────────────────────────────────────────────────────

export const EVIDENCE_PROVIDER_TYPES = ["oracle", "deployments"] as const
export type EvidenceProviderType = (typeof EVIDENCE_PROVIDER_TYPES)[number]

// ─── Status types ────────────────────────────────────────────────────────

/** Readiness status for a single evidence item (file, report, etc.) */
export type EvidenceItemStatus = "ok" | "partial" | "failed" | "pending" | "processing" | "not_available"

/** A single downloadable evidence item within a provider's status response */
export interface EvidenceStatusItem {
	/** Provider-specific identifier (Oracle: evidenceType like "audit", NDA: reportId) */
	id: string
	/** Human-readable label */
	label: string
	/** Current readiness status */
	status: EvidenceItemStatus
	/** Available download formats (e.g. ["excel", "pdf"]) */
	formats: string[]
	/** Whether the item can be downloaded right now */
	canDownload: boolean
	/** Optional error message if status is "failed" */
	error?: string | null
	/** Provider-specific details (Oracle: review progress, NDA: deployment stats) */
	details?: Record<string, unknown>
}

/** Aggregated status response from a provider */
export interface EvidenceStatusResponse {
	providerType: EvidenceProviderType
	/** Provider-specific source identifier (Oracle: instanceName, NDA: appName) */
	sourceLabel: string
	/** When the status was last fetched/collected */
	collectedAt: string | null
	/** Optional URL to external review system */
	externalUrl: string | null
	/** Individual evidence items with their statuses */
	items: EvidenceStatusItem[]
	/** Provider-specific metadata passed through to the UI */
	metadata: Record<string, unknown>
}

// ─── Download types ──────────────────────────────────────────────────────

/** Result of downloading an evidence file from a provider */
export interface EvidenceFile {
	buffer: Buffer
	contentType: string
	fileName: string
}

// ─── Async job types (for providers with async generation) ───────────────

export type EvidenceJobStatus = "pending" | "processing" | "completed" | "failed"

export interface EvidenceJobResult {
	jobId: string
	status: EvidenceJobStatus
	error?: string | null
	/** Provider-specific result data (NDA: reportId, report metadata) */
	result?: Record<string, unknown>
	/** Suggested poll interval in seconds (from Retry-After header) */
	retryAfterSeconds?: number
}

// ─── Provider interface ──────────────────────────────────────────────────

/**
 * Common interface for all evidence providers.
 *
 * Providers must implement getStatus() and downloadFile().
 * Providers with async generation (e.g. NDA) also implement
 * requestGeneration() and getJobStatus().
 */
export interface EvidenceProvider {
	readonly type: EvidenceProviderType

	/**
	 * Check the current status of available evidence.
	 *
	 * @param params - Provider-specific parameters (Oracle: instanceId + dates, NDA: team/env/app + period)
	 * @returns Status response with downloadable items, or null if unavailable
	 */
	getStatus(params: Record<string, unknown>): Promise<EvidenceStatusResponse | null>

	/**
	 * Download an evidence file.
	 *
	 * @param params - Provider-specific parameters
	 * @param itemId - The evidence item to download (from EvidenceStatusItem.id)
	 * @param format - Desired format (e.g. "excel", "pdf")
	 * @returns The file buffer with metadata
	 */
	downloadFile(params: Record<string, unknown>, itemId: string, format: string): Promise<EvidenceFile>

	/**
	 * Request async generation of evidence (optional — only for providers like NDA).
	 * Returns a job ID that can be polled with getJobStatus().
	 */
	requestGeneration?(params: Record<string, unknown>, reason?: string): Promise<{ jobId: string }>

	/**
	 * Check the status of an async generation job (optional — only for providers like NDA).
	 */
	getJobStatus?(params: Record<string, unknown>, jobId: string): Promise<EvidenceJobResult>
}
