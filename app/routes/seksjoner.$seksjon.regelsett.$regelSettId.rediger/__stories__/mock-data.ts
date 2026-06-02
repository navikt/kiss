// Mock data for ruleset editor stories

const mockSection = {
	id: "seksjon-1",
	slug: "pensjon-og-ufore",
	name: "Pensjon og uføre",
	description: null,
}

const mockAllControls = [
	{ id: "ctrl-1", controlId: "K-TS.01", shortTitle: "Tilgangsstyring" },
	{ id: "ctrl-2", controlId: "K-PD.01", shortTitle: "Personvern og databehandling" },
	{ id: "ctrl-3", controlId: "K-EK.01", shortTitle: "Endringskontroll" },
	{ id: "ctrl-4", controlId: "K-DR.01", shortTitle: "Disaster recovery" },
]

const mockFrequencies = [
	{ value: "monthly", label: "Månedlig" },
	{ value: "quarterly", label: "Kvartalsvis" },
	{ value: "semi_annually", label: "Halvårlig" },
	{ value: "annually", label: "Årlig" },
]

const baseRuleset = {
	id: "rs-1",
	sectionId: "seksjon-1",
	sectionName: "Pensjon og uføre",
	name: "Standard tilgangskontroll-regelsett",
	description: "Beskriver kravene til tilgangskontroll for applikasjoner i seksjonen.",
	responsibleIdent: "Z990001",
	responsibleName: "Glad Fjord",
	responsibleRole: null as string | null,
	frequency: "quarterly",
	status: "active" as const,
	category: null as string | null,
	approvalStatus: "unapproved" as const,
	lastApproval: null,
	approvals: [],
	resolvedResponsible: null,
	controls: [
		{
			id: "ctrl-1",
			linkId: "link-1",
			controlId: "K-TS.01",
			shortTitle: "Tilgangsstyring",
			requirement: "Applikasjonen skal ha dokumentert tilgangsstyring med periodisk gjennomgang.",
		},
	],
	linkedRoutines: [],
	attachments: [],
	createdAt: new Date("2024-01-15"),
	createdBy: "Z990001",
	updatedAt: new Date("2024-06-01"),
	updatedBy: "Z990001",
}

// ─── Regelsett uten kategori ──────────────────────────────────────────────────

export const regelsetUtenKategoriData = {
	section: mockSection,
	ruleset: { ...baseRuleset, category: null },
	allControls: mockAllControls,
	canArchive: true,
	frequencies: mockFrequencies,
}

// ─── Regelsett med kategori «Tilgangskontroll» ───────────────────────────────

export const regelsetMedTilgangskontrollData = {
	section: mockSection,
	ruleset: {
		...baseRuleset,
		name: "Kvartalsvis tilgangsgjennomgang",
		category: "tilgangskontroll",
	},
	allControls: mockAllControls,
	canArchive: true,
	frequencies: mockFrequencies,
}

// ─── Regelsett med kategori «Endringskontroll» ───────────────────────────────

export const regelsetMedEndringskontrollData = {
	section: mockSection,
	ruleset: {
		...baseRuleset,
		id: "rs-2",
		name: "Endringskontroll-prosess",
		description: "Beskriver kravene til endringskontroll inkludert release management og godkjenningsprosesser.",
		category: "endringskontroll",
		controls: [
			{
				id: "ctrl-3",
				linkId: "link-3",
				controlId: "K-EK.01",
				shortTitle: "Endringskontroll",
				requirement: "Alle endringer skal godkjennes av teknisk leder før produksjonssetting.",
			},
		],
	},
	allControls: mockAllControls,
	canArchive: true,
	frequencies: mockFrequencies,
}

// ─── Godkjent regelsett (med kategori) ───────────────────────────────────────

export const godkjentRegelsetData = {
	section: mockSection,
	ruleset: {
		...baseRuleset,
		name: "Godkjent tilgangskontroll-regelsett",
		category: "tilgangskontroll",
		status: "active" as const,
		approvalStatus: "approved" as const,
		lastApproval: {
			validFrom: new Date("2024-01-01"),
			validUntil: new Date("2024-12-31"),
		},
		approvals: [
			{
				id: "approval-1",
				approvedBy: "Z990002",
				approvedByName: "Rask Elv",
				comment: "Godkjent etter gjennomgang",
				validFrom: new Date("2024-01-01"),
				validUntil: new Date("2024-12-31"),
				createdAt: new Date("2024-01-02"),
			},
		],
	},
	allControls: mockAllControls,
	canArchive: true,
	frequencies: mockFrequencies,
}

// ─── Arkivert regelsett ───────────────────────────────────────────────────────

export const arkivertRegelsetData = {
	section: mockSection,
	ruleset: {
		...baseRuleset,
		name: "Gammelt tilgangskontroll-regelsett (arkivert)",
		category: "tilgangskontroll",
		status: "archived" as const,
		approvalStatus: "unapproved" as const,
	},
	allControls: mockAllControls,
	canArchive: true,
	frequencies: mockFrequencies,
}
