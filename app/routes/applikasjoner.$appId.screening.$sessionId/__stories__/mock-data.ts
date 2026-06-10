// Mock data for screening session stories

export const mockParticipants = [
	{ id: "p-1", userIdent: "Z991234", userName: "Modig Fjelltopp" },
	{ id: "p-2", userIdent: "Z996543", userName: "Stille Havbunn" },
	{ id: "p-3", userIdent: "Z991122", userName: "Rask Vindkast" },
]

export const mockScreening = [
	{
		id: "q-economy",
		questionText: "Er applikasjonen klassifisert som et økonomisystem?",
		description:
			"Et økonomisystem er et system som behandler økonomiske transaksjoner, regnskapsdata eller finansiell rapportering. Klassifiseringen påvirker hvilke kontrollkrav som gjelder.",
		descriptionHtml:
			"<p>Et økonomisystem er et system som behandler økonomiske transaksjoner, regnskapsdata eller finansiell rapportering. Klassifiseringen påvirker hvilke kontrollkrav som gjelder.</p>",
		displayOrder: 0,
		answerType: "economy_system" as const,
		answer: null as string | null,
		answerComment: null,
		answerLink: null,
		answeredBy: null as string | null,
		answeredAt: null as string | null,
		choices: [],
		affectedControls: ["K-ØS.01", "K-ØS.02", "K-ØS.03"],
		sectionId: null,
		rulesetCategoryFilter: null,
	},
	{
		id: "q-boolean",
		questionText: "Behandler applikasjonen personopplysninger?",
		description: "Svaret påvirker om DPIA-relaterte kontrollpunkter er relevante for denne applikasjonen.",
		descriptionHtml: "<p>Svaret påvirker om DPIA-relaterte kontrollpunkter er relevante for denne applikasjonen.</p>",
		displayOrder: 1,
		answerType: "boolean" as const,
		answer: null as string | null,
		answerComment: null,
		answerLink: null,
		answeredBy: null as string | null,
		answeredAt: null as string | null,
		choices: [
			{ id: "c-ja", label: "Ja", requiresComment: false, requiresLink: false, routineSelections: [] },
			{ id: "c-nei", label: "Nei", requiresComment: false, requiresLink: false, routineSelections: [] },
		],
		affectedControls: ["K-PD.01", "K-PD.02"],
		sectionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
		rulesetCategoryFilter: null,
	},
	{
		id: "q-single",
		questionText: "Er applikasjonen eksponert eksternt?",
		description: "Applikasjoner med ekstern tilgang har strengere krav til autentisering og sårbarhetsscanning.",
		descriptionHtml:
			"<p>Applikasjoner med ekstern tilgang har strengere krav til autentisering og sårbarhetsscanning.</p>",
		displayOrder: 2,
		answerType: "single_choice" as const,
		answer: null as string | null,
		answerComment: null,
		answerLink: null,
		answeredBy: null as string | null,
		answeredAt: null as string | null,
		choices: [
			{
				id: "c-ext-ja",
				label: "Ja, tilgjengelig for eksterne brukere",
				requiresComment: true,
				requiresLink: false,
				routineSelections: [],
			},
			{
				id: "c-ext-intern",
				label: "Kun intern tilgang via Naisdevice",
				requiresComment: false,
				requiresLink: false,
				routineSelections: [],
			},
			{
				id: "c-ext-backend",
				label: "Kun backend-til-backend",
				requiresComment: false,
				requiresLink: false,
				routineSelections: [],
			},
		],
		affectedControls: ["K-ST.01", "K-ST.03"],
		sectionId: null,
		rulesetCategoryFilter: null,
	},
	{
		id: "q-persistence",
		questionText: "Hvilke lagringsløsninger bruker applikasjonen?",
		description: "Registrer alle databaser og lagringsløsninger som applikasjonen benytter.",
		descriptionHtml: "<p>Registrer alle databaser og lagringsløsninger som applikasjonen benytter.</p>",
		displayOrder: 3,
		answerType: "persistence" as const,
		answer: null as string | null,
		answerComment: null,
		answerLink: null,
		answeredBy: null as string | null,
		answeredAt: null as string | null,
		choices: [],
		affectedControls: ["K-TS.02", "K-TS.04"],
		sectionId: null,
		rulesetCategoryFilter: null,
	},
	{
		id: "q-entra",
		questionText: "Hvilke Entra ID-grupper bruker applikasjonen?",
		description: "Klassifiser gruppene etter kritikalitet for tilgangsstyring.",
		descriptionHtml: "<p>Klassifiser gruppene etter kritikalitet for tilgangsstyring.</p>",
		displayOrder: 4,
		answerType: "entra_id_groups" as const,
		answer: null as string | null,
		answerComment: null,
		answerLink: null,
		answeredBy: null as string | null,
		answeredAt: null as string | null,
		choices: [],
		affectedControls: ["K-TS.01"],
		sectionId: null,
		rulesetCategoryFilter: null,
	},
	{
		id: "q-ruleset",
		questionText: "Hvilket regelsett gjelder for denne applikasjonen?",
		description: "Velg det regelsettet som best beskriver de regulatoriske kravene applikasjonen må oppfylle.",
		descriptionHtml:
			"<p>Velg det regelsettet som best beskriver de regulatoriske kravene applikasjonen må oppfylle.</p>",
		displayOrder: 6,
		answerType: "ruleset" as const,
		answer: null as string | null,
		answerComment: null,
		answerLink: null,
		answeredBy: null as string | null,
		answeredAt: null as string | null,
		choices: [],
		affectedControls: ["K-ST.01", "K-ST.02"],
		sectionId: null,
		rulesetCategoryFilter: null,
	},
	{
		id: "q-routine-choice",
		questionText: "Har applikasjonen tilgangsstyring med periodisk gjennomgang?",
		description: "Applikasjoner med sensitiv data bør ha en rutine for periodisk gjennomgang av tilganger.",
		descriptionHtml: "<p>Applikasjoner med sensitiv data bør ha en rutine for periodisk gjennomgang av tilganger.</p>",
		displayOrder: 7,
		answerType: "boolean" as const,
		answer: null as string | null,
		answerComment: null,
		answerLink: null,
		answeredBy: null as string | null,
		answeredAt: null as string | null,
		choices: [
			{
				id: "c-routine-ja",
				label: "Ja",
				requiresComment: false,
				requiresLink: false,
				routineSelections: [
					{
						effectId: "eff-preset-1",
						controlTextId: "K-TS.01",
						controlName: "Tilgangsstyring",
						presetRoutineId: "rutine-uuid-1",
						presetRoutineName: "Kvartalsvis tilgangsgjennomgang",
						routines: [],
						selectedRoutineId: null,
					},
				],
			},
			{
				id: "c-routine-nei",
				label: "Nei",
				requiresComment: true,
				requiresLink: false,
				routineSelections: [],
			},
		],
		affectedControls: ["K-TS.01"],
		sectionId: null,
		rulesetCategoryFilter: null,
	},
]

export const mockPersistence = [
	{
		id: "p-1",
		type: "cloud_sql_postgres" as const,
		name: "pensjon-sak-db",
		dataClassification: "critical" as const,
		manuallyAdded: false,
	},
	{
		id: "p-2",
		type: "oracle" as const,
		name: "PENSJON_REGNSKAP_01",
		dataClassification: "financial_regulation" as const,
		manuallyAdded: false,
	},
	{
		id: "p-3",
		type: "bucket" as const,
		name: "pensjon-vedlegg-bucket",
		dataClassification: null as "not_critical" | "critical" | "financial_regulation" | null,
		manuallyAdded: true,
	},
]

export const mockRulesetOptions = [
	{ id: "rs-1", name: "Standard sikkerhetskrav", category: null },
	{ id: "rs-2", name: "Personvern-krav (GDPR)", category: null },
	{ id: "rs-3", name: "Finansielt regelverk", category: null },
	{ id: "rs-4", name: "Helseopplysninger", category: null },
]

export const mockEntraGroupsData = {
	naisGroupIds: ["g-1", "g-2", "g-3"],
	manualGroups: [
		{
			id: "mg-1",
			groupId: "g-manual-1",
			groupName: "pensjon-regnskap-superusers",
			createdBy: "Z990001",
			createdAt: "2026-04-01T10:00:00Z",
		},
	] as Array<{
		id: string
		groupId: string
		groupName: string | null
		createdBy: string
		createdAt: string
	}>,
	ghostGroupIds: [] as string[],
	groupNames: {
		"g-1": "pensjon-sak-read",
		"g-2": "pensjon-sak-admin",
		"g-3": "pensjon-sak-deploy",
	} as Record<string, string>,
	assessmentsByGroupId: {} as Record<string, { criticality: string; updatedBy: string; updatedAt: string }>,
}

export const mockEconomyClassification = {
	id: "ec-1",
	isEconomySystem: true,
	economySystemType: "regnskapssystem",
	justification: "Applikasjonen behandler pensjonsutbetalinger og regnskapsdata",
	validFrom: "2026-01-01T00:00:00Z",
	validUntil: "2027-01-01T00:00:00Z",
	isExpired: false,
}

export const defaultWizardArgs = {
	screening: mockScreening,
	persistence: mockPersistence,
	rulesetOptions: mockRulesetOptions,
	entraGroupsData: mockEntraGroupsData,
	economyClassification: mockEconomyClassification,
}

/** Mark questions as answered up to (and including) the given index */
export function answered(questions: typeof mockScreening, upToIndex: number) {
	return questions.map((q, i) => {
		if (i > upToIndex) return q
		const isInventory = ["persistence", "entra_id_groups", "economy_system"].includes(q.answerType)
		return {
			...q,
			answer: isInventory ? "confirmed" : (q.choices[0]?.label ?? "Ja"),
			answeredBy: "Z990001",
			answeredAt: "2026-05-06T09:30:00Z",
		}
	})
}

export const allAnsweredScreening = answered(mockScreening, mockScreening.length - 1)

export const enrichedWizardArgs = {
	...defaultWizardArgs,
	entraGroupsData: {
		...mockEntraGroupsData,
		assessmentsByGroupId: {
			"g-1": { criticality: "low", updatedBy: "Z990001", updatedAt: "2026-05-06T09:30:00Z" },
			"g-2": { criticality: "high", updatedBy: "Z990002", updatedAt: "2026-05-06T09:35:00Z" },
			"g-3": { criticality: "low", updatedBy: "Z990001", updatedAt: "2026-05-06T09:30:00Z" },
		},
	},
}
