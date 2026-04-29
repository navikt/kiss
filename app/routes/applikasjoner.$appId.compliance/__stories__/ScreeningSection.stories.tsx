import type { Meta, StoryObj } from "@storybook/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { ScreeningSection } from "../components/ScreeningSection"

function DataRouterWrapper({ children }: { children: React.ReactNode }) {
	const router = createMemoryRouter(
		[
			{
				path: "/",
				element: children,
				loader: () => null,
			},
			{
				path: "/api/graph/groups",
				loader: () => ({ results: [] }),
			},
		],
		{ initialEntries: ["/"] },
	)
	return <RouterProvider router={router} />
}

const meta = {
	title: "Screening/ScreeningSection",
	component: ScreeningSection,
	decorators: [
		(Story) => (
			<DataRouterWrapper>
				<div style={{ maxWidth: "900px", padding: "var(--ax-space-8)" }}>
					<Story />
				</div>
			</DataRouterWrapper>
		),
	],
} satisfies Meta<typeof ScreeningSection>
export default meta
type Story = StoryObj<typeof meta>

const mockScreening = [
	{
		id: "q-1",
		questionText: "Behandler applikasjonen personopplysninger?",
		description: "Svaret påvirker om DPIA-relaterte kontrollpunkter er relevante.",
		descriptionHtml: "<p>Svaret påvirker om DPIA-relaterte kontrollpunkter er relevante.</p>",
		displayOrder: 0,
		answerType: "boolean" as const,
		answer: "Ja",
		answerComment: null,
		answerLink: null,
		answeredBy: "A123456",
		answeredAt: "2026-04-15T10:30:00Z",
		choices: [
			{ id: "c-1", label: "Ja", requiresComment: false, requiresLink: false, routineSelections: [] },
			{ id: "c-2", label: "Nei", requiresComment: false, requiresLink: false, routineSelections: [] },
		],
		affectedControls: ["K-PD.01", "K-PD.02"],
	},
	{
		id: "q-2",
		questionText: "Hvilke lagringsløsninger bruker applikasjonen?",
		description: "Registrer alle databaser og lagringsløsninger.",
		descriptionHtml: "<p>Registrer alle databaser og lagringsløsninger.</p>",
		displayOrder: 1,
		answerType: "persistence" as const,
		answer: "confirmed",
		answerComment: null,
		answerLink: null,
		answeredBy: "A123456",
		answeredAt: "2026-04-15T11:00:00Z",
		choices: [],
		affectedControls: ["K-TS.02"],
	},
	{
		id: "q-3",
		questionText: "Hvilke Entra ID-grupper bruker applikasjonen?",
		description: "Klassifiser gruppene etter kritikalitet.",
		descriptionHtml: "<p>Klassifiser gruppene etter kritikalitet.</p>",
		displayOrder: 2,
		answerType: "entra_id_groups" as const,
		answer: null,
		answerComment: null,
		answerLink: null,
		answeredBy: null,
		answeredAt: null,
		choices: [],
		affectedControls: ["K-TS.01"],
	},
	{
		id: "q-4",
		questionText: "Hvilke Oracle-roller har applikasjonen?",
		description: "Vurder kritikaliteten til hver Oracle-rolle.",
		descriptionHtml: "<p>Vurder kritikaliteten til hver Oracle-rolle.</p>",
		displayOrder: 3,
		answerType: "oracle_roles" as const,
		answer: null,
		answerComment: null,
		answerLink: null,
		answeredBy: null,
		answeredAt: null,
		choices: [],
		affectedControls: ["K-TS.01", "K-TS.02"],
	},
	{
		id: "q-5",
		questionText: "Er applikasjonen eksponert eksternt?",
		description: null,
		descriptionHtml: "",
		displayOrder: 4,
		answerType: "single_choice" as const,
		answer: null,
		answerComment: null,
		answerLink: null,
		answeredBy: null,
		answeredAt: null,
		choices: [
			{
				id: "c-5",
				label: "Ja, tilgjengelig for eksterne brukere",
				requiresComment: false,
				requiresLink: false,
				routineSelections: [],
			},
			{ id: "c-6", label: "Kun intern tilgang", requiresComment: false, requiresLink: false, routineSelections: [] },
		],
		affectedControls: ["K-ST.01"],
	},
	{
		id: "q-6",
		questionText: "Hvilket regelsett gjelder for denne applikasjonen?",
		description: "Velg det regelsettet som best beskriver kravene.",
		descriptionHtml: "<p>Velg det regelsettet som best beskriver kravene.</p>",
		displayOrder: 5,
		answerType: "ruleset" as const,
		answer: null,
		answerComment: null,
		answerLink: null,
		answeredBy: null,
		answeredAt: null,
		choices: [],
		affectedControls: ["K-ST.01", "K-ST.02"],
	},
]

const mockPersistence = [
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
		name: "PENSJON_DB_01",
		dataClassification: "financial_regulation" as const,
		manuallyAdded: false,
	},
]

const mockRulesetOptions = [
	{ id: "rs-1", name: "Standard sikkerhetskrav" },
	{ id: "rs-2", name: "Personvern-krav" },
]

const mockEntraGroupsData = {
	naisGroupIds: ["g-1", "g-2"],
	manualGroups: [] as Array<{
		id: string
		groupId: string
		groupName: string | null
		createdBy: string
		createdAt: string
	}>,
	ghostGroupIds: [] as string[],
	groupNames: { "g-1": "pensjon-sak-read", "g-2": "pensjon-sak-admin" } as Record<string, string>,
	assessmentsByGroupId: {
		"g-1": { criticality: "low", updatedBy: "A123456", updatedAt: "2026-04-15T10:00:00Z" },
	} as Record<string, { criticality: string; updatedBy: string; updatedAt: string }>,
}

const mockOracleRolesData = {
	roles: [
		{ instanceId: "pensjon-db-01", roleName: "CONNECT", authType: "PASSWORD", common: true },
		{ instanceId: "pensjon-db-01", roleName: "DBA", authType: "PASSWORD", common: true },
		{ instanceId: "pensjon-db-01", roleName: "APP_USER", authType: null, common: false },
	],
	assessments: {
		"pensjon-db-01:CONNECT": { criticality: "low", updatedBy: "A123456", updatedAt: "2026-04-15T10:30:00Z" },
		"pensjon-db-01:DBA": { criticality: "very_high", updatedBy: "A123456", updatedAt: "2026-04-15T10:31:00Z" },
	} as Record<string, { criticality: string; updatedBy: string; updatedAt: string }>,
}

export const AlleTyper: Story = {
	name: "Alle spørsmålstyper",
	args: {
		screening: mockScreening,
		persistence: mockPersistence,
		rulesetOptions: mockRulesetOptions,
		entraGroupsData: mockEntraGroupsData,
		oracleRolesData: mockOracleRolesData,
		canAdmin: true,
	},
}

export const DelvisBesvart: Story = {
	name: "Delvis besvart (2 av 6)",
	args: {
		screening: mockScreening,
		persistence: mockPersistence,
		rulesetOptions: mockRulesetOptions,
		entraGroupsData: mockEntraGroupsData,
		oracleRolesData: mockOracleRolesData,
		canAdmin: true,
	},
}

export const AlleBesvart: Story = {
	name: "Alle besvart",
	args: {
		screening: mockScreening.map((q) => {
			const fallback =
				q.answerType === "persistence" || q.answerType === "entra_id_groups" || q.answerType === "oracle_roles"
					? "confirmed"
					: "Ja"
			return {
				...q,
				answer: q.answer ?? fallback,
				answeredBy: "A123456",
				answeredAt: "2026-04-20T12:00:00Z",
			}
		}),
		persistence: mockPersistence,
		rulesetOptions: mockRulesetOptions,
		entraGroupsData: {
			...mockEntraGroupsData,
			assessmentsByGroupId: {
				"g-1": { criticality: "low", updatedBy: "A123456", updatedAt: "2026-04-15T10:00:00Z" },
				"g-2": { criticality: "high", updatedBy: "A123456", updatedAt: "2026-04-15T10:05:00Z" },
			},
		},
		oracleRolesData: {
			...mockOracleRolesData,
			assessments: {
				"pensjon-db-01:CONNECT": { criticality: "low", updatedBy: "A123456", updatedAt: "2026-04-15T10:30:00Z" },
				"pensjon-db-01:DBA": { criticality: "very_high", updatedBy: "A123456", updatedAt: "2026-04-15T10:31:00Z" },
				"pensjon-db-01:APP_USER": { criticality: "high", updatedBy: "A123456", updatedAt: "2026-04-15T10:32:00Z" },
			},
		},
		canAdmin: true,
	},
}

export const IngenSporsmal: Story = {
	name: "Ingen spørsmål",
	args: {
		screening: [],
		persistence: [],
		rulesetOptions: [],
		entraGroupsData: {
			naisGroupIds: [],
			manualGroups: [],
			ghostGroupIds: [],
			groupNames: {},
			assessmentsByGroupId: {},
		},
		oracleRolesData: { roles: [], assessments: {} },
		canAdmin: true,
	},
}

export const KunEnkleSporsmal: Story = {
	name: "Kun boolean og single choice",
	args: {
		screening: mockScreening.filter((q) => q.answerType === "boolean" || q.answerType === "single_choice"),
		persistence: [],
		rulesetOptions: [],
		entraGroupsData: {
			naisGroupIds: [],
			manualGroups: [],
			ghostGroupIds: [],
			groupNames: {},
			assessmentsByGroupId: {},
		},
		oracleRolesData: { roles: [], assessments: {} },
		canAdmin: true,
	},
}
