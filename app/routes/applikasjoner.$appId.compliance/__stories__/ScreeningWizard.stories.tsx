import type { Meta, StoryObj } from "@storybook/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { ScreeningWizard } from "../components/ScreeningWizard"

function DataRouterWrapper({ children, initialStep }: { children: React.ReactNode; initialStep?: string }) {
	const initialEntry = initialStep ? `/?step=${initialStep}` : "/"
	const router = createMemoryRouter(
		[
			{
				path: "/",
				element: children,
				loader: () => null,
			},
			{
				path: "/api/graph/groups",
				loader: () => ({
					results: [
						{ id: "g-new-1", displayName: "ny-gruppe-fra-søk" },
						{ id: "g-new-2", displayName: "annen-gruppe" },
					],
				}),
			},
		],
		{ initialEntries: [initialEntry] },
	)
	return <RouterProvider router={router} />
}

const meta = {
	title: "Screening/ScreeningWizard",
	component: ScreeningWizard,
	parameters: {
		layout: "fullscreen",
	},
} satisfies Meta<typeof ScreeningWizard>
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
		answer: null as string | null,
		answerComment: null,
		answerLink: null,
		answeredBy: null as string | null,
		answeredAt: null as string | null,
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
		answer: null as string | null,
		answerComment: null,
		answerLink: null,
		answeredBy: null as string | null,
		answeredAt: null as string | null,
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
		answer: null as string | null,
		answerComment: null,
		answerLink: null,
		answeredBy: null as string | null,
		answeredAt: null as string | null,
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
		answer: null as string | null,
		answerComment: null,
		answerLink: null,
		answeredBy: null as string | null,
		answeredAt: null as string | null,
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
		answer: null as string | null,
		answerComment: null,
		answerLink: null,
		answeredBy: null as string | null,
		answeredAt: null as string | null,
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
		answer: null as string | null,
		answerComment: null,
		answerLink: null,
		answeredBy: null as string | null,
		answeredAt: null as string | null,
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
	{ id: "rs-3", name: "Finansielt regelverk" },
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
	assessmentsByGroupId: {} as Record<string, { criticality: string; updatedBy: string; updatedAt: string }>,
}

const mockOracleRolesData = {
	roles: [
		{ instanceId: "pensjon-db-01", roleName: "CONNECT", authType: "PASSWORD", common: true },
		{ instanceId: "pensjon-db-01", roleName: "DBA", authType: "PASSWORD", common: true },
		{ instanceId: "pensjon-db-01", roleName: "APP_USER", authType: null, common: false },
	],
	assessments: {} as Record<string, { criticality: string; updatedBy: string; updatedAt: string }>,
}

const defaultArgs = {
	screening: mockScreening,
	persistence: mockPersistence,
	rulesetOptions: mockRulesetOptions,
	entraGroupsData: mockEntraGroupsData,
	oracleRolesData: mockOracleRolesData,
	canAdmin: true,
}

export const FørsteSpørsmål: Story = {
	name: "Start – første spørsmål",
	args: defaultArgs,
	decorators: [
		(Story) => (
			<DataRouterWrapper>
				<div style={{ padding: "var(--ax-space-8)" }}>
					<Story />
				</div>
			</DataRouterWrapper>
		),
	],
}

export const MidtIFlyt: Story = {
	name: "Midt i flyten (steg 3 av 6)",
	args: {
		...defaultArgs,
		screening: mockScreening.map((q, i) => {
			if (i === 0) return { ...q, answer: "Ja", answeredBy: "A123456", answeredAt: "2026-04-15T10:30:00Z" }
			if (i === 1) return { ...q, answer: "confirmed", answeredBy: "A123456", answeredAt: "2026-04-15T11:00:00Z" }
			return q
		}),
		entraGroupsData: {
			...mockEntraGroupsData,
			assessmentsByGroupId: {},
		},
	},
	decorators: [
		(Story) => (
			<DataRouterWrapper initialStep="q-3">
				<div style={{ padding: "var(--ax-space-8)" }}>
					<Story />
				</div>
			</DataRouterWrapper>
		),
	],
}

export const SisteSpørsmål: Story = {
	name: "Siste spørsmål (steg 6 av 6)",
	args: {
		...defaultArgs,
		screening: mockScreening.map((q, i) => {
			if (i < 5) {
				const fallback =
					q.answerType === "persistence" || q.answerType === "entra_id_groups" || q.answerType === "oracle_roles"
						? "confirmed"
						: "Ja"
				return { ...q, answer: fallback, answeredBy: "A123456", answeredAt: "2026-04-20T12:00:00Z" }
			}
			return q
		}),
	},
	decorators: [
		(Story) => (
			<DataRouterWrapper initialStep="q-6">
				<div style={{ padding: "var(--ax-space-8)" }}>
					<Story />
				</div>
			</DataRouterWrapper>
		),
	],
}

export const AlleBesvart: Story = {
	name: "Alle besvart – fullført",
	args: {
		...defaultArgs,
		screening: mockScreening.map((q) => {
			const fallback =
				q.answerType === "persistence" || q.answerType === "entra_id_groups" || q.answerType === "oracle_roles"
					? "confirmed"
					: "Ja"
			return { ...q, answer: fallback, answeredBy: "A123456", answeredAt: "2026-04-20T12:00:00Z" }
		}),
		entraGroupsData: {
			...mockEntraGroupsData,
			assessmentsByGroupId: {
				"g-1": { criticality: "low", updatedBy: "A123456", updatedAt: "2026-04-20T12:00:00Z" },
				"g-2": { criticality: "high", updatedBy: "A123456", updatedAt: "2026-04-20T12:00:00Z" },
			},
		},
		oracleRolesData: {
			...mockOracleRolesData,
			assessments: {
				"pensjon-db-01:CONNECT": { criticality: "low", updatedBy: "A123456", updatedAt: "2026-04-20T12:00:00Z" },
				"pensjon-db-01:DBA": { criticality: "very_high", updatedBy: "A123456", updatedAt: "2026-04-20T12:00:00Z" },
				"pensjon-db-01:APP_USER": { criticality: "high", updatedBy: "A123456", updatedAt: "2026-04-20T12:00:00Z" },
			},
		},
	},
	decorators: [
		(Story) => (
			<DataRouterWrapper initialStep="complete">
				<div style={{ padding: "var(--ax-space-8)" }}>
					<Story />
				</div>
			</DataRouterWrapper>
		),
	],
}

export const KunEnkleSpørsmål: Story = {
	name: "Kun boolean og single choice",
	args: {
		...defaultArgs,
		screening: mockScreening.filter((q) => q.answerType === "boolean" || q.answerType === "single_choice"),
		persistence: [],
		entraGroupsData: {
			naisGroupIds: [],
			manualGroups: [],
			ghostGroupIds: [],
			groupNames: {},
			assessmentsByGroupId: {},
		},
		oracleRolesData: { roles: [], assessments: {} },
	},
	decorators: [
		(Story) => (
			<DataRouterWrapper>
				<div style={{ padding: "var(--ax-space-8)" }}>
					<Story />
				</div>
			</DataRouterWrapper>
		),
	],
}

export const IngenSpørsmål: Story = {
	name: "Tom tilstand – ingen spørsmål",
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
	decorators: [
		(Story) => (
			<DataRouterWrapper>
				<div style={{ padding: "var(--ax-space-8)" }}>
					<Story />
				</div>
			</DataRouterWrapper>
		),
	],
}
