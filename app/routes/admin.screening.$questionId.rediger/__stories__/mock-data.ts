// Mock data for screening question editor stories

export const mockControls = [
	{ controlId: "K-TS.01", name: "Tilgangsstyring" },
	{ controlId: "K-PD.01", name: "Personvern og databehandling" },
	{ controlId: "K-SI.01", name: "Sikkerhetshendelser" },
	{ controlId: "K-DR.01", name: "Disaster recovery" },
]

export const mockTechnologyElements = [
	{ id: "te-oracle", name: "Oracle-database" },
	{ id: "te-postgres", name: "PostgreSQL" },
	{ id: "te-kafka", name: "Kafka" },
]

export const mockRulesets = [
	{ id: "rs-1", name: "Standard SDLC-regelsett" },
	{ id: "rs-tilgang", name: "Tilgangskontroll-regelsett" },
	{ id: "rs-endring", name: "Endringskontroll-regelsett" },
]

export const mockRoutines = [
	{ id: "rutine-1", name: "Kvartalsvis tilgangsgjennomgang" },
	{ id: "rutine-2", name: "Halvårlig tilgangsrevisjon" },
	{ id: "rutine-3", name: "Årlig sikkerhetsgjennomgang" },
]

/** allRoutinesForControls: alle godkjente rutiner per kontroll (for preset_routine dropdown) */
export const mockAllRoutinesForControls: Record<string, Array<{ id: string; name: string }>> = {
	"K-TS.01": mockRoutines,
	"K-PD.01": [{ id: "rutine-3", name: "Årlig sikkerhetsgjennomgang" }],
	"K-SI.01": [],
	"K-DR.01": [{ id: "rutine-2", name: "Halvårlig tilgangsrevisjon" }],
}

// ─── Ny spørsmål (isNew) ─────────────────────────────────────────────────────

export const nyttSporsmalData = {
	isNew: true,
	hasExistingEconomyQuestion: false,
	question: {
		id: "ny",
		questionText: "",
		description: null,
		descriptionHtml: "",
		displayOrder: 0,
		answerType: "",
		status: "draft" as const,
		rulesetId: null as string | null,
		rulesetCategoryFilter: null as string | null,
		technologyElementIds: [] as string[],
	},
	choices: [] as never[],
	controls: mockControls,
	technologyElements: mockTechnologyElements,
	rulesets: mockRulesets,
	allRoutinesForControls: mockAllRoutinesForControls,
	seksjon: null as string | null,
	sectionId: null as string | null,
	sectionName: null as string | null,
	returnPath: "/admin/screening",
}

// ─── Eksisterende spørsmål med alle effekttyper ──────────────────────────────

export const eksisterendeSporsmalData = {
	isNew: false,
	hasExistingEconomyQuestion: false,
	question: {
		id: "q-1",
		questionText: "Har applikasjonen tilgangsstyring med periodisk gjennomgang?",
		description:
			"Applikasjoner med sensitiv data bør ha en rutine for periodisk gjennomgang av tilganger til systemer og databaser.",
		descriptionHtml:
			"<p>Applikasjoner med sensitiv data bør ha en rutine for periodisk gjennomgang av tilganger til systemer og databaser.</p>",
		displayOrder: 2,
		answerType: "single_choice",
		status: "draft" as const,
		rulesetId: null as string | null,
		rulesetCategoryFilter: null as string | null,
		technologyElementIds: ["te-oracle", "te-postgres"],
	},
	choices: [
		{
			id: "c-ja-forvalgt",
			label: "Ja, med fast rutine",
			requiresComment: false,
			requiresLink: false,
			effects: [
				{
					id: "eff-1",
					controlTextId: "K-TS.01",
					controlName: "Tilgangsstyring",
					effect: "preset_routine",
					comment: null,
					presetRoutineId: "rutine-1",
					presetRoutineName: "Kvartalsvis tilgangsgjennomgang",
				},
			],
		},
		{
			id: "c-ja-velg",
			label: "Ja, velg rutine selv",
			requiresComment: false,
			requiresLink: false,
			effects: [
				{
					id: "eff-2",
					controlTextId: "K-TS.01",
					controlName: "Tilgangsstyring",
					effect: "select_routine",
					comment: null,
					presetRoutineId: null,
					presetRoutineName: null,
				},
			],
		},
		{
			id: "c-nei-relevant",
			label: "Nei, ikke relevant",
			requiresComment: false,
			requiresLink: false,
			effects: [
				{
					id: "eff-3",
					controlTextId: "K-TS.01",
					controlName: "Tilgangsstyring",
					effect: "not_relevant",
					comment: null,
					presetRoutineId: null,
					presetRoutineName: null,
				},
			],
		},
		{
			id: "c-nei",
			label: "Nei",
			requiresComment: true,
			requiresLink: false,
			effects: [
				{
					id: "eff-4",
					controlTextId: "K-TS.01",
					controlName: "Tilgangsstyring",
					effect: null,
					comment: null,
					presetRoutineId: null,
					presetRoutineName: null,
				},
			],
		},
	],
	controls: mockControls,
	technologyElements: mockTechnologyElements,
	rulesets: mockRulesets,
	allRoutinesForControls: mockAllRoutinesForControls,
	seksjon: null as string | null,
	sectionId: null as string | null,
	sectionName: null as string | null,
	returnPath: "/admin/screening",
}

// ─── Godkjent spørsmål (status=approved) ─────────────────────────────────────

export const godkjentSporsmalData = {
	...eksisterendeSporsmalData,
	question: {
		...eksisterendeSporsmalData.question,
		status: "approved" as const,
	},
}

// ─── Regelsett-spørsmål (answerType="ruleset") ────────────────────────────────

/** Nytt spørsmål av type «Regelsett» — ingen kategoribegrensning valgt ennå */
export const nyttRegelsettsSporsmalData = {
	...nyttSporsmalData,
	question: {
		...nyttSporsmalData.question,
		answerType: "ruleset",
	},
}

/** Eksisterende regelsett-spørsmål med kategoribegrensning «Tilgangskontroll» */
export const regelsettsSporsmalMedKategoriData = {
	isNew: false,
	hasExistingEconomyQuestion: false,
	question: {
		id: "q-tilgang",
		questionText: "Hvilket tilgangskontroll-regelsett gjelder for applikasjonen?",
		description: "Velg det regelsettet som beskriver kravene til tilgangskontroll for denne applikasjonen.",
		descriptionHtml: "<p>Velg det regelsettet som beskriver kravene til tilgangskontroll for denne applikasjonen.</p>",
		displayOrder: 3,
		answerType: "ruleset",
		status: "draft" as const,
		rulesetId: null as string | null,
		rulesetCategoryFilter: "tilgangskontroll",
		technologyElementIds: [] as string[],
	},
	choices: [] as never[],
	controls: mockControls,
	technologyElements: mockTechnologyElements,
	rulesets: mockRulesets,
	allRoutinesForControls: mockAllRoutinesForControls,
	seksjon: null as string | null,
	sectionId: null as string | null,
	sectionName: null as string | null,
	returnPath: "/admin/screening",
}

/** Regelsett-spørsmål i seksjons-kontekst (samme komponent, annen kontekst) */
export const regelsettsSporsmalSeksjonsKontekstData = {
	...regelsettsSporsmalMedKategoriData,
	seksjon: "pensjon-og-ufore",
	sectionId: "seksjon-1",
	sectionName: "Pensjon og uføre",
	returnPath: "/seksjoner/pensjon-og-ufore/screening",
}
