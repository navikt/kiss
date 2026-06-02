/**
 * Mock data factories for Storybook stories.
 * Provides consistent, realistic test data for all KISS pages.
 */

import type { EconomySystemType } from "../../app/db/schema/applications"

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
		featureFlags: { showComplianceStats: true },
		user: {
			navIdent: overrides?.navIdent ?? "Z990001",
			name: overrides?.name ?? "Glad Fjord",
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
		economySystemCount: 3,
		economySystemExpiredCount: 1,
		screenedCount: 8,
		routinesGjennomfort: 12,
		routinesIkkeGjennomfort: 4,
		needsFollowUpApps: 2,
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
			mockAppSummary({ appId: "app-1", appName: "pensjon-sak", implemented: 18, partial: 4, notImplemented: 2, notRelevant: 3, isEconomySystem: true, economySystemType: "regnskapssystem" }),
			mockAppSummary({ appId: "app-2", appName: "psak-frontend", implemented: 15, partial: 6, notImplemented: 3, notRelevant: 3, isEconomySystem: false }),
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
		totalRoutinesIkkeGjennomfort: 7,
		deploymentStats: mockDeploymentStats(),
		teamUsers: [
			{ navIdent: "Z990003", name: "Glad Fjord", roles: ["developer", "tech_lead"] as const },
			{ navIdent: "Z990004", name: "Rask Elv", roles: ["product_owner"] as const },
		],
	}
}

function mockAppSummary(overrides: {
	appId: string
	appName: string
	implemented: number
	partial: number
	notImplemented: number
	notRelevant: number
	routineCompliance?: { routinesGjennomfort: number; routinesIkkeGjennomfort: number; routinesMaaFolgesOpp: number; routinesTotal: number }
	isEconomySystem?: boolean | null
	economySystemType?: EconomySystemType | null
}) {
	return {
		...overrides,
		total: overrides.implemented + overrides.partial + overrides.notImplemented + overrides.notRelevant,
		source: "direct" as const,
		teamIds: ["t-01"],
		screeningProgress: { answered: 4, total: 6 },
		routineCompliance: overrides.routineCompliance ?? { routinesGjennomfort: 3, routinesIkkeGjennomfort: 2, routinesMaaFolgesOpp: 1, routinesTotal: 5 },
		isEconomySystem: overrides.isEconomySystem ?? null,
		economySystemType: overrides.economySystemType ?? null,
	}
}

// ─── Team rediger ───────────────────────────────────────────────────

export function mockTeamEditData() {
	return {
		seksjon: "pensjon-og-ufore",
		seksjonName: "Pensjon og uføre",
		teamSlug: "starte-pensjon",
		teamId: "t-01",
		teamName: "Starte pensjon",
		teamDescription: "Team som jobber med oppstart av alderspensjon",
		teamArchivedAt: null as string | null,
		apps: [
			mockAppSummary({ appId: "app-1", appName: "pensjon-sak", implemented: 18, partial: 4, notImplemented: 2, notRelevant: 3 }),
			mockAppSummary({ appId: "app-2", appName: "psak-frontend", implemented: 15, partial: 6, notImplemented: 3, notRelevant: 3 }),
			{ ...mockAppSummary({ appId: "app-6", appName: "pensjon-pselv", implemented: 12, partial: 3, notImplemented: 4, notRelevant: 2 }), source: "nais-team" as const },
		],
		availableApps: [
			{ id: "app-4", name: "pensjon-opptjening" },
			{ id: "app-5", name: "pensjon-vedtak" },
			{ id: "app-7", name: "pensjon-simulering" },
		],
		linkedNaisTeams: [
			{ id: "nt-1", slug: "pensjonsdeployer", displayName: "Pensjonsdeployer", appCount: 12 },
			{ id: "nt-2", slug: "pensjonsamhandling", displayName: "Pensjonsamhandling", appCount: 5 },
		],
		availableNaisTeams: [
			{ slug: "pensjonskalkulator" },
			{ slug: "pensjon-regler" },
		],
		teamMembers: [
			{ roleId: "00000000-0000-0000-0000-000000000001", navIdent: "Z990001", name: "Glad Fjord", role: "product_owner" as const },
			{ roleId: "00000000-0000-0000-0000-000000000002", navIdent: "Z990002", name: "Rask Elv", role: "tech_lead" as const },
			{ roleId: "00000000-0000-0000-0000-000000000003", navIdent: "Z990003", name: "Stille Skog", role: "developer" as const },
		],
		userIsAdmin: false,
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

export function mockAppDetaljerData(overrides?: Record<string, unknown>) {
	return {
		app: { id: "app-1", name: "pensjon-sak", description: "Hovedapplikasjon for saksbehandling av pensjon" },
		environments: [
			{ name: "dev-gcp", image: "europe-north1-docker.pkg.dev/nais-management/pensjon-sak:2025.01.15-abc123", deployed: true },
			{ name: "prod-gcp", image: "europe-north1-docker.pkg.dev/nais-management/pensjon-sak:2025.01.14-def456", deployed: true },
		],
		persistence: [{ type: "PostgreSQL", name: "pensjon-sak-db", environment: "prod-gcp" }],
		oracleAuditSummaries: [],
		deploymentVerifications: [],
		authIntegrations: [],
		manualGroups: [],
		groupNames: {},
		assessmentsByGroupId: {},
		naisGroupIds: [],
		ghostGroupIds: [],
		accessPolicyRules: [
			{ id: "rule-1", direction: "inbound", ruleApplication: "pensjon-frontend", ruleNamespace: null, ruleCluster: null },
			{ id: "rule-2", direction: "inbound", ruleApplication: "psak-frontend", ruleNamespace: null, ruleCluster: null },
			{ id: "rule-3", direction: "inbound", ruleApplication: "pensjonskalkulator", ruleNamespace: "pensjon", ruleCluster: "prod-gcp" },
			{ id: "rule-4", direction: "inbound", ruleApplication: "uforetrygd-api", ruleNamespace: "ufore", ruleCluster: "prod-gcp" },
			{ id: "rule-5", direction: "inbound", ruleApplication: "ekstern-gateway", ruleNamespace: "gateway", ruleCluster: "prod-gcp" },
		],
		teams: [{ teamId: "t-01", teamName: "Starte pensjon", teamSlug: "starte-pensjon" }],
		primaryApp: null,
		linkedApps: [],
		appElements: [
			{ id: "elem-1", name: "PostgreSQL", source: "nais", confirmedAt: "2025-01-15T08:00:00.000Z", rejectedAt: null },
			{ id: "elem-2", name: "Kafka", source: "nais", confirmedAt: null, rejectedAt: null },
		],
		routineDeadlines: [
			{
				routine: {
					id: "routine-1",
					name: "Sikkerhetstesting av applikasjoner",
					sectionId: "s-01",
					frequency: "quarterly",
					eventFrequency: null,
					technologyElements: [{ id: "te-1", name: "Applikasjon" }],
					controls: [
						{ id: "c-1", controlId: "K-ST.01", shortTitle: "Sikkerhetstesting" },
						{ id: "c-2", controlId: "K-ST.02", shortTitle: "Penetrasjonstesting" },
					],
					isSectionRoutine: 0,
					sectionRoutineOwnerRole: null,
				},
				matchSource: "screening",
				deadline: "2026-06-01T10:00:00Z",
				lastReviewDate: "2026-03-01T10:00:00Z",
				overdue: false,
				needsFollowUp: true,
			},
			{
				routine: {
					id: "routine-2",
					name: "Tilgangskontroll – gjennomgang",
					sectionId: "s-01",
					frequency: "semi_annually",
					eventFrequency: null,
					technologyElements: [{ id: "te-1", name: "Oracle" }],
					controls: [
						{ id: "c-3", controlId: "K-TS.01", shortTitle: "Tildeling av rettigheter" },
						{ id: "c-4", controlId: "K-TS.02", shortTitle: "Periodisk gjennomgang" },
						{ id: "c-5", controlId: "K-TS.03", shortTitle: "Arbeidsdeling" },
					],
					isSectionRoutine: 1,
					sectionRoutineOwnerRole: "Seksjonsleder",
				},
				matchSource: "section",
				deadline: "2026-09-15T09:00:00Z",
				lastReviewDate: "2026-03-15T09:00:00Z",
				overdue: false,
				isSectionRoutine: true,
				sectionRoutineOwnerRole: "Seksjonsleder",
				matchedTechElements: [{ id: "te-1", name: "Oracle" }],
			},
			{
				routine: {
					id: "routine-3",
					name: "Database-backup verifisering",
					sectionId: "s-01",
					frequency: "monthly",
					eventFrequency: null,
					technologyElements: [{ id: "te-2", name: "Database" }],
					controls: [
						{ id: "c-6", controlId: "K-DR.01", shortTitle: "Jobbmonitorering" },
					],
					isSectionRoutine: 0,
					sectionRoutineOwnerRole: null,
				},
				matchSource: "persistence",
				deadline: "2026-04-01T08:00:00Z",
				lastReviewDate: null,
				overdue: true,
				matchedPersistenceLinks: [{ persistenceType: "oracle", dataClassification: "critical" }],
			},
			{
				routine: {
					id: "routine-4",
					name: "Sikkerhetsgjennomgang ved endring",
					sectionId: "s-01",
					frequency: null,
					eventFrequency: "Ved endring",
					technologyElements: [{ id: "te-1", name: "Applikasjon" }],
					controls: [
						{ id: "c-7", controlId: "K-EH.01", shortTitle: "Regelsett for endringshåndtering" },
						{ id: "c-8", controlId: "K-EH.02", shortTitle: "Klassifisering av endringer" },
					],
					isSectionRoutine: 0,
					sectionRoutineOwnerRole: null,
				},
				matchSource: "screening",
				deadline: null,
				lastReviewDate: "2026-02-10T14:00:00Z",
				overdue: false,
			},
			{
				routine: {
					id: "routine-5",
					name: "Beredskapsrutine",
					sectionId: "s-01",
					frequency: null,
					eventFrequency: "Ved behov",
					technologyElements: [],
					controls: [],
					isSectionRoutine: 1,
					sectionRoutineOwnerRole: "Seksjonsleder",
				},
				matchSource: "section",
				deadline: null,
				lastReviewDate: null,
				overdue: false,
				isSectionRoutine: true,
				sectionRoutineOwnerRole: "Seksjonsleder",
			},
			{
				routine: {
					id: "routine-6",
					name: "Tilgangsgjennomgang",
					sectionId: "s-01",
					frequency: "semi_annually",
					eventFrequency: "Ved behov",
					technologyElements: [],
					controls: [
						{ id: "c-9", controlId: "K-TS.04", shortTitle: "Forvaltning av tilganger" },
						{ id: "c-10", controlId: "K-TS.05", shortTitle: "Kritikalitet i tilganger" },
					],
					isSectionRoutine: 0,
					sectionRoutineOwnerRole: null,
				},
				matchSource: "screening",
				deadline: "2026-08-01T10:00:00Z",
				lastReviewDate: "2026-02-01T10:00:00Z",
				overdue: false,
			},
		],
		completedReviews: [
			{
				id: "rev-1",
				routineId: "routine-1",
				routineName: "Sikkerhetstesting av applikasjoner",
				title: "Sikkerhetstesting Q1 2026",
				reviewedAt: "2026-03-01T10:00:00Z",
				status: "needs_follow_up" as const,
				createdBy: "Z990001",
				sectionId: "s-01",
				participants: [{ confirmedAt: "2026-03-01T11:00:00Z" }],
				followUpPoints: [
					{
						id: "fup-1",
						reviewId: "rev-1",
						text: "Automatisert pentest-rapport mangler for Q1 2026",
						description: "Rapporten skal lastes opp og gjennomgås av teamet",
						resolution: null,
						status: "needs_follow_up" as const,
						createdBy: "Z990001",
						createdAt: "2026-03-01T11:00:00Z",
						resolvedAt: null,
						resolvedBy: null,
						attachments: [],
					},
					{
						id: "fup-2",
						reviewId: "rev-1",
						text: "Sårbarhetsscanning ikke satt opp i CI/CD",
						description: null,
						resolution: "Lagt til Snyk i pipeline – lukket",
						status: "completed" as const,
						createdBy: "Z990001",
						createdAt: "2026-02-15T09:00:00Z",
						resolvedAt: "2026-03-10T14:00:00Z",
						resolvedBy: "Z990002",
						attachments: [],
					},
				],
			},
			{
				id: "rev-sec-1",
				routineId: "routine-2",
				routineName: "Tilgangskontroll – gjennomgang",
				title: "Tilgangskontroll H1 2026",
				reviewedAt: "2026-03-15T09:00:00Z",
				status: "completed" as const,
				createdBy: "Z990001",
				sectionId: "s-01",
				participants: [{ confirmedAt: "2026-03-15T09:30:00Z" }, { confirmedAt: null }],
				followUpPoints: [],
			},
			{
				id: "rev-old",
				routineId: "routine-1",
				routineName: "Sikkerhetstesting av applikasjoner",
				title: "Sikkerhetstesting Q4 2025 (forkastet)",
				reviewedAt: "2025-12-15T10:00:00Z",
				status: "discarded" as const,
				createdBy: "Z990001",
				sectionId: "s-01",
				participants: [],
				followUpPoints: [],
			},
		],
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
			percent: 75,
			hasScreeningAnswers: true,
			screeningProgress: { answered: 4, total: 6 },
			routinesGjennomfort: 3,
			routinesIkkeGjennomfort: 1,
			routinesMaaFolgesOpp: 1,
		},
		appReports: [
			{ id: "r-1", name: "Compliance-rapport Q1 2025", createdAt: "2025-03-31T12:00:00Z", createdBy: "Z990001", reportBucketPath: "reports/r-1.pdf" },
		],
		oracleInstances: [],
		totalOracleInstanceCount: 0,
		oracleRoles: [
			{ instanceId: "pensjon-db-01", instanceName: "PENSJON_DB_01", roleName: "CONNECT", oracleMaintained: true, common: true, criticality: "low", updatedBy: "Z990001", updatedAt: "2026-04-15T10:30:00Z" },
			{ instanceId: "pensjon-db-01", instanceName: "PENSJON_DB_01", roleName: "DBA", oracleMaintained: true, common: true, criticality: "very_high", updatedBy: "Z990001", updatedAt: "2026-04-15T10:31:00Z" },
			{ instanceId: "pensjon-db-01", instanceName: "PENSJON_DB_01", roleName: "APP_USER", oracleMaintained: false, common: false, criticality: "high", updatedBy: "Z990001", updatedAt: "2026-04-15T10:32:00Z" },
			{ instanceId: "pensjon-db-01", instanceName: "PENSJON_DB_01", roleName: "BATCH_ROLE", oracleMaintained: false, common: false, criticality: null, updatedBy: null, updatedAt: null },
		],
		inaccessibleOracleGroups: [],
		instanceSnapshotHistories: [],
		sectionSlugMap: { "s-01": "pensjon-og-ufore" },
		canAdmin: true,
		knownApps: {
			"pensjon-frontend": { status: "monitored", appId: "app-2" },
			"psak-frontend": { status: "monitored", appId: "app-3" },
			"pensjonskalkulator": { status: "discovered" },
			"uforetrygd-api": { status: "unknown" },
			"ekstern-gateway": { status: "unknown" },
		} as Record<string, { status: string; appId?: string }>,
		acknowledgments: {
			"ekstern-gateway": {
				comment: "Ekstern gateway brukes for innlogging via ID-porten",
				acknowledgedBy: "Z990001",
				acknowledgedAt: "2026-01-20T10:00:00Z",
			},
		} as Record<string, { comment: string; acknowledgedBy: string; acknowledgedAt: string }>,
		screeningSessions: [],
		rpaUsers: [],
		appRulesets: [],
		economyClassification: null,
		...overrides,
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

// ─── Deployment stats ───────────────────────────────────────────────

export function mockDeploymentStats() {
	return {
		appsWithData: 12,
		fourEyesPercent: 85,
		fourEyesTotal: 142,
		fourEyesApproved: 121,
		changeOriginPercent: 72,
		changeOriginTotal: 142,
		changeOriginLinked: 102,
	}
}

// ─── Compliance-vurdering ────────────────────────────────────────────

export function mockComplianceData() {
	return {
		appName: "pensjon-sak",
		screening: [
			{
				id: "q-1",
				questionText: "Behandler applikasjonen personopplysninger?",
				descriptionHtml: "<p>Svaret påvirker om DPIA-relaterte kontrollpunkter er relevante.</p>",
				answerType: "boolean",
				answer: "ja",
				choices: [
					{ value: "ja", label: "Ja" },
					{ value: "nei", label: "Nei" },
				],
				affectedControls: ["K-PD.01", "K-PD.02"],
				sortOrder: 1,
			},
			{
				id: "q-2",
				questionText: "Hvilke lagringsløsninger bruker applikasjonen?",
				descriptionHtml: "<p>Velg lagringstyper som brukes. Påvirker persistens-kontrollpunkter.</p>",
				answerType: "persistence",
				answer: "confirmed",
				choices: [],
				affectedControls: ["K-TS.02"],
				sortOrder: 2,
			},
			{
				id: "q-3",
				questionText: "Hvilke Entra ID-grupper bruker applikasjonen?",
				descriptionHtml: "<p>Klassifiser gruppene etter tilgangsmetode.</p>",
				answerType: "entra_id_groups",
				answer: "confirmed",
				choices: [],
				affectedControls: ["K-TS.01"],
				sortOrder: 3,
			},
			{
				id: "q-4",
				questionText: "Hvilke Oracle-roller har applikasjonen?",
				descriptionHtml: "<p>Vurder kritikaliteten til hver Oracle-rolle.</p>",
				answerType: "oracle_roles",
				answer: null,
				choices: [],
				affectedControls: ["K-TS.01", "K-TS.02"],
				sortOrder: 4,
			},
			{
				id: "q-5",
				questionText: "Er applikasjonen eksponert eksternt?",
				descriptionHtml: null,
				answerType: "single_choice",
				answer: null,
				choices: [
					{ value: "ja", label: "Ja, tilgjengelig for eksterne brukere" },
					{ value: "intern", label: "Kun intern tilgang" },
				],
				affectedControls: ["K-ST.01"],
				sortOrder: 5,
			},
		],
		persistence: [
			{ type: "cloud_sql_postgres", name: "pensjon-sak-db", environment: "prod-gcp" },
			{ type: "oracle", name: "PENSJON_DB_01", environment: "on-prem" },
		],
		rulesetOptions: [
			{ id: "rs-1", name: "Standard sikkerhetskrav", controlCount: 5 },
			{ id: "rs-2", name: "Personvern-krav", controlCount: 3 },
		],
		entraGroupsData: {
			groups: [
				{ id: "g-1", displayName: "pensjon-sak-read", classification: "application_access" },
				{ id: "g-2", displayName: "pensjon-sak-admin", classification: "privileged_access" },
			],
			assessments: {
				"g-1": { criticality: "low" },
				"g-2": { criticality: "high" },
			},
		},
		oracleRolesData: {
			roles: [
				{ instanceId: "pensjon-db-01", roleName: "CONNECT", authType: "PASSWORD", common: true },
				{ instanceId: "pensjon-db-01", roleName: "DBA", authType: "PASSWORD", common: true },
				{ instanceId: "pensjon-db-01", roleName: "APP_USER", authType: null, common: false },
				{ instanceId: "pensjon-db-01", roleName: "BATCH_ROLE", authType: null, common: false },
			],
			assessments: {
				"pensjon-db-01:CONNECT": { criticality: "low", updatedBy: "Z990001", updatedAt: "2026-04-15T10:30:00Z" },
				"pensjon-db-01:DBA": { criticality: "very_high", updatedBy: "Z990001", updatedAt: "2026-04-15T10:31:00Z" },
			},
		},
	}
}

// ─── Oracle roller ──────────────────────────────────────────────────

export function mockOracleRollerData() {
	return {
		section: { id: "s-01", name: "Pensjon og uføre", slug: "pensjon-og-ufore" },
		seksjon: "pensjon-og-ufore",
		roles: [
			{
				instanceId: "pensjon-db-01",
				roleName: "CONNECT",
				applications: [
					{ applicationId: "app-1", applicationName: "pensjon-sak" },
					{ applicationId: "app-2", applicationName: "pensjon-vedtak" },
				],
				criticality: "low",
				assessedBy: "Z990001",
				assessedAt: "2026-04-15T10:30:00Z",
			},
			{
				instanceId: "pensjon-db-01",
				roleName: "DBA",
				applications: [{ applicationId: "app-1", applicationName: "pensjon-sak" }],
				criticality: "very_high",
				assessedBy: "Z990001",
				assessedAt: "2026-04-15T10:31:00Z",
			},
			{
				instanceId: "pensjon-db-02",
				roleName: "APP_USER",
				applications: [{ applicationId: "app-3", applicationName: "pensjon-batch" }],
				criticality: "high",
				assessedBy: "Z990001",
				assessedAt: "2026-04-15T10:32:00Z",
			},
		],
	}
}

// ─── Rutiner ────────────────────────────────────────────────────────

function mockRoutineBase(overrides: Partial<{
	id: string
	name: string
	description: string | null
	frequency: string | null
	eventFrequency: string | null
	status: string
	isSectionRoutine: number
	sectionRoutineOwnerRole: string | null
	appliesToAllInSection: number
	responsibleRole: string | null
	activityType: string | null
	screeningQuestionId: string | null
	screeningChoiceValue: string | null
	approvedBy: string | null
	approvedAt: string | null
	archivedAt: string | null
	archivedBy: string | null
	sourceRoutineId: string | null
	replacedByRoutineId: string | null
	replacedAt: string | null
	priority: number
}> = {}) {
	return {
		id: overrides.id ?? "routine-1",
		sectionId: "s-01",
		name: overrides.name ?? "Sikkerhetstesting av applikasjoner",
		description: overrides.description ?? "Gjennomfør sikkerhetstesting av alle produksjonsapplikasjoner",
		frequency: overrides.frequency ?? "quarterly",
		eventFrequency: overrides.eventFrequency ?? null,
		responsibleRole: overrides.responsibleRole ?? "Sikkerhetsansvarlig",
		appliesToAllInSection: overrides.appliesToAllInSection ?? 0,
		isSectionRoutine: overrides.isSectionRoutine ?? 0,
		sectionRoutineOwnerRole: overrides.sectionRoutineOwnerRole ?? null,
		screeningQuestionId: overrides.screeningQuestionId ?? null,
		screeningChoiceValue: overrides.screeningChoiceValue ?? null,
		activityType: overrides.activityType ?? null,
		status: overrides.status ?? "approved",
		priority: overrides.priority ?? 3,
		priorityUpdatedAt: "2026-01-15T10:00:00Z",
		priorityUpdatedBy: "Z990001",
		approvedBy: overrides.approvedBy ?? "Z990001",
		approvedAt: overrides.approvedAt ?? "2026-01-15T10:00:00Z",
		sourceRoutineId: overrides.sourceRoutineId ?? null,
		replacedByRoutineId: overrides.replacedByRoutineId ?? null,
		replacedAt: overrides.replacedAt ?? null,
		createdAt: "2025-12-01T08:00:00Z",
		createdBy: "Z990001",
		updatedAt: "2026-01-15T10:00:00Z",
		updatedBy: "Z990001",
		archivedAt: overrides.archivedAt ?? null,
		archivedBy: overrides.archivedBy ?? null,
	}
}

const mockSection = { id: "s-01", name: "Pensjon og uføre", slug: "pensjon-og-ufore" }

export function mockRutinerListData() {
	return {
		section: mockSection,
		routines: [
			{
				...mockRoutineBase({ id: "routine-1", name: "Sikkerhetstesting", status: "approved", frequency: "quarterly", priority: 1 }),
				technologyElements: [{ id: "te-1", name: "Applikasjon" }],
				persistenceLinks: [],
				reviewCount: 3,
				controls: [{ id: "c-1", controlId: "K-ST.01", name: "Sikkerhetstesting av applikasjoner" }],
			},
			{
				...mockRoutineBase({
					id: "routine-2",
					name: "Tilgangskontroll – gjennomgang",
					status: "approved",
					frequency: "semi_annually",
					isSectionRoutine: 1,
					sectionRoutineOwnerRole: "Seksjonsleder",
					appliesToAllInSection: 1,
					priority: 2,
				}),
				technologyElements: [],
				persistenceLinks: [],
				reviewCount: 1,
				controls: [{ id: "c-2", controlId: "K-TS.01", name: "Tilgangskontroll og autorisering" }],
			},
			{
				...mockRoutineBase({
					id: "routine-3",
					name: "Database-backup verifisering",
					status: "draft",
					frequency: "monthly",
					responsibleRole: "Utvikler",
				}),
				technologyElements: [
					{ id: "te-2", name: "Database" },
					{ id: "te-3", name: "PostgreSQL" },
				],
				persistenceLinks: [
					{ id: "pl-1", routineId: "routine-3", persistenceType: "cloud_sql_postgres", dataClassification: "internal", archivedAt: null, archivedBy: null, createdAt: "2025-12-01", createdBy: "Z990001", updatedAt: "2025-12-01", updatedBy: "Z990001" },
				],
				reviewCount: 0,
				controls: [{ id: "c-3", controlId: "K-TS.02", name: "Logging av tilgangsendringer" }],
			},
			{
				...mockRoutineBase({
					id: "routine-4",
					name: "DPIA-gjennomgang",
					status: "ready",
					frequency: "annually",
					isSectionRoutine: 1,
					sectionRoutineOwnerRole: "Teknologileder",
					appliesToAllInSection: 1,
				}),
				technologyElements: [],
				persistenceLinks: [],
				reviewCount: 0,
				controls: [{ id: "c-4", controlId: "K-PD.01", name: "Personvernkonsekvensvurdering (DPIA)" }],
			},
			{
				...mockRoutineBase({
					id: "routine-5",
					name: "Sikkerhetsgjennomgang ved endring",
					status: "approved",
					frequency: null,
					eventFrequency: "Ved endring",
				}),
				technologyElements: [{ id: "te-1", name: "Applikasjon" }],
				persistenceLinks: [],
				reviewCount: 2,
				controls: [{ id: "c-5", controlId: "K-ST.02", name: "Penetrasjonstesting" }],
			},
			{
				...mockRoutineBase({
					id: "routine-6",
					name: "Tilgangsgjennomgang",
					status: "approved",
					frequency: "semi_annually",
					eventFrequency: "Ved behov",
				}),
				technologyElements: [],
				persistenceLinks: [],
				reviewCount: 1,
				controls: [{ id: "c-6", controlId: "K-TS.01", name: "Tilgangskontroll og autorisering" }],
			},
		],
		allControls: [
			{ controlId: "K-ST.01", name: "Sikkerhetstesting av applikasjoner", technologyElements: ["Applikasjon"] },
			{ controlId: "K-ST.02", name: "Penetrasjonstesting", technologyElements: ["Applikasjon"] },
			{ controlId: "K-TS.01", name: "Tilgangskontroll og autorisering", technologyElements: ["Applikasjon", "API"] },
			{ controlId: "K-TS.02", name: "Logging av tilgangsendringer", technologyElements: ["Database"] },
			{ controlId: "K-PD.01", name: "Personvernkonsekvensvurdering (DPIA)", technologyElements: [] },
		],
		canAdmin: true,
	}
}

export function mockNyRutineData() {
	return {
		section: mockSection,
		screeningQuestions: [
			{
				id: "q-1",
				questionText: "Behandler applikasjonen personopplysninger?",
				sectionId: null,
				isSection: false,
				choices: [
					{ id: "ch-1", label: "Ja" },
					{ id: "ch-2", label: "Nei" },
				],
			},
			{
				id: "q-2",
				questionText: "Er applikasjonen et økonomisystem?",
				sectionId: "s-01",
				isSection: true,
				choices: [
					{ id: "ch-3", label: "Ja, klassifisert økonomisystem" },
					{ id: "ch-4", label: "Nei" },
				],
			},
		],
		technologyElements: [
			{ id: "te-1", name: "Applikasjon" },
			{ id: "te-2", name: "Database" },
			{ id: "te-3", name: "API" },
			{ id: "te-4", name: "Kafka" },
		],
		controls: [
			{ id: "c-1", controlId: "K-ST.01", name: "Sikkerhetstesting av applikasjoner", responsible: "Utviklerteam", frequency: "quarterly" as const },
			{ id: "c-2", controlId: "K-TS.01", name: "Tilgangskontroll og autorisering", responsible: "Sikkerhetsansvarlig", frequency: "semi_annually" as const },
			{ id: "c-3", controlId: "K-PD.01", name: "Personvernkonsekvensvurdering (DPIA)", responsible: "Produkteier", frequency: "annually" as const },
		],
	}
}

type RedigerRutineDataOverrides = {
	activityLinks?: string[]
	routine?: Partial<ReturnType<typeof mockRoutineBase>>
}

export function mockRedigerRutineData(overrides?: RedigerRutineDataOverrides) {
	return {
		seksjon: "pensjon-og-ufore",
		section: mockSection,
		routine: {
			...mockRoutineBase({
				id: "routine-1",
				name: "Sikkerhetstesting av applikasjoner",
				status: "approved",
				frequency: "quarterly",
				description: "Gjennomfør sikkerhetstesting inkludert OWASP Top 10 og SAST/DAST-skanning.",
			}),
			...overrides?.routine,
			controls: [
				{ id: "c-1", controlId: "K-ST.01", name: "Sikkerhetstesting av applikasjoner", responsible: "Utviklerteam" },
			],
			technologyElements: [{ id: "te-1", name: "Applikasjon" }],
			screeningQuestions: [],
			persistenceLinks: [],
			groupClassifications: [],
			oracleRoleCriticalities: [],
		},
		activityLinks: overrides?.activityLinks ?? [
			"oracle_evidence_audit",
			"entra_id_group_maintenance",
			"deployment_evidence_report",
		],
		questionsWithChoices: [
			{
				id: "q-1",
				questionText: "Behandler applikasjonen personopplysninger?",
				sectionId: null,
				isSection: false,
				choices: [
					{ id: "ch-1", label: "Ja" },
					{ id: "ch-2", label: "Nei" },
				],
			},
		],
		technologyElements: [
			{ id: "te-1", name: "Applikasjon" },
			{ id: "te-2", name: "Database" },
			{ id: "te-3", name: "API" },
		],
		controls: [
			{ id: "c-1", controlId: "K-ST.01", name: "Sikkerhetstesting av applikasjoner", responsible: "Utviklerteam", frequency: "quarterly" as const },
			{ id: "c-2", controlId: "K-TS.01", name: "Tilgangskontroll og autorisering", responsible: "Sikkerhetsansvarlig", frequency: "semi_annually" as const },
		],
		userCanApprove: true,
	}
}

export function mockRutineDetaljData(overrides?: {
	isSectionRoutine?: boolean
	eventOnly?: boolean
	dualFrequency?: boolean
	withFollowUp?: boolean
	replaced?: boolean
	isReplacement?: boolean
}) {
	const isSec = overrides?.isSectionRoutine ?? false
	const eventOnly = overrides?.eventOnly ?? false
	const dualFrequency = overrides?.dualFrequency ?? false
	const withFollowUp = overrides?.withFollowUp ?? false
	const replaced = overrides?.replaced ?? false
	const isReplacement = overrides?.isReplacement ?? false

	const frequency = eventOnly ? null : isSec ? "semi_annually" : "quarterly"
	const eventFrequency = eventOnly ? "Ved endring" : dualFrequency ? "Ved behov" : null

	const routine = {
		...mockRoutineBase({
			id: replaced ? "routine-old" : isReplacement ? "routine-new" : "routine-1",
			name: eventOnly
				? "Sikkerhetsgjennomgang ved endring"
				: isSec
					? "Tilgangskontroll – gjennomgang"
					: replaced
						? "Sikkerhetstesting av applikasjoner (gammel)"
						: isReplacement
							? "Sikkerhetstesting av applikasjoner v2"
							: "Sikkerhetstesting av applikasjoner",
			status: replaced ? "archived" : "approved",
			frequency,
			eventFrequency,
			isSectionRoutine: isSec ? 1 : 0,
			sectionRoutineOwnerRole: isSec ? "Seksjonsleder" : null,
			appliesToAllInSection: isSec ? 1 : 0,
			description: isSec
				? "Halvårlig gjennomgang av tilgangsrettigheter for alle applikasjoner i seksjonen."
				: "Gjennomfør sikkerhetstesting inkludert OWASP Top 10 og SAST/DAST-skanning.",
			archivedAt: replaced ? "2026-04-01T10:00:00Z" : null,
			archivedBy: replaced ? "Z990002" : null,
			replacedByRoutineId: replaced ? "routine-new" : null,
			sourceRoutineId: isReplacement ? "routine-old" : null,
		}),
		controls: [
			{
				id: "c-1",
				controlId: isSec ? "K-TS.01" : "K-ST.01",
				name: isSec ? "Tilgangskontroll og autorisering" : "Sikkerhetstesting av applikasjoner",
				responsible: isSec ? "Sikkerhetsansvarlig" : "Utviklerteam",
				domainSlug: isSec ? "TS" : "ST",
			},
		],
		technologyElements: isSec ? [] : [{ id: "te-1", name: "Applikasjon" }],
		persistenceLinks: [],
		groupClassifications: [],
	}

	const reviews = isSec
		? [
				{
					id: "rev-1",
					routineId: "routine-1",
					applicationId: null,
					applicationName: null,
					title: "Tilgangskontroll H1 2026",
					reviewedAt: "2026-03-15T09:00:00Z",
					status: (withFollowUp ? "needs_follow_up" : "completed") as
						| "completed"
						| "needs_follow_up"
						| "draft"
						| "discarded",
					createdBy: "Z990001",
					participants: [{ confirmedAt: "2026-03-15T09:30:00Z" }, { confirmedAt: null }],
					attachments: [],
				},
			]
		: [
				{
					id: "rev-1",
					routineId: "routine-1",
					applicationId: "app-1",
					applicationName: "pensjon-sak",
					title: "Sikkerhetstesting Q1 2026",
					reviewedAt: "2026-03-01T10:00:00Z",
					status: (withFollowUp ? "needs_follow_up" : "completed") as
						| "completed"
						| "needs_follow_up"
						| "draft"
						| "discarded",
					createdBy: "Z990001",
					participants: [{ confirmedAt: "2026-03-01T11:00:00Z" }],
					attachments: [],
				},
				{
					id: "rev-2",
					routineId: "routine-1",
					applicationId: "app-2",
					applicationName: "psak-frontend",
					title: "Sikkerhetstesting Q1 2026",
					reviewedAt: "2026-02-20T14:00:00Z",
					status: "completed" as const,
					createdBy: "Z990002",
					participants: [],
					attachments: [],
				},
				{
					id: "rev-3",
					routineId: "routine-1",
					applicationId: "app-1",
					applicationName: "pensjon-sak",
					title: "Sikkerhetstesting Q4 2025 (forkastet)",
					reviewedAt: "2025-12-15T10:00:00Z",
					status: "discarded" as const,
					createdBy: "Z990001",
					participants: [],
					attachments: [],
				},
			]

	const appsWithDeadlines = eventOnly
		? [
				{
					id: "app-1",
					name: "pensjon-sak",
					lastReviewDate: "2026-04-10T09:00:00Z",
					deadline: null,
					overdue: false,
					needsFollowUp: false,
					latestReviewId: "rev-1",
					neverReviewed: false,
				},
				{
					id: "app-2",
					name: "psak-frontend",
					lastReviewDate: null,
					deadline: null,
					overdue: false,
					needsFollowUp: false,
					latestReviewId: null,
					neverReviewed: true,
				},
			]
		: [
		{
			id: "app-1",
			name: "pensjon-sak",
			lastReviewDate: isSec ? "2026-03-15T09:00:00Z" : "2026-03-01T10:00:00Z",
			deadline: "2026-06-01T10:00:00Z",
			overdue: false,
			needsFollowUp: withFollowUp,
			latestReviewId: "rev-1",
			neverReviewed: false,
		},
		{
			id: "app-2",
			name: "psak-frontend",
			lastReviewDate: isSec ? "2026-03-15T09:00:00Z" : "2026-02-20T14:00:00Z",
			deadline: isSec ? "2026-09-15T09:00:00Z" : "2026-05-20T14:00:00Z",
			overdue: !isSec,
			needsFollowUp: false,
			latestReviewId: "rev-2",
			neverReviewed: false,
		},
		{
			id: "app-3",
			name: "pensjon-selvbetjening",
			lastReviewDate: null,
			deadline: "2026-03-01T08:00:00Z",
			overdue: true,
			needsFollowUp: false,
			latestReviewId: null,
			neverReviewed: true,
		},
	]

	return {
		section: mockSection,
		routine,
		reviews,
		appsWithDeadlines,
		screeningQuestion: null,
		descriptionHtml: eventOnly
			? "<p>Gjennomfør sikkerhetsgjennomgang ved alle endringer i applikasjonens kildekode eller konfigurasjon.</p>"
			: isSec
				? "<p>Halvårlig gjennomgang av tilgangsrettigheter for alle applikasjoner i seksjonen.</p>"
				: "<p>Gjennomfør sikkerhetstesting inkludert OWASP Top 10 og SAST/DAST-skanning.</p>",
		userCanApprove: true,
		userCanAdmin: true,
		userCanEdit: true,
		userCanChangePriority: true,
		effectiveRole: isSec ? "Seksjonsleder" : "Sikkerhetsansvarlig",
		predecessorInfo: isReplacement ? { name: "Sikkerhetstesting av applikasjoner (gammel)", status: "archived" } : null,
		successorInfo: replaced ? { name: "Sikkerhetstesting av applikasjoner v2", status: "approved" } : null,
	}
}

export function mockSeksjonsrutinerData() {
	const now = new Date()
	const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()).toISOString()
	const sixMonthsFromNow = new Date(now.getFullYear(), now.getMonth() + 6, now.getDate()).toISOString()
	const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, now.getDate()).toISOString()

	return {
		section: mockSection,
		seksjon: "pensjon-og-ufore",
		sectionRoutines: [
			{
				routine: mockRoutineBase({
					id: "routine-2",
					name: "Tilgangskontroll – gjennomgang",
					status: "approved",
					frequency: "semi_annually",
					isSectionRoutine: 1,
					sectionRoutineOwnerRole: "Seksjonsleder",
					appliesToAllInSection: 1,
				}),
				lastReview: {
					routineId: "routine-2",
					reviewedAt: threeMonthsAgo,
					reviewId: "rev-sec-1",
					title: "Tilgangskontroll H1 2026",
					status: "completed",
					createdBy: "Z990001",
				},
				lastReviewDate: threeMonthsAgo,
				deadline: sixMonthsFromNow,
				overdue: false,
			},
			{
				routine: mockRoutineBase({
					id: "routine-4",
					name: "DPIA-gjennomgang",
					status: "approved",
					frequency: "annually",
					isSectionRoutine: 1,
					sectionRoutineOwnerRole: "Teknologileder",
					appliesToAllInSection: 1,
				}),
				lastReview: null,
				lastReviewDate: null,
				deadline: twoMonthsAgo,
				overdue: true,
			},
			{
				routine: mockRoutineBase({
					id: "routine-5",
					name: "Beredskapsøvelse",
					status: "approved",
					frequency: "annually",
					isSectionRoutine: 1,
					sectionRoutineOwnerRole: "Seksjonsleder",
					appliesToAllInSection: 1,
				}),
				lastReview: {
					routineId: "routine-5",
					reviewedAt: twoMonthsAgo,
					reviewId: "rev-sec-2",
					title: "Beredskapsøvelse 2026",
					status: "completed",
					createdBy: "Z990002",
				},
				lastReviewDate: twoMonthsAgo,
				deadline: new Date(now.getFullYear() + 1, now.getMonth() - 2, now.getDate()).toISOString(),
				overdue: false,
			},
			{
				routine: mockRoutineBase({
					id: "routine-6",
					name: "Hendelseshåndtering",
					status: "approved",
					frequency: null,
					eventFrequency: "Ved sikkerhetshendelse",
					isSectionRoutine: 1,
					sectionRoutineOwnerRole: "Seksjonsleder",
					appliesToAllInSection: 1,
				}),
				lastReview: null,
				lastReviewDate: null,
				deadline: null,
				overdue: false,
			},
			{
				routine: mockRoutineBase({
					id: "routine-7",
					name: "Revisjon av tilgangsrettigheter",
					status: "approved",
					frequency: "quarterly",
					eventFrequency: "Ved behov",
					isSectionRoutine: 1,
					sectionRoutineOwnerRole: "Teknologileder",
					appliesToAllInSection: 1,
				}),
				lastReview: {
					routineId: "routine-7",
					reviewedAt: twoMonthsAgo,
					reviewId: "rev-sec-3",
					title: "Tilgangsrevisjon Q1 2026",
					status: "completed",
					createdBy: "Z990001",
				},
				lastReviewDate: twoMonthsAgo,
				deadline: new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()).toISOString(),
				overdue: false,
			},
		],
	}
}

export function mockNyGjennomgangData(overrides?: { isSectionRoutine?: boolean; loaderConflictError?: string | null }) {
	const isSec = overrides?.isSectionRoutine ?? false
	return {
		section: mockSection,
		routine: mockRoutineBase({
			id: "routine-1",
			name: isSec ? "Tilgangskontroll – gjennomgang" : "Sikkerhetstesting av applikasjoner",
			status: "approved",
			isSectionRoutine: isSec ? 1 : 0,
			sectionRoutineOwnerRole: isSec ? "Seksjonsleder" : null,
		}),
		apps: isSec
			? []
			: [
					{ id: "app-1", name: "pensjon-sak" },
					{ id: "app-2", name: "psak-frontend" },
					{ id: "app-3", name: "pensjon-selvbetjening" },
				],
		loaderConflictError: overrides?.loaderConflictError ?? null,
	}
}

// ─── Dokumenter ─────────────────────────────────────────────────────

export function mockDokumenterData() {
	return {
		documents: [
			{
				id: "doc-1",
				title: "Compliance-rapport Q1 2026",
				originalFileName: "compliance-rapport-q1-2026.pdf",
				contentType: "application/pdf",
				sizeBytes: 2_450_000,
				uploadedAt: "2026-03-31T12:00:00Z",
				description: "Kvartalsvis compliance-rapport for pensjon og uføre",
				archivedAt: null,
				archivedBy: null,
			},
			{
				id: "doc-2",
				title: "Sikkerhetstesting – resultater",
				originalFileName: "pentest-resultater-2026.pdf",
				contentType: "application/pdf",
				sizeBytes: 8_120_000,
				uploadedAt: "2026-02-15T09:30:00Z",
				description: "Resultater fra ekstern penetrasjonstesting",
				archivedAt: null,
				archivedBy: null,
			},
			{
				id: "doc-3",
				title: "ROS-analyse 2025",
				originalFileName: "ros-analyse-2025.xlsx",
				contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
				sizeBytes: 540_000,
				uploadedAt: "2025-12-01T14:00:00Z",
				description: null,
				archivedAt: "2026-01-15T08:00:00Z",
				archivedBy: "Z990001",
			},
		],
	}
}

// ─── Admin import ───────────────────────────────────────────────────

export function mockAdminImportData() {
	return {
		versions: [
			{
				id: "v-2",
				name: "MKR v2.1",
				description: "Oppdatert kontrollrammeverk med nye DPIA-kontroller",
				sourceFileName: "mkr-v2.1.xlsx",
				sourceBucketPath: "imports/mkr-v2.1.xlsx",
				status: "applied" as const,
				activatedAt: "2026-02-01T10:00:00Z",
				activatedBy: "Z990001",
				createdAt: "2026-02-01T09:00:00Z",
				createdBy: "Z990001",
			},
			{
				id: "v-1",
				name: "MKR v2.0",
				description: "Første import av kontrollrammeverket",
				sourceFileName: "mkr-v2.0.xlsx",
				sourceBucketPath: "imports/mkr-v2.0.xlsx",
				status: "superseded" as const,
				activatedAt: "2025-09-15T08:00:00Z",
				activatedBy: "Z990001",
				createdAt: "2025-09-15T07:30:00Z",
				createdBy: "Z990001",
			},
		],
		auditEntries: [
			{
				id: "a-1",
				action: "framework_import_activated",
				entityType: "framework_version",
				entityId: "v-2",
				previousValue: null,
				newValue: "MKR v2.1",
				metadata: null,
				performedBy: "Z990001",
				performedAt: "2026-02-01T10:00:00Z",
			},
			{
				id: "a-2",
				action: "framework_import_staged",
				entityType: "framework_version",
				entityId: "v-2",
				previousValue: null,
				newValue: "mkr-v2.1.xlsx",
				metadata: null,
				performedBy: "Z990001",
				performedAt: "2026-02-01T09:00:00Z",
			},
		],
		pendingImport: null,
	}
}

// ─── Gjennomgang detalj ─────────────────────────────────────────────

type GjennomgangDetaljStatus = "draft" | "needs_follow_up" | "completed" | "discarded"

export function mockGjennomgangDetaljData(overrides?: {
	status?: GjennomgangDetaljStatus
	followUpPoints?: "none" | "mixed" | "all_open" | "all_resolved"
}) {
	const status = overrides?.status ?? "draft"
	const followUpVariant = overrides?.followUpPoints ?? (status === "draft" ? "none" : "mixed")

	const allPoints = [
		{
			id: "fup-1",
			text: "Oppgradere kritiske avhengigheter til siste versjon",
			description:
				"Spring Boot og en del transitive avhengigheter har kjente CVE-er. Må oppgraderes og verifiseres med ny pentest-runde.",
			resolution: null as string | null,
			status: "needs_follow_up" as const,
			createdBy: "Z990001",
			createdAt: "2026-03-01T10:30:00Z",
			updatedBy: "Z990001",
			updatedAt: "2026-03-01T10:30:00Z",
			resolvedAt: null as string | null,
			resolvedBy: null as string | null,
			attachments: [] as Array<{
				id: string
				kind: "description" | "resolution"
				fileName: string
				contentType: string
				sizeBytes: number | null
				uploadedBy: string
				uploadedAt: string
			}>,
		},
		{
			id: "fup-2",
			text: "Verifisere at logging av sensitive felt er fjernet",
			description: "Funn 2 fra pentest-rapporten — sjekkes etter neste deploy.",
			resolution: "Bekreftet i kode-review at logging er fjernet og verifisert i preprod 2026-03-10.",
			status: "completed" as const,
			createdBy: "Z990001",
			createdAt: "2026-03-01T10:35:00Z",
			updatedBy: "Z990002",
			updatedAt: "2026-03-10T14:20:00Z",
			resolvedAt: "2026-03-10T14:20:00Z",
			resolvedBy: "Z990002",
			attachments: [],
		},
		{
			id: "fup-3",
			text: "Vurdere SAST-skanning i CI",
			description: "Vurdert som del av sikkerhetsforbedringer Q1 — sjekk om vi trenger ytterligere SAST-verktøy.",
			resolution: "Ikke relevant — vi bruker allerede CodeQL via GitHub Advanced Security.",
			status: "not_relevant" as const,
			createdBy: "Z990001",
			createdAt: "2026-03-01T10:40:00Z",
			updatedBy: "Z990001",
			updatedAt: "2026-03-02T09:00:00Z",
			resolvedAt: "2026-03-02T09:00:00Z",
			resolvedBy: "Z990001",
			attachments: [],
		},
	]

	const followUpPoints =
		followUpVariant === "none"
			? []
			: followUpVariant === "all_open"
				? allPoints.map((p) => ({
						...p,
						status: "needs_follow_up" as const,
						resolution: null,
						resolvedAt: null,
						resolvedBy: null,
					}))
				: followUpVariant === "all_resolved"
					? allPoints.map((p) =>
							p.status === "needs_follow_up"
								? {
										...p,
										status: "completed" as const,
										resolution: "Adressert og verifisert.",
										resolvedAt: "2026-03-15T12:00:00Z",
										resolvedBy: "Z990001",
									}
								: p,
						)
					: allPoints

	const mockControls = [
		{
			id: "c-1",
			controlId: "K-ST.01",
			name: "Sikkerhetstesting av applikasjoner",
			responsible: "Sikkerhetsansvarlig",
			domainSlug: "sikkerhetstesting",
		},
		{
			id: "c-2",
			controlId: "K-ST.03",
			name: "Sårbarhetsskanning",
			responsible: "Utviklingsteamet",
			domainSlug: "sikkerhetstesting",
		},
	]

	const mockLinkedRulesets = [
		{
			id: "rs-1",
			code: "RS-ST.01",
			name: "Regelsett for sikkerhetstesting",
			description:
				"## Krav til sikkerhetstesting\n\nAlle produksjonsapplikasjoner skal gjennomgå sikkerhetstesting minst én gang per kvartal.\n\n### Omfang\n- Automatiserte DAST-skanninger\n- Manuell kodegjennomgang av kritiske moduler\n- Verifisering av avhengigheter (SCA)",
			descriptionHtml:
				"<h2>Krav til sikkerhetstesting</h2><p>Alle produksjonsapplikasjoner skal gjennomgå sikkerhetstesting minst én gang per kvartal.</p><h3>Omfang</h3><ul><li>Automatiserte DAST-skanninger</li><li>Manuell kodegjennomgang av kritiske moduler</li><li>Verifisering av avhengigheter (SCA)</li></ul>",
			frequency: "quarterly",
			status: "active",
			responsibleName: "Glad Fjord",
			responsibleRole: "Sikkerhetsansvarlig",
			approvalStatus: "valid",
			lastApproval: { validFrom: "2026-04-15T10:00:00Z", validUntil: "2026-07-15T10:00:00Z" },
			controls: [
				{ id: "c-1", controlId: "K-ST.01", shortTitle: "Sikkerhetstesting av applikasjoner" },
				{ id: "c-2", controlId: "K-ST.03", shortTitle: "Sårbarhetsskanning" },
			],
		},
	]

	return {
		section: mockSection,
		routine: {
			...mockRoutineBase({
				id: "routine-1",
				name: "Sikkerhetstesting av applikasjoner",
				status: "approved",
				frequency: "quarterly",
				description:
					"## Formål\nSikre at alle produksjonsapplikasjoner gjennomgår jevnlig sikkerhetstesting.\n\n## Fremgangsmåte\n1. Kjør automatiserte sikkerhetstester\n2. Gjennomgå rapporter fra verktøy\n3. Verifiser at funn er adressert\n4. Dokumenter resultater",
			}),
			controls: mockControls,
		},
		routineDescriptionHtml:
			"<h2>Formål</h2><p>Sikre at alle produksjonsapplikasjoner gjennomgår jevnlig sikkerhetstesting.</p><h2>Fremgangsmåte</h2><ol><li>Kjør automatiserte sikkerhetstester</li><li>Gjennomgå rapporter fra verktøy</li><li>Verifiser at funn er adressert</li><li>Dokumenter resultater</li></ol>",
		linkedRulesets: mockLinkedRulesets,
		activities: [],
		activityLinks: [],
		review: {
			id: "rev-1",
			routineId: "routine-1",
			title: "Sikkerhetstesting Q1 2026",
			status,
			summary: "## Funn\n- Ingen kritiske sårbarheter\n- 2 middels alvorlige funn\n\n## Tiltak\n- Oppgradere avhengigheter",
			summaryHtml:
				"<h2>Funn</h2><ul><li>Ingen kritiske sårbarheter</li><li>2 middels alvorlige funn</li></ul><h2>Tiltak</h2><ul><li>Oppgradere avhengigheter</li></ul>",
			applicationId: "app-1",
			applicationName: "pensjon-sak",
			reviewedAt: "2026-03-01T10:00:00Z",
			createdAt: "2026-02-28T14:00:00Z",
			createdBy: "Z990001",
			sectionId: null,
			participants: [
				{
					id: "p-1",
					userIdent: "Z990001",
					userName: "Glad Fjord",
					role: "Sikkerhetsansvarlig",
					confirmedAt: "2026-03-01T11:00:00Z",
				},
				{
					id: "p-2",
					userIdent: "Z990002",
					userName: "Modig Bjørk",
					role: "Utvikler",
					confirmedAt: null,
				},
			],
			attachments: [
				{
					id: "att-1",
					fileName: "pentest-rapport.pdf",
					contentType: "application/pdf",
					sizeBytes: 3_400_000,
					sourceType: "manual",
					uploadedAt: "2026-03-01T09:30:00Z",
					uploadedBy: "Z990001",
				},
			],
			links: [
				{
					id: "link-1",
					url: "https://jira.nav.no/browse/PEN-1234",
					title: "Jira: Oppgradere avhengigheter",
					addedAt: "2026-03-01T10:15:00Z",
					addedBy: "Z990001",
				},
			],
			followUpPoints,
		},
	}
}

// ─── Oracle Evidence ───────────────────────────────────────────────

export function mockOracleEvidenceActivity(overrides?: Partial<{ status: string; completedAt: string | null }>) {
	return {
		id: "activity-oracle-1",
		type: "oracle_evidence_audit" as const,
		status: overrides?.status ?? "pending",
		completedAt: overrides?.completedAt ?? null,
		createdAt: "2026-03-01T08:00:00Z",
	}
}

export function mockOracleEvidenceData(overrides?: Partial<{ evidenceTypes: string[]; withDownloads: boolean }>) {
	const downloads = overrides?.withDownloads
		? [
				{
					id: "dl-1",
					instanceId: "PENSJON_PROD",
					evidenceType: "audit",
					format: "EXCEL",
					fileName: "oracle-audit-2026-03-01.xlsx",
					sizeBytes: 1_200_000,
					source: "m2m_api",
					apiInstanceName: "PENSJON_PROD",
					forceFetchJustification: null,
					performedBy: "Z990001",
					performedAt: "2026-03-01T10:30:00Z",
				},
				{
					id: "dl-2",
					instanceId: "PENSJON_PROD",
					evidenceType: "audit",
					format: "PDF",
					fileName: "oracle-audit-manuell.pdf",
					sizeBytes: 800_000,
					source: "manual_upload",
					apiInstanceName: null,
					forceFetchJustification: null,
					performedBy: "Z990002",
					performedAt: "2026-03-02T14:00:00Z",
				},
				{
					id: "dl-3",
					instanceId: "PENSJON_PROD",
					evidenceType: "audit",
					format: "EXCEL",
					fileName: "oracle-audit-tvang-2026-03-03.xlsx",
					sizeBytes: 1_500_000,
					source: "m2m_api",
					apiInstanceName: "PENSJON_PROD",
					forceFetchJustification:
						"Bevis hentet før gjennomgang er fullført for å sikre fremdrift i revisjonsarbeidet",
					performedBy: "Z990001",
					performedAt: "2026-03-03T09:00:00Z",
				},
			]
		: []

	return {
		configuredInstances: [{ instanceId: "PENSJON_PROD" }, { instanceId: "PENSJON_TEST" }],
		downloads,
		evidenceTypes: overrides?.evidenceTypes ?? ["audit"],
	}
}

export function mockGjennomgangDetaljOracleEvidenceData(overrides?: {
	evidenceTypes?: string[]
	withDownloads?: boolean
	activityStatus?: string
}) {
	const activity = mockOracleEvidenceActivity({ status: overrides?.activityStatus })
	return {
		...mockGjennomgangDetaljData(),
		activities: [
			{
				...activity,
				changes: [],
				providerConfig: null,
				periodConfig: null,
				entraGroupsData: null,
				rpaMaintenanceData: null,
				oracleEvidenceData: {
					...mockOracleEvidenceData({
						evidenceTypes: overrides?.evidenceTypes,
						withDownloads: overrides?.withDownloads,
					}),
					selectedInstanceId: "PENSJON_PROD",
				},
				ndaEvidenceData: null,
				evidenceProviderType: "oracle",
			},
		],
		activityLinks: [{ id: "link-oracle-1", activityType: "oracle_evidence_audit" }],
	}
}

export function mockGjennomgangMultiActivityData(overrides?: { status?: GjennomgangDetaljStatus }) {
	const oracleActivity = {
		id: "activity-oracle-1",
		type: "oracle_evidence_audit",
		status: "completed",
		completedAt: "2026-03-02T11:00:00Z",
		createdAt: "2026-03-01T08:00:00Z",
		changes: [],
		providerConfig: null,
		periodConfig: null,
		entraGroupsData: null,
		oracleEvidenceData: {
			...mockOracleEvidenceData({ evidenceTypes: ["audit"], withDownloads: true }),
			selectedInstanceId: "PENSJON_PROD",
		},
		ndaEvidenceData: null,
		rpaMaintenanceData: null,
		evidenceProviderType: "oracle",
	}

	const entraActivity = {
		id: "activity-entra-1",
		type: "entra_id_group_maintenance",
		status: "pending",
		completedAt: null,
		createdAt: "2026-03-01T08:00:00Z",
		changes: [
			{
				id: "ch-1",
				changeType: "member_added",
				groupId: "g-1",
				groupName: "0000-GA-PENSJON_SAKSBEHANDLER",
				previousValue: null,
				newValue: "Z994433 (Varm Solstråle)",
				performedBy: "Z990001",
				performedAt: "2026-03-01T09:00:00Z",
			},
			{
				id: "ch-2",
				changeType: "member_removed",
				groupId: "g-2",
				groupName: "0000-GA-PENSJON_ADMIN",
				previousValue: "Z995544 (Klok Ugle)",
				newValue: null,
				performedBy: "Z990001",
				performedAt: "2026-03-01T09:05:00Z",
			},
		],
		providerConfig: null,
		periodConfig: null,
		entraGroupsData: {
			groups: [
				{
					groupId: "g-1",
					groupName: "0000-GA-PENSJON_SAKSBEHANDLER",
					source: "nais_auth" as const,
					hasNaisSource: true,
					hasManualSource: false,
					isGone: false,
					isNewAssessment: false,
					isAddedDuringReview: false,
					criticality: "medium",
				},
				{
					groupId: "g-2",
					groupName: "0000-GA-PENSJON_ADMIN",
					source: "nais_auth" as const,
					hasNaisSource: true,
					hasManualSource: false,
					isGone: false,
					isNewAssessment: false,
					isAddedDuringReview: false,
					criticality: "very_high",
				},
				{
					groupId: "g-3",
					groupName: "0000-GA-PENSJON_SPESIAL",
					source: "manual" as const,
					hasNaisSource: false,
					hasManualSource: true,
					isGone: false,
					isNewAssessment: false,
					isAddedDuringReview: false,
					criticality: null,
				},
			],
		},
		oracleEvidenceData: null,
		ndaEvidenceData: null,
		rpaMaintenanceData: null,
		evidenceProviderType: null,
	}

	const deploymentActivity = {
		id: "activity-deploy-1",
		type: "deployment_evidence_report",
		status: "pending",
		completedAt: null,
		createdAt: "2026-03-01T08:00:00Z",
		changes: [],
		providerConfig: null,
		periodConfig: { periodType: "quarterly", periodStart: "2026-01-01" },
		entraGroupsData: null,
		oracleEvidenceData: null,
		ndaEvidenceData: {
			appParams: { team: "starte-pensjon", environment: "prod", appName: "pensjon-sak" },
			periodConfig: { periodType: "quarterly", periodStart: "2026-01-01" },
			downloads: [
				{
					id: "dl-nda-1",
					format: "PDF",
					fileName: "deployment-report-Q1-2026.pdf",
					sizeBytes: 450_000,
					source: "m2m_api",
					forceFetchJustification: null,
					performedBy: "system",
					performedAt: "2026-03-01T10:00:00Z",
				},
			],
		},
		rpaMaintenanceData: null,
		evidenceProviderType: "deployments",
	}

	return {
		...mockGjennomgangDetaljData({ status: overrides?.status }),
		activities: [oracleActivity, entraActivity, deploymentActivity],
		activityLinks: [
			{ id: "link-oracle-1", activityType: "oracle_evidence_audit" },
			{ id: "link-entra-1", activityType: "entra_id_group_maintenance" },
			{ id: "link-deploy-1", activityType: "deployment_evidence_report" },
		],
	}
}

// ─── RPA-brukere ────────────────────────────────────────────────────

export function mockRpaUsers() {
	return [
		{
			rpaGroupId: "rpa-g-1",
			rpaGroupName: "Pensjon-RPA-Gruppe",
			entraGroupId: "entra-rpa-1",
			matchSource: "nais" as const,
			matchedGroupId: "nais-group-1",
			matchedGroupName: "0000-GA-PENSJON_SAKSBEHANDLER",
			userObjectId: "user-rpa-1",
			displayName: "SVC-Pensjon-Robot-01",
			userPrincipalName: "svc-pensjon-robot-01@nav.no",
			accountEnabled: true,
			syncedAt: "2026-05-10T08:30:00.000Z",
		},
		{
			rpaGroupId: "rpa-g-1",
			rpaGroupName: "Pensjon-RPA-Gruppe",
			entraGroupId: "entra-rpa-1",
			matchSource: "nais" as const,
			matchedGroupId: "nais-group-1",
			matchedGroupName: "0000-GA-PENSJON_SAKSBEHANDLER",
			userObjectId: "user-rpa-2",
			displayName: "SVC-Pensjon-Robot-02",
			userPrincipalName: "svc-pensjon-robot-02@nav.no",
			accountEnabled: false,
			syncedAt: "2026-05-10T08:30:00.000Z",
		},
		{
			rpaGroupId: "rpa-g-2",
			rpaGroupName: "Uføre-RPA-Gruppe",
			entraGroupId: "entra-rpa-2",
			matchSource: "manual" as const,
			matchedGroupId: "manual-group-1",
			matchedGroupName: "0000-GA-UFORE_SAKSBEHANDLER",
			userObjectId: "user-rpa-3",
			displayName: "SVC-Ufore-Robot-01",
			userPrincipalName: "svc-ufore-robot-01@nav.no",
			accountEnabled: true,
			syncedAt: "2026-05-09T14:20:00.000Z",
		},
		{
			rpaGroupId: "rpa-g-2",
			rpaGroupName: "Uføre-RPA-Gruppe",
			entraGroupId: "entra-rpa-2",
			matchSource: "manual" as const,
			matchedGroupId: "manual-group-1",
			matchedGroupName: "0000-GA-UFORE_SAKSBEHANDLER",
			userObjectId: "user-rpa-1",
			displayName: "SVC-Pensjon-Robot-01",
			userPrincipalName: "svc-pensjon-robot-01@nav.no",
			accountEnabled: true,
			syncedAt: "2026-05-09T14:20:00.000Z",
		},
	]
}

export function mockRpaSectionData(overrides?: Record<string, unknown>) {
	return {
		seksjon: "pensjon-og-ufore",
		seksjonName: "Pensjon og uføre",
		rpaUsers: [
			{
				userObjectId: "user-rpa-1",
				displayName: "SVC-Pensjon-Robot-01",
				userPrincipalName: "svc-pensjon-robot-01@nav.no",
				accountEnabled: true,
				syncedAt: "2026-05-10T08:30:00.000Z",
				rpaGroupId: "rpa-g-1",
				rpaGroupName: "Pensjon-RPA-Gruppe",
				entraGroupId: "entra-rpa-1",
				applications: [
					{ applicationId: "app-1", applicationName: "pensjon-sak", matchSource: "nais" as const },
					{ applicationId: "app-2", applicationName: "pensjon-frontend", matchSource: "nais" as const },
				],
			},
			{
				userObjectId: "user-rpa-2",
				displayName: "SVC-Pensjon-Robot-02",
				userPrincipalName: "svc-pensjon-robot-02@nav.no",
				accountEnabled: false,
				syncedAt: "2026-05-10T08:30:00.000Z",
				rpaGroupId: "rpa-g-1",
				rpaGroupName: "Pensjon-RPA-Gruppe",
				entraGroupId: "entra-rpa-1",
				applications: [
					{ applicationId: "app-1", applicationName: "pensjon-sak", matchSource: "nais" as const },
				],
			},
			{
				userObjectId: "user-rpa-3",
				displayName: "SVC-Ufore-Robot-01",
				userPrincipalName: "svc-ufore-robot-01@nav.no",
				accountEnabled: true,
				syncedAt: "2026-05-09T14:20:00.000Z",
				rpaGroupId: "rpa-g-2",
				rpaGroupName: "Uføre-RPA-Gruppe",
				entraGroupId: "entra-rpa-2",
				applications: [
					{ applicationId: "app-3", applicationName: "uforetrygd-api", matchSource: "manual" as const },
				],
			},
			{
				userObjectId: "user-rpa-4",
				displayName: null,
				userPrincipalName: null,
				accountEnabled: null,
				syncedAt: "2026-05-08T10:00:00.000Z",
				rpaGroupId: "rpa-g-3",
				rpaGroupName: "Felles-RPA-Gruppe",
				entraGroupId: "entra-rpa-3",
				applications: [
					{ applicationId: "app-1", applicationName: "pensjon-sak", matchSource: "nais" as const },
					{ applicationId: "app-2", applicationName: "pensjon-frontend", matchSource: "nais" as const },
					{ applicationId: "app-3", applicationName: "uforetrygd-api", matchSource: "manual" as const },
					{ applicationId: "app-4", applicationName: "ufore-backend", matchSource: "nais" as const },
				],
			},
			{
				userObjectId: "user-rpa-1",
				displayName: "SVC-Pensjon-Robot-01",
				userPrincipalName: "svc-pensjon-robot-01@nav.no",
				accountEnabled: true,
				syncedAt: "2026-05-09T14:20:00.000Z",
				rpaGroupId: "rpa-g-2",
				rpaGroupName: "Uføre-RPA-Gruppe",
				entraGroupId: "entra-rpa-2",
				applications: [
					{ applicationId: "app-3", applicationName: "uforetrygd-api", matchSource: "manual" as const },
				],
			},
		],
		...overrides,
	}
}

export function mockAdminRpaGrupperData(overrides?: Record<string, unknown>) {
	return {
		groups: [
			{
				id: "rpa-g-1",
				groupId: "entra-rpa-1",
				groupName: "Pensjon-RPA-Gruppe",
				createdBy: "Z990001",
				createdAt: "2026-04-01T10:00:00.000Z",
				updatedAt: "2026-05-10T08:30:00.000Z",
				memberCount: 3,
				lastSyncedAt: "2026-05-10T08:30:00.000Z",
			},
			{
				id: "rpa-g-2",
				groupId: "entra-rpa-2",
				groupName: "Uføre-RPA-Gruppe",
				createdBy: "A654321",
				createdAt: "2026-04-05T14:00:00.000Z",
				updatedAt: "2026-05-09T14:20:00.000Z",
				memberCount: 1,
				lastSyncedAt: "2026-05-09T14:20:00.000Z",
			},
			{
				id: "rpa-g-3",
				groupId: "entra-rpa-3",
				groupName: "Felles-RPA-Gruppe",
				createdBy: "Z990001",
				createdAt: "2026-03-15T09:00:00.000Z",
				updatedAt: "2026-05-08T10:00:00.000Z",
				memberCount: 5,
				lastSyncedAt: "2026-05-08T10:00:00.000Z",
			},
		],
		members: [
			{
				id: "m-1",
				userObjectId: "user-obj-1",
				displayName: "RPA Pensjon Bot",
				userPrincipalName: "rpa-pensjon@nav.no",
				accountEnabled: true,
				syncedAt: "2026-05-10T08:30:00.000Z",
				rpaGroupId: "rpa-g-1",
				rpaGroupName: "Pensjon-RPA-Gruppe",
			},
			{
				id: "m-2",
				userObjectId: "user-obj-2",
				displayName: "RPA Uføre Bot",
				userPrincipalName: "rpa-ufore@nav.no",
				accountEnabled: true,
				syncedAt: "2026-05-10T08:30:00.000Z",
				rpaGroupId: "rpa-g-1",
				rpaGroupName: "Pensjon-RPA-Gruppe",
			},
			{
				id: "m-3",
				userObjectId: "user-obj-2",
				displayName: "RPA Uføre Bot",
				userPrincipalName: "rpa-ufore@nav.no",
				accountEnabled: true,
				syncedAt: "2026-05-09T14:20:00.000Z",
				rpaGroupId: "rpa-g-2",
				rpaGroupName: "Uføre-RPA-Gruppe",
			},
			{
				id: "m-4",
				userObjectId: "user-obj-3",
				displayName: "RPA Saksbehandler",
				userPrincipalName: "rpa-saksbehandler@nav.no",
				accountEnabled: false,
				syncedAt: "2026-05-10T08:30:00.000Z",
				rpaGroupId: "rpa-g-1",
				rpaGroupName: "Pensjon-RPA-Gruppe",
			},
			{
				id: "m-5",
				userObjectId: "user-obj-4",
				displayName: "RPA Felles Bot 1",
				userPrincipalName: "rpa-felles1@nav.no",
				accountEnabled: true,
				syncedAt: "2026-05-08T10:00:00.000Z",
				rpaGroupId: "rpa-g-3",
				rpaGroupName: "Felles-RPA-Gruppe",
			},
		],
		auditLog: [
			{
				id: "audit-1",
				action: "rpa_group_members_synced",
				performedBy: "system:rpa-sync",
				performedAt: "2026-05-10T08:30:00.000Z",
				newValue: JSON.stringify({ groupsSynced: 3, totalAdded: 5, totalArchived: 1 }),
			},
			{
				id: "audit-2",
				action: "rpa_group_members_synced",
				performedBy: "system:rpa-sync",
				performedAt: "2026-05-09T08:30:00.000Z",
				newValue: JSON.stringify({ groupsSynced: 2, totalAdded: 0, totalArchived: 0 }),
			},
		],
		...overrides,
	}
}

export function mockAdminRpaRobotDetailData(overrides?: Record<string, unknown>) {
	return {
		member: {
			displayName: "RPA Pensjon Bot",
			userPrincipalName: "rpa-pensjon@nav.no",
			accountEnabled: true,
			userObjectId: "user-obj-1",
			rpaGroups: [{ id: "rpa-g-1", groupName: "Pensjon-RPA-Gruppe" }],
		},
		memberships: [
			{ id: "m-1", groupId: "group-id-1", groupDisplayName: "0000-GA-Robotbrukere", syncedAt: "2026-05-13T22:25:18.000Z" },
			{ id: "m-2", groupId: "group-id-2", groupDisplayName: "0000-GA-Pensjon-Lese", syncedAt: "2026-05-13T22:25:18.000Z" },
			{ id: "m-3", groupId: "group-id-3", groupDisplayName: "0000-GA-Pensjon-Skrive", syncedAt: "2026-05-13T22:25:18.000Z" },
			{ id: "m-4", groupId: "group-id-4", groupDisplayName: "0010-GA-Felles-Drift", syncedAt: "2026-05-13T22:25:18.000Z" },
			{ id: "m-5", groupId: "group-id-5", groupDisplayName: "0100-GA-Saksbehandling", syncedAt: "2026-05-13T22:25:18.000Z" },
			{ id: "m-6", groupId: "group-id-6", groupDisplayName: "0200-GA-Integrasjoner", syncedAt: "2026-05-13T22:25:18.000Z" },
			{ id: "m-7", groupId: "group-id-7", groupDisplayName: "0300-GA-Overvåking", syncedAt: "2026-05-13T22:25:18.000Z" },
			{ id: "m-8", groupId: "group-id-8", groupDisplayName: "0400-GA-Loggtilgang", syncedAt: "2026-05-13T22:25:18.000Z" },
			{ id: "m-9", groupId: "group-id-9", groupDisplayName: "0500-GA-Pensjon-Prod", syncedAt: "2026-05-13T22:25:18.000Z" },
			{ id: "m-10", groupId: "group-id-10", groupDisplayName: "9999-GA-Test-Roboter", syncedAt: "2026-05-13T22:25:18.000Z" },
		],
		...overrides,
	}
}

// ─── RPA User Maintenance Gjennomgang ────────────────────────────────────────

export function mockGjennomgangDetaljRpaMaintenanceData() {
	return {
		...mockGjennomgangDetaljData(),
		activities: [
			{
				id: "activity-rpa-1",
				type: "rpa_user_maintenance" as const,
				status: "pending",
				completedAt: null,
				createdAt: "2026-05-01T08:00:00Z",
				changes: [],
				providerConfig: null,
				periodConfig: null,
				entraGroupsData: null,
				oracleEvidenceData: null,
				ndaEvidenceData: null,
				rpaMaintenanceData: {
					users: [
						{
							userObjectId: "user-rpa-1",
							displayName: "SVC-Pensjon-Robot-01",
							userPrincipalName: "svc-pensjon-robot-01@nav.no",
							accountEnabled: true,
							rpaGroupName: "Pensjon-RPA-Gruppe",
							matchSource: "nais" as const,
						},
						{
							userObjectId: "user-rpa-2",
							displayName: "SVC-Pensjon-Robot-02",
							userPrincipalName: "svc-pensjon-robot-02@nav.no",
							accountEnabled: false,
							rpaGroupName: "Pensjon-RPA-Gruppe",
							matchSource: "nais" as const,
						},
						{
							userObjectId: "user-rpa-3",
							displayName: "SVC-Ufore-Robot-01",
							userPrincipalName: "svc-ufore-robot-01@nav.no",
							accountEnabled: true,
							rpaGroupName: "\u00d8vre-RPA-Gruppe",
							matchSource: "manual" as const,
						},
					],
					assessments: {
						"user-rpa-1": {
							id: "assessment-1",
							owner: "Glad Fjord (Z990001)",
							needComment: "Automatiserer inntektskontroll. Plan om API-integrasjon Q4 2026.",
							criticalityComment: "Lesetilgang til personopplysninger. Ikke skrivetilgang.",
							securityComment: "Passord i CyberArk. Roteres hvert 90. dag. Logging via Splunk.",
							decision: "videref\u00f8res",
							decisionDeadline: null,
						},
						"user-rpa-2": {
							id: "assessment-2",
							owner: null,
							needComment: null,
							criticalityComment: null,
							securityComment: null,
							decision: "avvikles",
							decisionDeadline: "2026-06-30",
						},
					},
				},
				evidenceProviderType: null,
			},
		],
		activityLinks: [{ id: "link-rpa-1", activityType: "rpa_user_maintenance" }],
	}
}

export function mockRapporterData(overrides?: {
	apps?: Array<{ id: string; name: string; isEconomySystem: boolean | null; economySystemType: string | null }>
	existingReports?: Array<{
		id: string
		name: string
		status: string
		progressMessage: string | null
		reportBucketPath: string | null
		createdAt: string
		createdBy: string
	}>
	canManage?: boolean
}) {
	return {
		seksjon: "pensjon-og-ufore",
		seksjonId: "seksjon-1",
		seksjonName: "Pensjon og uføre",
		apps: overrides?.apps ?? [
			{ id: "app-1", name: "Pesys", isEconomySystem: true, economySystemType: "regnskapssystem" },
			{ id: "app-2", name: "Fp-sak", isEconomySystem: false, economySystemType: null },
			{ id: "app-3", name: "Melosys", isEconomySystem: null, economySystemType: null },
			{ id: "app-4", name: "Rekrutteringsbistand", isEconomySystem: false, economySystemType: null },
			{ id: "app-5", name: "Salesforce", isEconomySystem: true, economySystemType: "lonnssystem" },
		],
		existingReports: overrides?.existingReports ?? [],
		canManage: overrides?.canManage ?? true,
	}
}

// ─── Team rutiner (ikke-gjennomførte) ───────────────────────────────

function mockDeadline(overrides: {
	routineId: string
	routineName: string
	applicationId: string
	applicationName: string
	priority?: number
	frequency?: string | null
	lastReviewDate?: string | null
	deadline?: string | null
	overdue?: boolean
	needsFollowUp?: boolean
	sectionId?: string
}) {
	return {
		routine: {
			id: overrides.routineId,
			name: overrides.routineName,
			frequency: overrides.frequency !== undefined ? overrides.frequency : "annually",
			eventFrequency: null,
			priority: overrides.priority ?? 3,
			sectionId: overrides.sectionId ?? "seksjon-1",
			sourceRoutineId: null,
			approvedAt: "2024-01-01T00:00:00.000Z",
			createdAt: "2024-01-01T00:00:00.000Z",
			isSectionRoutine: 0 as 0 | 1,
			sectionRoutineOwnerRole: null,
			controls: [{ id: "ctrl-1", controlId: "K-ST.01", shortTitle: "Tilgangskontroll" }],
			technologyElementIds: [],
			technologyElements: [],
		},
		applicationId: overrides.applicationId,
		applicationName: overrides.applicationName,
		lastReviewDate: overrides.lastReviewDate !== undefined ? overrides.lastReviewDate : null,
		deadline: overrides.deadline !== undefined ? overrides.deadline : "2025-06-01T00:00:00.000Z",
		overdue: overrides.overdue ?? false,
		needsFollowUp: overrides.needsFollowUp ?? false,
		matchSource: "screening" as const,
		isSectionRoutine: false,
		sectionRoutineOwnerRole: null,
	}
}

export function mockTeamRutinerData() {
	return {
		seksjon: "pensjon-og-ufore",
		seksjonName: "Pensjon og uføre",
		team: "starte-pensjon",
		teamName: "Starte pensjon",
		sectionSlugMap: { "seksjon-1": "pensjon-og-ufore" },
		deadlines: [
			mockDeadline({
				routineId: "r-1",
				routineName: "Kvartalvis tilgangskontroll Oracle",
				applicationId: "app-1",
				applicationName: "pensjon-sak",
				priority: 1,
				frequency: "quarterly",
				overdue: true,
				deadline: "2025-03-01T00:00:00.000Z",
			}),
			mockDeadline({
				routineId: "r-2",
				routineName: "Tilgangskontroll Entra ID-grupper",
				applicationId: "app-1",
				applicationName: "pensjon-sak",
				priority: 1,
				frequency: "annually",
				overdue: true,
				deadline: "2025-01-15T00:00:00.000Z",
				needsFollowUp: true,
			}),
			mockDeadline({
				routineId: "r-3",
				routineName: "Halvårlig penetrasjonstest",
				applicationId: "app-2",
				applicationName: "psak-frontend",
				priority: 2,
				frequency: "semi_annually",
				overdue: false,
				lastReviewDate: null,
				deadline: "2025-12-01T00:00:00.000Z",
			}),
			mockDeadline({
				routineId: "r-4",
				routineName: "Sikkerhetskopiering og gjenoppretting",
				applicationId: "app-2",
				applicationName: "psak-frontend",
				priority: 2,
				frequency: "annually",
				overdue: false,
				lastReviewDate: null,
				deadline: "2025-09-01T00:00:00.000Z",
			}),
			mockDeadline({
				routineId: "r-5",
				routineName: "Årlig sårbarhetsskanning",
				applicationId: "app-3",
				applicationName: "pensjon-selvbetjening",
				priority: 3,
				frequency: "annually",
				overdue: false,
				lastReviewDate: null,
				deadline: "2025-11-01T00:00:00.000Z",
			}),
			mockDeadline({
				routineId: "r-6",
				routineName: "Logggjennomgang",
				applicationId: "app-3",
				applicationName: "pensjon-selvbetjening",
				priority: 3,
				frequency: "quarterly",
				overdue: false,
				lastReviewDate: null,
				deadline: "2025-10-01T00:00:00.000Z",
			}),
		],
	}
}

export function mockTeamRutinerEmptyData() {
	return {
		seksjon: "pensjon-og-ufore",
		seksjonName: "Pensjon og uføre",
		team: "starte-pensjon",
		teamName: "Starte pensjon",
		sectionSlugMap: { "seksjon-1": "pensjon-og-ufore" },
		deadlines: [],
	}
}
