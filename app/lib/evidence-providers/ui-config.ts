/**
 * Provider-specific UI configuration for evidence components.
 *
 * This module provides labels, text strings, and display functions
 * that vary per evidence provider. Components use this config
 * instead of hardcoding provider-specific text.
 */

import type { EvidenceProviderType } from "~/db/schema/routines"

export interface EvidenceProviderUiConfig {
	/** Display heading for the evidence section */
	heading: string
	/** Label for the instance/source selector */
	instanceLabel: string
	/** Text shown while loading status */
	loadingMessage: string
	/** Text shown while downloading evidence */
	downloadingMessage: string
	/** Label for external review link */
	externalLinkLabel: string
	/** Description text for the status table */
	statusTableDescription: string
	/** Warning text when no instances are configured */
	noInstancesWarning: string
	/** Map evidence type id → human-readable label */
	evidenceTypeLabels: Record<string, string>
	/** Format an instance id for display */
	formatInstanceId: (instanceId: string) => string
	/** Whether date filters should be shown */
	showDateFilters: (evidenceTypes: string[]) => boolean
}

const oracleConfig: EvidenceProviderUiConfig = {
	heading: "Oracle revisjonsbevis",
	instanceLabel: "Oracle-instans",
	loadingMessage: "Henter status fra pensjon-oracle-revisjon… (dette kan ta opptil 30 sekunder)",
	downloadingMessage: "Henter bevis fra pensjon-oracle-revisjon… dette kan ta opptil ett minutt.",
	externalLinkLabel: "Åpne gjennomgang i pensjon-oracle-revisjon",
	statusTableDescription:
		"Tabellen under viser status for bevistyper i pensjon-oracle-revisjon. Velg format for å hente beviset direkte inn i denne rutinegjennomgangen.",
	noInstancesWarning:
		"Ingen Oracle-instanser er konfigurert for denne applikasjonen. Konfigurer instanser i applikasjonsinnstillingene.",
	evidenceTypeLabels: {
		audit: "Oracle Unified Audit-konfigurasjon",
		profiles: "Oracle-profiler",
		roles: "Oracle-roller",
		users: "Oracle-brukere",
		period: "Periodebasert gjennomgang",
	},
	formatInstanceId: (id: string) => id.toUpperCase(),
	showDateFilters: (evidenceTypes: string[]) => evidenceTypes.includes("period"),
}

const deploymentsConfig: EvidenceProviderUiConfig = {
	heading: "Leveranserapporter",
	instanceLabel: "Team",
	loadingMessage: "Henter status fra NDA… (dette kan ta opptil 30 sekunder)",
	downloadingMessage: "Henter leveranserapport fra NDA… dette kan ta opptil ett minutt.",
	externalLinkLabel: "Åpne i NDA",
	statusTableDescription:
		"Tabellen under viser status for leveranserapporter. Velg format for å hente rapporten direkte inn i denne rutinegjennomgangen.",
	noInstancesWarning: "Ingen team er konfigurert for denne applikasjonen.",
	evidenceTypeLabels: {
		deployment_evidence_report: "Leveranserapport",
	},
	formatInstanceId: (id: string) => id,
	showDateFilters: () => false,
}

export function getProviderUiConfig(providerType: EvidenceProviderType): EvidenceProviderUiConfig {
	switch (providerType) {
		case "oracle":
			return oracleConfig
		case "deployments":
			return deploymentsConfig
		default: {
			const _exhaustive: never = providerType
			throw new Error(`Unknown provider type: ${_exhaustive}`)
		}
	}
}
