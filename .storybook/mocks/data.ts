/**
 * Mock data factories for Storybook stories.
 * Provides consistent, realistic test data for all KISS pages.
 */

// ─── Root loader (app shell) ────────────────────────────────────────

export function mockRootLoaderData(
	overrides?: Partial<{
		isAdmin: boolean
		isAuditor: boolean
		name: string
		navIdent: string
	}>,
) {
	return {
		theme: "light" as const,
		user: {
			navIdent: overrides?.navIdent ?? "A123456",
			name: overrides?.name ?? "Ola Nordmann",
			email: "ola.nordmann@nav.no",
			isAdmin: overrides?.isAdmin ?? true,
			isAuditor: overrides?.isAuditor ?? false,
			sections: [
				{ sectionName: "Pensjon og uføre", sectionSlug: "pensjon-og-ufore", roleLabel: "Seksjonsleder" },
				{ sectionName: "Arbeid og ytelser", sectionSlug: "arbeid-og-ytelser", roleLabel: "Medlem" },
			],
			teams: [
				{ teamName: "Starte pensjon", teamSlug: "starte-pensjon", sectionSlug: "pensjon-og-ufore" },
				{ teamName: "Beregning", teamSlug: "beregning", sectionSlug: "pensjon-og-ufore" },
			],
		},
	}
}

// ─── Kontrollrammeverk ──────────────────────────────────────────────

export function mockKontrollrammeverkData() {
	return {
		risks: [
			{ riskId: "R-ST.01", name: "Uautorisert tilgang til systemer", domainCode: "ST", domainName: "Sikkerhetstesting" },
			{ riskId: "R-TS.01", name: "Manglende sporbarhet i endringer", domainCode: "TS", domainName: "Tilgangsstyring" },
			{ riskId: "R-PD.01", name: "Tap av persondata", domainCode: "PD", domainName: "Persondata" },
		],
		controls: [
			{
				controlId: "K-ST.01",
				name: "Sikkerhetstesting av applikasjoner",
				domainCode: "ST",
				domainName: "Sikkerhetstesting",
				responsible: "Utviklerteam",
				technologyElements: ["Applikasjon", "Database"],
				frequency: "Årlig",
			},
			{
				controlId: "K-ST.02",
				name: "Penetrasjonstesting",
				domainCode: "ST",
				domainName: "Sikkerhetstesting",
				responsible: "Sikkerhetsavdeling",
				technologyElements: ["Applikasjon"],
				frequency: "Kvartalsvis",
			},
			{
				controlId: "K-TS.01",
				name: "Tilgangskontroll og autorisering",
				domainCode: "TS",
				domainName: "Tilgangsstyring",
				responsible: "Utviklerteam",
				technologyElements: ["Applikasjon", "API"],
				frequency: "Halvårlig",
			},
			{
				controlId: "K-TS.02",
				name: "Logging av tilgangsendringer",
				domainCode: "TS",
				domainName: "Tilgangsstyring",
				responsible: null,
				technologyElements: ["Database"],
				frequency: "Kontinuerlig",
			},
			{
				controlId: "K-PD.01",
				name: "Personvernkonsekvensvurdering (DPIA)",
				domainCode: "PD",
				domainName: "Persondata",
				responsible: "Produkteier",
				technologyElements: [],
				frequency: "Ved endring",
			},
		],
		totalControls: 5,
		filters: { ansvarlig: "", teknologielement: "", frekvens: "" },
		options: {
			responsibleOptions: ["Utviklerteam", "Sikkerhetsavdeling", "Produkteier"],
			technologyOptions: ["Applikasjon", "Database", "API"],
			frequencyOptions: ["Årlig", "Kvartalsvis", "Halvårlig", "Kontinuerlig", "Ved endring"],
		},
	}
}

// ─── Domene ─────────────────────────────────────────────────────────

export function mockDomainData() {
	return {
		domain: {
			id: "d-01",
			code: "ST",
			name: "Sikkerhetstesting",
			risks: [
				{
					id: "R-ST.01",
					name: "Uautorisert tilgang til systemer",
					controls: [
						{
							id: "K-ST.01",
							name: "Sikkerhetstesting av applikasjoner",
							totalApps: 12,
							implemented: 8,
							partial: 2,
							notImplemented: 1,
							notAssessed: 1,
							gaps: [
								{ appId: "app-1", appName: "pensjon-sak", status: "not_implemented" },
								{ appId: "app-2", appName: "psak-frontend", status: "not_assessed" },
							],
						},
						{
							id: "K-ST.02",
							name: "Penetrasjonstesting",
							totalApps: 12,
							implemented: 5,
							partial: 3,
							notImplemented: 2,
							notAssessed: 2,
							gaps: [],
						},
					],
				},
			],
		},
	}
}

// ─── Seksjoner ──────────────────────────────────────────────────────

export function mockSeksjonerData() {
	return {
		sections: [
			{ id: "s-01", name: "Pensjon og uføre", slug: "pensjon-og-ufore", description: "Ansvarlig for pensjon- og uføresystemer" },
			{
				id: "s-02",
				name: "Arbeid og ytelser",
				slug: "arbeid-og-ytelser",
				description: "Ansvarlig for arbeid- og ytelsessystemer",
			},
			{ id: "s-03", name: "Helsetjenester", slug: "helsetjenester", description: null },
		],
	}
}

export function mockSeksjonDetailData() {
	return {
		seksjon: "pensjon-og-ufore",
		seksjonName: "Pensjon og uføre",
		sectionId: "s-01",
		teams: [
			{
				slug: "starte-pensjon",
				name: "Starte pensjon",
				implemented: 18,
				partial: 4,
				notImplemented: 2,
				notRelevant: 3,
				total: 27,
				apps: 5,
			},
			{
				slug: "beregning",
				name: "Beregning",
				implemented: 22,
				partial: 2,
				notImplemented: 1,
				notRelevant: 2,
				total: 27,
				apps: 3,
			},
			{
				slug: "utbetaling",
				name: "Utbetaling",
				implemented: 15,
				partial: 5,
				notImplemented: 5,
				notRelevant: 2,
				total: 27,
				apps: 4,
			},
		],
		unassigned: {
			apps: 2,
			implemented: 8,
			partial: 3,
			notImplemented: 5,
			notRelevant: 1,
			total: 27,
		},
		totalApps: 14,
		totalImplemented: 63,
		totalPartial: 14,
		totalMangler: 13,
		totalControls: 27,
		overallPercent: 70,
		canAdmin: true,
		deploymentStats: mockDeploymentStats(),
	}
}

// ─── Team ───────────────────────────────────────────────────────────

export function mockTeamDetailData() {
	return {
		seksjon: "pensjon-og-ufore",
		seksjonName: "Pensjon og uføre",
		team: "starte-pensjon",
		teamId: "t-01",
		teamName: "Starte pensjon",
		apps: [
			mockAppSummary({ appId: "app-1", appName: "pensjon-sak", implemented: 18, partial: 4, notImplemented: 2, notRelevant: 3 }),
			mockAppSummary({ appId: "app-2", appName: "psak-frontend", implemented: 15, partial: 6, notImplemented: 3, notRelevant: 3 }),
			mockAppSummary({ appId: "app-3", appName: "pensjon-selvbetjening", implemented: 20, partial: 2, notImplemented: 1, notRelevant: 4 }),
		],
		canAdmin: true,
		canAddApp: true,
		availableApps: [
			{ id: "app-4", name: "pensjon-opptjening" },
			{ id: "app-5", name: "pensjon-vedtak" },
		],
		totalImplemented: 53,
		totalPartial: 12,
		totalMangler: 6,
		overallPercent: 75,
		deploymentStats: mockDeploymentStats(),
	}
}

function mockAppSummary(overrides: {
	appId: string
	appName: string
	implemented: number
	partial: number
	notImplemented: number
	notRelevant: number
}) {
	return {
		...overrides,
		total: overrides.implemented + overrides.partial + overrides.notImplemented + overrides.notRelevant,
		source: "direct" as const,
		teamIds: ["t-01"],
	}
}

// ─── Mine team ──────────────────────────────────────────────────────

export function mockMineTeamData() {
	return {
		hasTeams: true as const,
		teams: [
			{ id: "t-01", name: "Starte pensjon", slug: "starte-pensjon", sectionSlug: "pensjon-og-ufore", sectionName: "Pensjon og uføre" },
			{ id: "t-02", name: "Beregning", slug: "beregning", sectionSlug: "pensjon-og-ufore", sectionName: "Pensjon og uføre" },
		],
		apps: [
			mockAppSummary({ appId: "app-1", appName: "pensjon-sak", implemented: 18, partial: 4, notImplemented: 2, notRelevant: 3 }),
			mockAppSummary({ appId: "app-2", appName: "psak-frontend", implemented: 15, partial: 6, notImplemented: 3, notRelevant: 3 }),
		],
		deploymentStats: mockDeploymentStats(),
		totals: {
			apps: 2,
			implemented: 33,
			partial: 10,
			mangler: 5,
			percent: 69,
		},
	}
}

export function mockMineTeamEmptyData() {
	return {
		hasTeams: false as const,
		teams: [],
		apps: [],
		deploymentStats: null,
		totals: null,
	}
}

// ─── Nais-overvåking ────────────────────────────────────────────────

export function mockNaisOvervakingData() {
	return {
		teams: [
			{ slug: "starte-pensjon", displayName: "Starte pensjon", appCount: 12, discoveredAt: "2025-01-15", sectionId: "s-01", sectionName: "Pensjon og uføre" },
			{ slug: "beregning", displayName: "Beregning", appCount: 8, discoveredAt: "2025-01-15", sectionId: "s-01", sectionName: "Pensjon og uføre" },
			{ slug: "dagpenger", displayName: "Dagpenger", appCount: 15, discoveredAt: "2025-02-01", sectionId: "s-02", sectionName: "Arbeid og ytelser" },
			{ slug: "ukoblet-team", displayName: "Ukoblet team", appCount: 3, discoveredAt: "2025-03-10", sectionId: null, sectionName: null },
		],
		sections: [
			{ id: "s-01", name: "Pensjon og uføre" },
			{ id: "s-02", name: "Arbeid og ytelser" },
		],
		lastSync: "2025-03-15T10:30:00.000Z",
	}
}

// ─── Applikasjon detaljer ───────────────────────────────────────────

export function mockAppDetaljerData() {
	return {
		app: { id: "app-1", name: "pensjon-sak", description: "Hovedapplikasjon for saksbehandling av pensjon" },
		environments: [
			{ name: "dev-gcp", image: "europe-north1-docker.pkg.dev/nais-management/pensjon-sak:2025.01.15-abc123", deployed: true },
			{ name: "prod-gcp", image: "europe-north1-docker.pkg.dev/nais-management/pensjon-sak:2025.01.14-def456", deployed: true },
		],
		persistence: [
			{ id: "p-1", type: "cloud_sql_postgres", name: "pensjon-sak-db", version: "16", tier: "db-custom-4-16384", highAvailability: true, auditLogging: null, auditLogUrl: null, oracleInstanceId: null, dataClassification: "critical", manuallyAdded: false },
			{ id: "p-2", type: "oracle", name: "PENSJON_DB_01", version: null, tier: null, highAvailability: null, auditLogging: null, auditLogUrl: null, oracleInstanceId: "pensjon-db-01", dataClassification: "financial_regulation", manuallyAdded: false },
		],
		oracleAuditSummaries: [],
		deploymentVerifications: [],
		authIntegrations: [],
		manualGroups: [],
		groupNames: {},
		assessmentsByGroupId: {},
		naisGroupIds: [],
		ghostGroupIds: [],
		accessPolicyRules: [],
		teams: [{ teamId: "t-01", teamName: "Starte pensjon", teamSlug: "starte-pensjon" }],
		primaryApp: null,
		linkedApps: [],
		appElements: [
			{ id: "elem-1", name: "PostgreSQL", source: "nais", confirmedAt: "2025-01-15T08:00:00.000Z", rejectedAt: null },
			{ id: "elem-2", name: "Kafka", source: "nais", confirmedAt: null, rejectedAt: null },
		],
		routineDeadlines: [],
		completedReviews: [],
		assessments: [
			mockAssessment("K-ST.01", "Sikkerhetstesting", "implemented", "Rutiner dekker denne kontrollen"),
			mockAssessment("K-ST.02", "Penetrasjonstesting", "partially_implemented", "Rutine forfalt"),
			mockAssessment("K-TS.01", "Tilgangskontroll", "not_relevant", "Screeningsvar indikerer at kontrollen ikke er relevant", [
				{ questionId: "q-1", questionTitle: "Behandler applikasjonen personopplysninger?", answer: "Nei", effect: "not_relevant" },
			]),
			mockAssessment("K-TS.02", "Logging av tilgangsendringer", "not_implemented", "Ingen rutiner matcher denne kontrollen"),
			mockAssessment("K-PD.01", "DPIA", null, "Ingen rutiner eller screeningspørsmål påvirker denne kontrollen"),
		],
		compliance: {
			totalControls: 5,
			implemented: 1,
			partial: 1,
			notImplemented: 1,
			notRelevant: 1,
			notAssessed: 1,
			percent: 40,
			hasScreeningAnswers: true,
			withRoutine: 3,
			withoutRoutine: 2,
			routineNotRelevant: 1,
			routineCompleted: 1,
			routineOverdue: 1,
			routineNeverReviewed: 0,
		},
		appReports: [
			{ id: "r-1", name: "Compliance-rapport Q1 2025", createdAt: "2025-03-31T12:00:00Z", createdBy: "A123456", reportBucketPath: "reports/r-1.pdf" },
		],
		oracleInstances: [],
		totalOracleInstanceCount: 0,
		oracleProfiles: [
			{ instanceId: "pensjon-db-01", instanceName: "PENSJON_DB_01", profileName: "DEFAULT", criticality: "low", updatedBy: "A123456", updatedAt: "2026-04-15T10:30:00Z" },
			{ instanceId: "pensjon-db-01", instanceName: "PENSJON_DB_01", profileName: "APP_USER", criticality: "high", updatedBy: "A123456", updatedAt: "2026-04-15T10:31:00Z" },
			{ instanceId: "pensjon-db-01", instanceName: "PENSJON_DB_01", profileName: "BATCH_USER", criticality: null, updatedBy: null, updatedAt: null },
			{ instanceId: "pensjon-db-01", instanceName: "PENSJON_DB_01", profileName: "CONNECT", criticality: "very_high", updatedBy: "B654321", updatedAt: "2026-04-16T08:00:00Z" },
		],
		instanceSnapshotHistories: [],
		sectionSlugMap: { "s-01": "pensjon-og-ufore" },
		canAdmin: true,
		knownApps: [],
		acknowledgments: {},
	}
}

function mockAssessment(
	controlId: string,
	controlName: string,
	status: string | null,
	reason: string,
	screeningDetails: Array<{ questionId: string; questionTitle: string; answer: string; effect: string }> = [],
) {
	const domainCode = controlId.split(".")[0]?.replace("K-", "") ?? "ST"
	const domainNames: Record<string, string> = { ST: "Sikkerhetstesting", TS: "Tilgangsstyring", PD: "Persondata" }
	return {
		controlUuid: `uuid-${controlId}`,
		controlId,
		controlName,
		domainCode,
		domainName: domainNames[domainCode] ?? domainCode,
		technologyElementId: null,
		technologyElementName: null,
		autoStatus: status,
		autoReason: status != null ? reason : null,
		effectiveStatus: status,
		establishment: status === "not_relevant" ? "not_relevant" : status != null ? "established" : "not_established",
		routineCompliance:
			status === "implemented" ? "compliant" : status === "partially_implemented" ? "overdue" : "not_applicable",
		routinesEstablished: status === "not_relevant" ? 0 : status != null ? 1 : 0,
		routinesCompleted: status === "implemented" ? 1 : 0,
		routinesOverdue: status === "partially_implemented" ? 1 : 0,
		screeningDetails,
		applicationControlId: `ac-${controlId}`,
		comment: null,
		commentUpdatedAt: null,
		commentUpdatedBy: null,
	}
}

// ─── Admin ──────────────────────────────────────────────────────────

export function mockAdminData() {
	return null
}

// ─── Oracle profiler ────────────────────────────────────────────────

export function mockOracleProfilerData() {
	return {
		section: { id: "s-01", name: "Pensjon og uføre", slug: "pensjon-og-ufore" },
		seksjon: "pensjon-og-ufore",
		profiles: [
			{
				instanceId: "pensjon-db-01",
				profileName: "DEFAULT",
				applications: [
					{ applicationId: "app-1", applicationName: "pensjon-sak" },
					{ applicationId: "app-2", applicationName: "pensjon-vedtak" },
				],
				criticality: "low",
				assessedBy: "A123456",
				assessedAt: "2026-04-15T10:30:00Z",
			},
			{
				instanceId: "pensjon-db-01",
				profileName: "APP_USER",
				applications: [{ applicationId: "app-1", applicationName: "pensjon-sak" }],
				criticality: "high",
				assessedBy: "A123456",
				assessedAt: "2026-04-15T10:31:00Z",
			},
			{
				instanceId: "pensjon-db-02",
				profileName: "BATCH_USER",
				applications: [{ applicationId: "app-3", applicationName: "pensjon-batch" }],
				criticality: "medium",
				assessedBy: "A123456",
				assessedAt: "2026-04-15T10:32:00Z",
			},
		],
	}
}

// ─── Deployment stats ───────────────────────────────────────────────

export function mockDeploymentStats() {
	return {
		totalApps: 14,
		appsWithDeployments: 12,
		deployedLast30Days: 8,
		deployedLast90Days: 11,
		neverDeployed: 2,
		avgDaysSinceLastDeploy: 15,
	}
}
